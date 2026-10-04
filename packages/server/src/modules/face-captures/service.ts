import type pg from "pg";
import { withBypass, withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";
import {
  deleteEvidenceObject,
  putImmutableEvidenceObject,
  type StoredEvidenceObject
} from "../../lib/evidence-storage";

export interface FaceCaptureActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export type FaceParty = "customer" | "guarantor";
export type FacePurpose = "registration" | "loan_application";

export interface FaceCaptureLiveness {
  checked: boolean;
  passed: boolean;
  provider: string;
  checks?: Record<string, unknown>;
}

export interface FaceQualityThresholds {
  minBrightness: number;
  minClarity: number;
  requireFacePresent: boolean;
  requireLiveness: boolean;
}

export const DEFAULT_FACE_QUALITY: FaceQualityThresholds = {
  minBrightness: 0.15,
  minClarity: 0.3,
  requireFacePresent: true,
  requireLiveness: true
};

export interface FaceQualitySettingsRow {
  company_id: string;
  min_brightness: string;
  min_clarity: string;
  require_face_present: boolean;
  require_liveness: boolean;
  updated_at: Date;
}

/**
 * RULE 19.5.2 — the controls are configured per company. A company that has
 * not configured them uses the platform defaults, and whatever was applied is
 * recorded on the capture.
 */
export async function resolveFaceQualityThresholds(
  db: pg.PoolClient,
  companyId: string
): Promise<FaceQualityThresholds> {
  const row = await db.query<FaceQualitySettingsRow>(
    `SELECT company_id, min_brightness, min_clarity, require_face_present, require_liveness, updated_at
       FROM company_face_quality_settings WHERE company_id=$1`,
    [companyId]
  );
  if ((row.rowCount ?? 0) === 0) return DEFAULT_FACE_QUALITY;
  const settings = row.rows[0]!;
  return {
    minBrightness: Number(settings.min_brightness),
    minClarity: Number(settings.min_clarity),
    requireFacePresent: settings.require_face_present,
    requireLiveness: settings.require_liveness
  };
}

export async function getFaceQualitySettings(actor: FaceCaptureActor): Promise<{
  thresholds: FaceQualityThresholds;
  configured: boolean;
}> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const row = await db.query<FaceQualitySettingsRow>(
      `SELECT company_id, min_brightness, min_clarity, require_face_present, require_liveness, updated_at
         FROM company_face_quality_settings WHERE company_id=$1`,
      [actor.companyId]
    );
    if ((row.rowCount ?? 0) === 0) {
      return { thresholds: DEFAULT_FACE_QUALITY, configured: false };
    }
    const settings = row.rows[0]!;
    return {
      configured: true,
      thresholds: {
        minBrightness: Number(settings.min_brightness),
        minClarity: Number(settings.min_clarity),
        requireFacePresent: settings.require_face_present,
        requireLiveness: settings.require_liveness
      }
    };
  });
}

export async function updateFaceQualitySettings(
  actor: FaceCaptureActor,
  input: {
    minBrightness: number;
    minClarity: number;
    requireFacePresent: boolean;
    requireLiveness: boolean;
  },
  meta: ActorMeta = {}
): Promise<FaceQualityThresholds> {
  for (const [value, field] of [
    [input.minBrightness, "minBrightness"],
    [input.minClarity, "minClarity"]
  ] as [number, string][]) {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw AppError.unprocessable(`${field} must be greater than 0 and at most 1`);
    }
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    await db.query(
      `INSERT INTO company_face_quality_settings
         (company_id, min_brightness, min_clarity, require_face_present, require_liveness, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (company_id) DO UPDATE
         SET min_brightness=EXCLUDED.min_brightness,
             min_clarity=EXCLUDED.min_clarity,
             require_face_present=EXCLUDED.require_face_present,
             require_liveness=EXCLUDED.require_liveness,
             updated_by=EXCLUDED.updated_by,
             updated_at=now()`,
      [
        actor.companyId, input.minBrightness, input.minClarity,
        input.requireFacePresent, input.requireLiveness, actor.sub
      ]
    );
    const thresholds = await resolveFaceQualityThresholds(db, actor.companyId);
    await db.query(
      `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                               entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
       VALUES ($1,$2,$3,'face_quality.settings_updated','company_face_quality_settings',$4,NULL,$5::jsonb,
               'Face capture quality thresholds updated',$6,$7,$8)`,
      [
        actor.companyId,
        actor.branchId,
        actor.sub,
        actor.companyId,
        JSON.stringify(thresholds),
        meta.ip ?? null,
        meta.userAgent ?? null,
        meta.requestId ?? null
      ]
    );
    return thresholds;
  });
}

export interface FaceQualityVerdict {
  passed: boolean;
  failures: string[];
  thresholds: FaceQualityThresholds;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * RULE 9.4.4 / 19.5.2 — a live capture is only accepted when the quality
 * controls actually pass: a face is present, the image is bright enough, it is
 * clear enough, and liveness holds. Storing the checks is not enough; the
 * values are evaluated here and every failure is named so the worker is told
 * exactly what to fix.
 */
export function evaluateFaceQuality(
  checks: Record<string, unknown> | undefined,
  liveness: FaceCaptureLiveness,
  thresholds: FaceQualityThresholds = DEFAULT_FACE_QUALITY
): FaceQualityVerdict {
  const failures: string[] = [];
  const source = checks ?? {};

  if (thresholds.requireLiveness) {
    if (!liveness.checked) failures.push("no liveness check was performed");
    if (!liveness.passed) failures.push("the liveness check failed");
  }

  const facePresent = source.facePresent ?? source.face_detected;
  if (thresholds.requireFacePresent && facePresent === false) {
    failures.push("no face was detected in the capture");
  }

  const brightness = asNumber(source.brightness);
  if (brightness === null) {
    failures.push("the capture did not report a brightness measurement");
  } else if (brightness < thresholds.minBrightness) {
    failures.push(
      `the capture is too dark (brightness ${brightness} is below the required ${thresholds.minBrightness})`
    );
  }

  const clarity = asNumber(source.clarity ?? source.sharpness);
  if (clarity === null) {
    failures.push("the capture did not report a clarity measurement");
  } else if (clarity < thresholds.minClarity) {
    failures.push(
      `the capture is not clear enough (clarity ${clarity} is below the required ${thresholds.minClarity})`
    );
  }

  return { passed: failures.length === 0, failures, thresholds };
}

export function faceQualityFailureMessage(failures: string[]): string {
  return `The live capture did not meet the required quality controls: ${failures.join("; ")}. ` +
    "Recapture the image — a new capture is required, the old one is never replaced.";
}

export function describeCaptureRejection(
  capture: { verification_status: string; capture_metadata?: Record<string, unknown> | null }
): string | null {
  if (capture.verification_status !== "rejected") return null;
  const metadata = capture.capture_metadata ?? {};
  const qualityFailures = (metadata.quality_failures as string[] | undefined) ?? [];
  const parts: string[] = [];
  if (qualityFailures.length > 0) {
    parts.push(
      `The live capture did not meet the required quality controls: ${qualityFailures.join("; ")}.`
    );
  }
  if (metadata.reuse_detected === true) {
    parts.push("This image already exists as a capture for a different customer.");
  }
  if (metadata.liveness_passed === false) {
    parts.push("The liveness check failed.");
  }
  parts.push("A new capture is required; the rejected attempt is retained as evidence.");
  return parts.join(" ");
}

export interface RecordFaceCaptureInput {
  customerId: string;
  applicationId?: string | null;
  party: FaceParty;
  purpose: FacePurpose;
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png";
  liveness: FaceCaptureLiveness;
  deviceMetadata?: Record<string, unknown>;
  location?: Record<string, unknown>;
  expectedImageSha256?: string;
  captureProofId?: string | null;
}

export interface FaceCaptureRow {
  id: string;
  company_id: string;
  branch_id: string;
  customer_id: string;
  capture_for: string;
  loan_application_id: string | null;
  party: string;
  capture_sequence: number;
  capture_source: string;
  image_sha256: string;
  storage_object_ref: string;
  file_size_bytes: string;
  mime_type: string;
  liveness_checked: boolean;
  verification_status: string;
  capture_proof_id: string | null;
  captured_by: string;
  captured_at: Date;
  created_at: Date;
  /** Includes the quality thresholds actually applied, so the decision is auditable. */
  capture_metadata: Record<string, unknown> | null;
}

interface CaptureTarget {
  branchId: string;
  applicationId: string | null;
  guarantorId: string | null;
}

async function auditFaceCapture(
  db: pg.PoolClient,
  input: {
    companyId: string;
    branchId: string;
    actorUserId: string;
    captureId: string;
    action: string;
    newValue: unknown;
    reason: string | null;
    meta: ActorMeta;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,'face_captures',$5,NULL,$6::jsonb,$7,$8,$9,$10)`,
    [
      input.companyId,
      input.branchId,
      input.actorUserId,
      input.action,
      input.captureId,
      JSON.stringify(input.newValue),
      input.reason,
      input.meta.ip ?? null,
      input.meta.userAgent ?? null,
      input.meta.requestId ?? null
    ]
  );
}

export async function requireVerifiedFaceCapture(
  db: pg.PoolClient,
  input: {
    companyId: string;
    customerId: string;
    captureFor: "registration" | "loan_application";
    party?: "customer" | "guarantor";
    applicationId?: string | null;
    label: string;
  }
): Promise<void> {
  const party = input.party ?? "customer";
  const applicationClause = input.applicationId
    ? "AND loan_application_id=$5"
    : "AND loan_application_id IS NULL";
  const params = input.applicationId
    ? [input.companyId, input.customerId, input.captureFor, party, input.applicationId]
    : [input.companyId, input.customerId, input.captureFor, party];
  const result = await db.query(
    `SELECT 1
       FROM face_captures
      WHERE company_id=$1
        AND customer_id=$2
        AND capture_for=$3
        AND party=$4
        AND capture_source='live_camera'
        AND liveness_checked=true
        AND verification_status='verified'
        ${applicationClause}
      LIMIT 1`,
    params
  );
  if ((result.rowCount ?? 0) === 0) {
    throw AppError.conflict(`${input.label} is required before this action`);
  }
}

export async function listFaceCaptures(
  actor: FaceCaptureActor,
  customerId: string
): Promise<FaceCaptureRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const customer = await db.query<{ id: string }>(
      `SELECT id FROM customers WHERE id=$1`,
      [customerId]
    );
    if ((customer.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const rows = await db.query<FaceCaptureRow>(
      `SELECT id, company_id, branch_id, customer_id, capture_for, loan_application_id,
              party, capture_sequence, capture_source, image_sha256, storage_object_ref,
              file_size_bytes, mime_type, liveness_checked, verification_status,
              capture_proof_id, captured_by, captured_at, created_at
         FROM face_captures WHERE customer_id=$1 ORDER BY created_at, capture_sequence`,
      [customerId]
    );
    return rows.rows;
  });
}

async function notifyReuseManager(
  db: pg.PoolClient,
  input: {
    companyId: string;
    branchId: string;
    capturedBy: string;
    customerId: string;
    applicationId: string | null;
    reusedCaptureId: string | null;
    party: string;
  }
): Promise<void> {
  // The worker's manager is the branch-level holder of a supervisory role, or
  // the MD when the capture was taken at Head Office.
  const managers = await db.query<{ id: string }>(
    `SELECT DISTINCT u.id
       FROM role_assignments ra
       JOIN users u ON u.id = ra.user_id AND u.status = 'active'
       JOIN roles r ON r.id = ra.role_id
      WHERE ra.company_id = $1
        AND ra.status = 'active'
        AND u.id <> $2
        AND (
          r.role_key IN ('md','deputy_md','gm','assistant_gm','branch_manager','deputy_branch_manager')
          AND (
            ra.scope_type IN ('company_wide','head_office')
            OR EXISTS (
              SELECT 1 FROM role_assignment_branches rab
               WHERE rab.assignment_id = ra.id AND rab.branch_id = $3
            )
          )
        )`,
    [input.companyId, input.capturedBy, input.branchId]
  );
  for (const row of managers.rows) {
    await db.query(
      `INSERT INTO notifications (company_id, recipient_user_id, kind, payload, channel)
       VALUES ($1,$2,'face_capture.reuse_detected',$3,'in_app')`,
      [
        input.companyId,
        row.id,
        JSON.stringify({
          customer_id: input.customerId,
          application_id: input.applicationId,
          party: input.party,
          captured_by: input.capturedBy,
          reused_capture_id: input.reusedCaptureId
        })
      ]
    );
  }
}

export async function recordFaceCapture(
  actor: FaceCaptureActor,
  input: RecordFaceCaptureInput,
  meta: ActorMeta = {}
): Promise<FaceCaptureRow> {
  if (!input.customerId) throw AppError.unprocessable("customerId is required");
  if (!["customer", "guarantor"].includes(input.party)) {
    throw AppError.unprocessable("party must be customer or guarantor");
  }
  if (!["registration", "loan_application"].includes(input.purpose)) {
    throw AppError.unprocessable("purpose must be registration or loan_application");
  }
  if (input.purpose === "registration" && input.applicationId) {
    throw AppError.unprocessable("registration captures cannot have an applicationId");
  }
  if (input.purpose === "loan_application" && !input.applicationId) {
    throw AppError.unprocessable("loan_application captures require an applicationId");
  }
  if (!input.liveness?.checked) {
    throw AppError.unprocessable("A liveness check is required before a capture can be recorded");
  }
  if (!input.liveness.provider?.trim()) {
    throw AppError.unprocessable("liveness provider is required");
  }

  const target = await withTenant(actor.companyId, actor.branchId, async (db): Promise<CaptureTarget> => {
    const customer = await db.query<{ id: string; branch_id: string }>(
      `SELECT id, branch_id FROM customers WHERE id=$1`,
      [input.customerId]
    );
    if ((customer.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const branchId = customer.rows[0]!.branch_id;
    if (actor.branchId !== null && actor.branchId !== branchId) {
      throw AppError.forbidden("Cannot capture a face for a customer in another branch");
    }
    if (!input.applicationId)     return { branchId, applicationId: null, guarantorId: null };

    const application = await db.query<{ id: string; branch_id: string; customer_id: string }>(
      `SELECT id, branch_id, customer_id FROM loan_applications WHERE id=$1`,
      [input.applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Loan application not found");
    if (application.rows[0]!.customer_id !== input.customerId) {
      throw AppError.unprocessable("The application does not belong to this customer");
    }
    if (application.rows[0]!.branch_id !== branchId) {
      throw AppError.unprocessable("The application and customer branches do not match");
    }

    // RULE 19.4.3 — a guarantor face capture binds to the guarantor identity.
    let guarantorId: string | null = null;
    if (input.party === "guarantor") {
      const guarantor = await db.query<{ id: string }>(
        `SELECT id FROM loan_application_guarantors
          WHERE loan_application_id=$1 AND status='active'`,
        [input.applicationId]
      );
      if ((guarantor.rowCount ?? 0) === 0) {
        throw AppError.conflict(
          "Record the guarantor before capturing the guarantor's face (RULE 19.4.3)"
        );
      }
      guarantorId = guarantor.rows[0]!.id;
    }
    return { branchId, applicationId: input.applicationId, guarantorId };
  });

  if (input.captureProofId) {
    const existing = await withTenant(actor.companyId, target.branchId, async (db) => {
      const found = await db.query<FaceCaptureRow>(
        `SELECT id, company_id, branch_id, customer_id, capture_for, loan_application_id,
                party, capture_sequence, capture_source, image_sha256, storage_object_ref,
                file_size_bytes, mime_type, liveness_checked, verification_status,
                capture_proof_id, captured_by, captured_at, created_at
           FROM face_captures WHERE company_id=$1 AND capture_proof_id=$2`,
        [actor.companyId, input.captureProofId]
      );
      return (found.rowCount ?? 0) > 0 ? found.rows[0]! : null;
    });
    if (existing) {
      if (
        existing.customer_id !== input.customerId ||
        existing.capture_for !== input.purpose ||
        existing.party !== input.party ||
        (input.expectedImageSha256 && existing.image_sha256 !== input.expectedImageSha256)
      ) {
        throw AppError.conflict("The capture proof was already used for a different capture");
      }
      return existing;
    }
  }

  let stored: StoredEvidenceObject;
  try {
    stored = await putImmutableEvidenceObject({
      companyId: actor.companyId,
      branchId: target.branchId,
      customerId: input.customerId,
      bytes: input.bytes,
      mimeType: input.mimeType
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Evidence storage failed";
    if (message.includes("MIME") || message.includes("maximum") || message.includes("required")) {
      throw AppError.unprocessable(message);
    }
    throw AppError.internal("Evidence object could not be stored");
  }

  if (input.expectedImageSha256 && input.expectedImageSha256 !== stored.imageSha256) {
    await deleteEvidenceObject(stored.storageObjectRef).catch(() => undefined);
    throw AppError.unprocessable("The signed capture hash does not match the image bytes");
  }

  try {
    return await withTenant(actor.companyId, target.branchId, async (db) => {
      const reuse = await withBypass(async (bypassDb) => {
        const found = await bypassDb.query<{ id: string; customer_id: string }>(
          `SELECT id, customer_id FROM face_captures
            WHERE image_sha256=$1 AND customer_id<>$2
            ORDER BY created_at DESC LIMIT 1`,
          [stored.imageSha256, input.customerId]
        );
        return (found.rowCount ?? 0) > 0 ? found.rows[0]! : null;
      });
      const reuseDetected = reuse !== null;
      const quality = evaluateFaceQuality(
        input.liveness.checks,
        input.liveness,
        await resolveFaceQualityThresholds(db, actor.companyId)
      );
      const accepted = quality.passed && !reuseDetected;
      const sequence = await db.query<{ next_sequence: number }>(
        `SELECT COALESCE(MAX(capture_sequence),0)::int + 1 AS next_sequence
           FROM face_captures WHERE customer_id=$1 AND capture_for=$2`,
        [input.customerId, input.purpose]
      );
      const captureSequence = sequence.rows[0]!.next_sequence;
      const inserted = await db.query<FaceCaptureRow>(
        `INSERT INTO face_captures
           (company_id, branch_id, customer_id, capture_for, loan_application_id,
            party, capture_sequence, capture_source, image_sha256, storage_object_ref,
             file_size_bytes, mime_type, liveness_checked, verification_status,
             capture_proof_id, device_metadata, location, capture_metadata, captured_by, captured_at,
             verified_by, verified_at, guarantor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'live_camera',$8,$9,$10,$11,true,$12,$13,
                 $14::jsonb,$15::jsonb,$16::jsonb,$17,now(),$18,$19,$20)
         RETURNING id, company_id, branch_id, customer_id, capture_for, loan_application_id,
                   party, capture_sequence, capture_source, image_sha256, storage_object_ref,
                   file_size_bytes, mime_type, liveness_checked, verification_status,
                   capture_proof_id, captured_by, captured_at, created_at, capture_metadata`,
        [
          actor.companyId,
          target.branchId,
          input.customerId,
          input.purpose,
          target.applicationId,
          input.party,
          captureSequence,
          stored.imageSha256,
          stored.storageObjectRef,
          stored.fileSizeBytes,
          stored.mimeType,
          accepted ? "verified" : "rejected",
          input.captureProofId ?? null,
          JSON.stringify(input.deviceMetadata ?? {}),
          JSON.stringify(input.location ?? {}),
          JSON.stringify({
            liveness_provider: input.liveness.provider,
            liveness_checks: input.liveness.checks ?? {},
            liveness_passed: input.liveness.passed,
            quality_passed: quality.passed,
            quality_failures: quality.failures,
            quality_thresholds: quality.thresholds,
            reuse_detected: reuseDetected,
            reused_capture_id: reuse?.id ?? null
          }),
          actor.sub,
          accepted ? actor.sub : null,
          accepted ? new Date() : null,
          target.guarantorId
        ]
      );
      const capture = inserted.rows[0]!;
      await auditFaceCapture(db, {
        companyId: actor.companyId,
        branchId: target.branchId,
        actorUserId: actor.sub,
        captureId: capture.id,
        action: accepted ? "face_capture.recorded" : "face_capture.rejected",
        newValue: {
          capture_id: capture.id,
          customer_id: capture.customer_id,
          application_id: capture.loan_application_id,
          party: capture.party,
          capture_for: capture.capture_for,
          image_sha256: capture.image_sha256,
          storage_object_ref: capture.storage_object_ref,
          verification_status: capture.verification_status,
          reuse_detected: reuseDetected
        },
        reason: accepted ? null : "Liveness or reuse validation failed",
        meta
      });

      // RULE 9.4.5 — a face matched against a different customer's capture
      // flags the application and notifies the responsible worker's manager.
      if (reuseDetected) {
        await notifyReuseManager(db, {
          companyId: actor.companyId,
          branchId: target.branchId,
          capturedBy: actor.sub,
          customerId: capture.customer_id,
          applicationId: capture.loan_application_id,
          reusedCaptureId: reuse?.id ?? null,
          party: capture.party
        });
      }
      // RULE 9.4.4 / 20.1.3 — the failed attempt is still recorded as an
      // immutable rejected capture; the HTTP surface turns a rejected
      // verification_status into an explanation for the worker.
      return capture;
    });
  } catch (error) {
    await deleteEvidenceObject(stored.storageObjectRef).catch(() => undefined);
    throw error;
  }
}
