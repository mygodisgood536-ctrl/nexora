import type pg from "pg";
import { withBypass, withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { evaluateFaceQuality } from "../face-captures/service";
import {
  deleteEvidenceObject,
  putImmutableEvidenceObject,
  type StoredEvidenceObject
} from "../../lib/evidence-storage";

export type LoanEvidenceType = "government_id" | "house" | "business" | "loan_form" | "default_form";
export type EvidenceParty = "customer" | "guarantor";

export interface LoanEvidenceActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface EvidenceLiveness {
  checked: boolean;
  passed: boolean;
  provider: string;
  checks?: Record<string, unknown>;
}

export interface RecordLoanEvidenceInput {
  applicationId: string;
  evidenceType: LoanEvidenceType;
  party: EvidenceParty;
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png";
  liveness: EvidenceLiveness;
  deviceMetadata?: Record<string, unknown>;
  location?: Record<string, unknown>;
  identityName?: string | null;
  expectedImageSha256?: string;
  captureProofId?: string | null;
  pendingUploadId?: string | null;
}

export interface LoanEvidenceRow {
  id: string;
  company_id: string;
  branch_id: string;
  customer_id: string;
  loan_application_id: string;
  party: string;
  evidence_type: string;
  identity_name: string | null;
  capture_sequence: number;
  capture_source: string;
  storage_object_ref: string;
  image_sha256: string;
  file_size_bytes: string;
  mime_type: string;
  verification_status: string;
  device_metadata: Record<string, unknown>;
  location: Record<string, unknown>;
  capture_metadata: Record<string, unknown>;
  capture_proof_id: string | null;
  captured_by: string;
  captured_at: Date;
  created_at: Date;
}

async function auditEvidence(
  db: pg.PoolClient,
  input: {
    companyId: string;
    branchId: string;
    actorUserId: string;
    evidenceId: string;
    action: string;
    value: unknown;
    reason: string | null;
    meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null };
  }
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,'loan_application_evidence',$5,NULL,$6::jsonb,$7,$8,$9,$10)`,
    [
      input.companyId,
      input.branchId,
      input.actorUserId,
      input.action,
      input.evidenceId,
      JSON.stringify(input.value),
      input.reason,
      input.meta.ip ?? null,
      input.meta.userAgent ?? null,
      input.meta.requestId ?? null
    ]
  );
}

const EVIDENCE_TYPES: LoanEvidenceType[] = [
  "government_id",
  "house",
  "business",
  "loan_form",
  "default_form"
];

function normalizeEvidenceName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function recordLoanApplicationEvidence(
  actor: LoanEvidenceActor,
  input: RecordLoanEvidenceInput,
  meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null } = {}
): Promise<LoanEvidenceRow> {
  if (!EVIDENCE_TYPES.includes(input.evidenceType)) {
    throw AppError.unprocessable("Unsupported live evidence type");
  }
  if (!["customer", "guarantor"].includes(input.party)) {
    throw AppError.unprocessable("party must be customer or guarantor");
  }
  if (!input.liveness?.checked || !input.liveness.provider?.trim()) {
    throw AppError.unprocessable("A checked live quality result is required");
  }

  const target = await withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{
      id: string;
      branch_id: string;
      customer_id: string;
      status: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    }>(
      `SELECT a.id, a.branch_id, a.customer_id, a.status,
              c.first_name, c.middle_name, c.last_name
         FROM loan_applications a
         JOIN customers c ON c.id=a.customer_id
        WHERE a.id=$1`,
      [input.applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const app = application.rows[0]!;
    if (actor.branchId !== null && actor.branchId !== app.branch_id) {
      throw AppError.forbidden("Cannot attach evidence to another branch's application");
    }
    if (app.status === "disbursed" || app.status === "withdrawn") {
      throw AppError.conflict(`Evidence cannot be attached after the application is '${app.status}'`);
    }
    if (input.evidenceType === "government_id" && !input.identityName?.trim()) {
      throw AppError.unprocessable("Government ID evidence requires the name read from the ID");
    }

    // RULE 19.4.3 / 19.7.2 — guarantor evidence belongs to the guarantor identity
    // and the government-ID name is matched against the guarantor's own name.
    let guarantorId: string | null = null;
    let identityNameForParty = [app.first_name, app.middle_name, app.last_name]
      .filter(Boolean).join(" ");
    if (input.party === "guarantor") {
      const guarantor = await db.query<{ id: string; full_name: string }>(
        `SELECT id, full_name FROM loan_application_guarantors
          WHERE loan_application_id=$1 AND status='active'`,
        [input.applicationId]
      );
      if ((guarantor.rowCount ?? 0) === 0) {
        throw AppError.conflict(
          "Record the guarantor before capturing guarantor evidence (RULE 19.4.3)"
        );
      }
      guarantorId = guarantor.rows[0]!.id;
      identityNameForParty = guarantor.rows[0]!.full_name;
    }

    return {
      branchId: app.branch_id,
      customerId: app.customer_id,
      guarantorId,
      customerName: identityNameForParty
    };
  });

  if (input.captureProofId) {
    const existing = await withTenant(actor.companyId, target.branchId, async (db) => {
      const found = await db.query<LoanEvidenceRow>(
        `SELECT id, company_id, branch_id, customer_id, loan_application_id, party,
                evidence_type, identity_name, capture_sequence, capture_source, storage_object_ref,
                image_sha256, file_size_bytes, mime_type, verification_status,
                device_metadata, location, capture_metadata, capture_proof_id,
                captured_by, captured_at, created_at
           FROM loan_application_evidence WHERE company_id=$1 AND capture_proof_id=$2`,
        [actor.companyId, input.captureProofId]
      );
      return (found.rowCount ?? 0) > 0 ? found.rows[0]! : null;
    });
    if (existing) {
      if (
        existing.loan_application_id !== input.applicationId ||
        existing.evidence_type !== input.evidenceType ||
        existing.party !== input.party ||
        (input.expectedImageSha256 && existing.image_sha256 !== input.expectedImageSha256)
      ) {
        throw AppError.conflict("The capture proof was already used for different evidence");
      }
      return existing;
    }
  }

  let stored: StoredEvidenceObject;
  try {
    stored = await putImmutableEvidenceObject({
      companyId: actor.companyId,
      branchId: target.branchId,
      customerId: target.customerId,
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
        const found = await bypassDb.query<{ id: string }>(
          `SELECT id FROM loan_application_evidence
            WHERE image_sha256=$1 AND customer_id<>$2
            ORDER BY created_at DESC LIMIT 1`,
          [stored.imageSha256, target.customerId]
        );
        return (found.rowCount ?? 0) > 0 ? found.rows[0]! : null;
      });
      const sequence = await db.query<{ next_sequence: number }>(
        `SELECT COALESCE(MAX(capture_sequence),0)::int + 1 AS next_sequence
           FROM loan_application_evidence
          WHERE loan_application_id=$1 AND evidence_type=$2 AND party=$3`,
        [input.applicationId, input.evidenceType, input.party]
      );
      const identityMatches = input.evidenceType !== "government_id" ||
        normalizeEvidenceName(input.identityName ?? "") === normalizeEvidenceName(target.customerName);
      // RULE 19.5.2 / 9.4.4 — the same quality controls apply to every live
      // capture, not only the face stage: the image must be usable and the
      // liveness check must hold before the evidence is accepted.
      const quality = evaluateFaceQuality(input.liveness.checks, input.liveness);
      const accepted = quality.passed && reuse === null && identityMatches;
      const inserted = await db.query<LoanEvidenceRow>(
        `INSERT INTO loan_application_evidence
           (company_id, branch_id, customer_id, loan_application_id, party, evidence_type,
            identity_name, capture_sequence, capture_source, storage_object_ref, image_sha256,
            file_size_bytes, mime_type, verification_status, device_metadata, location,
            capture_metadata, capture_proof_id, captured_by, captured_at, guarantor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'live_camera',$9,$10,$11,$12,$13,
                 $14::jsonb,$15::jsonb,$16::jsonb,$17,$18,now(),$19)
         RETURNING id, company_id, branch_id, customer_id, loan_application_id, party,
                   evidence_type, identity_name, capture_sequence, capture_source, storage_object_ref,
                   image_sha256, file_size_bytes, mime_type, verification_status,
                   device_metadata, location, capture_metadata, capture_proof_id,
                   captured_by, captured_at, created_at`,
        [
          actor.companyId,
          target.branchId,
          target.customerId,
          input.applicationId,
           input.party,
           input.evidenceType,
           input.identityName ?? null,
           sequence.rows[0]!.next_sequence,
          stored.storageObjectRef,
          stored.imageSha256,
          stored.fileSizeBytes,
          stored.mimeType,
          accepted ? "verified" : "rejected",
          JSON.stringify(input.deviceMetadata ?? {}),
          JSON.stringify(input.location ?? {}),
          JSON.stringify({
            liveness_provider: input.liveness.provider,
            liveness_checks: input.liveness.checks ?? {},
             liveness_passed: input.liveness.passed,
             quality_passed: quality.passed,
             quality_failures: quality.failures,
             quality_thresholds: quality.thresholds,
             identity_name: input.identityName ?? null,
             identity_match: identityMatches,
             identity_compared_to: input.party === "guarantor" ? "guarantor" : "customer",
             reuse_detected: reuse !== null
          }),
          input.captureProofId ?? null,
          actor.sub,
          target.guarantorId
        ]      );
      const evidence = inserted.rows[0]!;
      await auditEvidence(db, {
        companyId: actor.companyId,
        branchId: target.branchId,
        actorUserId: actor.sub,
        evidenceId: evidence.id,
        action: accepted ? "loan_evidence.recorded" : "loan_evidence.rejected",
        value: {
          application_id: evidence.loan_application_id,
          evidence_type: evidence.evidence_type,
          party: evidence.party,
          identity_name: evidence.identity_name,
          image_sha256: evidence.image_sha256,
          storage_object_ref: evidence.storage_object_ref,
          verification_status: evidence.verification_status,
          reuse_detected: reuse !== null
        },
        reason: accepted ? null : "Live quality or reuse validation failed",
        meta
      });
      if (input.pendingUploadId) {
        await completePendingEvidenceUpload(
          db,
          actor,
          input.pendingUploadId,
          {
            applicationId: input.applicationId,
            customerId: target.customerId,
            party: input.party,
            evidenceType: input.evidenceType,
            contentSha256: stored.imageSha256
          },
          meta
        );
      }
      return evidence;
    });
  } catch (error) {
    await deleteEvidenceObject(stored.storageObjectRef).catch(() => undefined);
    throw error;
  }
}

export async function listLoanApplicationEvidence(
  actor: LoanEvidenceActor,
  applicationId: string
): Promise<LoanEvidenceRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{ id: string }>(
      `SELECT id FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const rows = await db.query<LoanEvidenceRow>(
      `SELECT id, company_id, branch_id, customer_id, loan_application_id, party,
              evidence_type, identity_name, capture_sequence, capture_source, storage_object_ref,
              image_sha256, file_size_bytes, mime_type, verification_status,
              device_metadata, location, capture_metadata, capture_proof_id,
              captured_by, captured_at, created_at
         FROM loan_application_evidence WHERE loan_application_id=$1
        ORDER BY evidence_type, party, capture_sequence, created_at`,
      [applicationId]
    );
    return rows.rows;
  });
}

export interface PendingUploadRow {
  id: string;
  company_id: string;
  branch_id: string;
  customer_id: string;
  loan_application_id: string;
  party: string;
  evidence_type: string;
  content_sha256: string;
  object_identifier: string;
  status: string;
  failure_reason: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

async function auditPendingUpload(
  db: pg.PoolClient,
  actor: LoanEvidenceActor,
  branchId: string,
  uploadId: string,
  action: string,
  value: unknown,
  reason: string | null,
  meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null }
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,'pending_evidence_uploads',$5,NULL,$6::jsonb,$7,$8,$9,$10)`,
    [actor.companyId, branchId, actor.sub, action, uploadId, JSON.stringify(value), reason,
      meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null]
  );
}

export async function createPendingEvidenceUpload(
  actor: LoanEvidenceActor,
  applicationId: string,
  input: {
    party: EvidenceParty;
    evidenceType: LoanEvidenceType;
    contentSha256: string;
    objectIdentifier: string;
  },
  meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null } = {}
): Promise<PendingUploadRow> {
  if (!/^[0-9a-f]{64}$/i.test(input.contentSha256)) {
    throw AppError.unprocessable("contentSha256 must be a SHA-256 hex digest");
  }
  if (!input.objectIdentifier?.trim() || input.objectIdentifier.length > 300) {
    throw AppError.unprocessable("objectIdentifier is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{ branch_id: string; customer_id: string; status: string }>(
      `SELECT branch_id, customer_id, status FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const app = application.rows[0]!;
    if (actor.branchId !== null && actor.branchId !== app.branch_id) {
      throw AppError.forbidden("Cannot create an upload for another branch's application");
    }
    if (app.status === "disbursed" || app.status === "withdrawn") {
      throw AppError.conflict("Pending evidence cannot be created after the application is closed");
    }
    await db.query(
      `INSERT INTO pending_evidence_uploads
         (company_id, branch_id, customer_id, loan_application_id, party, evidence_type,
          content_sha256, object_identifier, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (company_id, object_identifier) DO NOTHING`,
      [actor.companyId, app.branch_id, app.customer_id, applicationId, input.party,
        input.evidenceType, input.contentSha256.toLowerCase(), input.objectIdentifier, actor.sub]
    );
    const row = await db.query<PendingUploadRow>(
      `SELECT id, company_id, branch_id, customer_id, loan_application_id, party,
              evidence_type, content_sha256, object_identifier, status, failure_reason,
              created_by, created_at, updated_at
         FROM pending_evidence_uploads WHERE company_id=$1 AND object_identifier=$2`,
      [actor.companyId, input.objectIdentifier]
    );
    const upload = row.rows[0]!;
    if (upload.status === "pending") {
      await auditPendingUpload(db, actor, app.branch_id, upload.id, "evidence_upload.pending", {
        application_id: applicationId,
        party: upload.party,
        evidence_type: upload.evidence_type,
        content_sha256: upload.content_sha256,
        object_identifier: upload.object_identifier
      }, null, meta);
    }
    return upload;
  });
}

export async function markPendingEvidenceUploadFailed(
  actor: LoanEvidenceActor,
  uploadId: string,
  reason: string,
  meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null } = {},
  applicationId?: string
): Promise<PendingUploadRow> {
  if (!reason?.trim()) throw AppError.unprocessable("failure reason is required");
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const row = await db.query<PendingUploadRow>(
      `SELECT id, company_id, branch_id, customer_id, loan_application_id, party,
              evidence_type, content_sha256, object_identifier, status, failure_reason,
              created_by, created_at, updated_at
         FROM pending_evidence_uploads WHERE id=$1`,
      [uploadId]
    );
    if ((row.rowCount ?? 0) === 0) throw AppError.notFound("Pending upload not found");
    const upload = row.rows[0]!;
    if (applicationId && upload.loan_application_id !== applicationId) {
      throw AppError.notFound("Pending upload not found");
    }
    if (upload.status === "completed") throw AppError.conflict("A completed upload cannot fail");
    const updated = await db.query<PendingUploadRow>(
      `UPDATE pending_evidence_uploads SET status='failed', failure_reason=$2
        WHERE id=$1
        RETURNING id, company_id, branch_id, customer_id, loan_application_id, party,
                  evidence_type, content_sha256, object_identifier, status, failure_reason,
                  created_by, created_at, updated_at`,
      [uploadId, reason.trim()]
    );
    const next = updated.rows[0]!;
    await auditPendingUpload(db, actor, next.branch_id, next.id, "evidence_upload.failed", {
      status: next.status,
      failure_reason: next.failure_reason
    }, reason.trim(), meta);
    return next;
  });
}

export async function listPendingEvidenceUploads(
  actor: LoanEvidenceActor,
  applicationId: string
): Promise<PendingUploadRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{ id: string }>(
      `SELECT id FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const rows = await db.query<PendingUploadRow>(
      `SELECT id, company_id, branch_id, customer_id, loan_application_id, party,
              evidence_type, content_sha256, object_identifier, status, failure_reason,
              created_by, created_at, updated_at
         FROM pending_evidence_uploads WHERE loan_application_id=$1 ORDER BY created_at`,
      [applicationId]
    );
    return rows.rows;
  });
}

export async function completePendingEvidenceUpload(
  db: pg.PoolClient,
  actor: LoanEvidenceActor,
  uploadId: string,
  expected: {
    applicationId: string;
    customerId: string;
    party: string;
    evidenceType: string;
    contentSha256: string;
  },
  meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null }
): Promise<void> {
  const row = await db.query<PendingUploadRow>(
    `SELECT id, company_id, branch_id, customer_id, loan_application_id, party,
            evidence_type, content_sha256, object_identifier, status, failure_reason,
            created_by, created_at, updated_at
       FROM pending_evidence_uploads WHERE id=$1`,
    [uploadId]
  );
  if ((row.rowCount ?? 0) === 0) throw AppError.notFound("Pending upload not found");
  const upload = row.rows[0]!;
  if (
    upload.loan_application_id !== expected.applicationId ||
    upload.customer_id !== expected.customerId ||
    upload.party !== expected.party ||
    upload.evidence_type !== expected.evidenceType ||
    upload.content_sha256 !== expected.contentSha256
  ) {
    throw AppError.conflict("Pending upload does not match the evidence being recorded");
  }
  if (upload.status === "failed") throw AppError.conflict("A failed upload cannot be completed");
  if (upload.status === "completed") return;
  await db.query(
    `UPDATE pending_evidence_uploads SET status='completed', failure_reason=NULL WHERE id=$1`,
    [uploadId]
  );
  await auditPendingUpload(db, actor, upload.branch_id, upload.id, "evidence_upload.completed", {
    application_id: upload.loan_application_id,
    evidence_type: upload.evidence_type,
    party: upload.party
  }, null, meta);
}

export async function requireVerifiedLoanEvidence(
  db: pg.PoolClient,
  companyId: string,
  applicationId: string,
  evidenceTypes: LoanEvidenceType[]
): Promise<void> {
  for (const evidenceType of evidenceTypes) {
    for (const party of ["customer", "guarantor"] as const) {
      const row = await db.query(
        `SELECT 1 FROM loan_application_evidence
          WHERE company_id=$1 AND loan_application_id=$2 AND evidence_type=$3
            AND party=$4 AND capture_source='live_camera'
            AND verification_status='verified'
            AND ($3 <> 'government_id' OR identity_name IS NOT NULL)
          LIMIT 1`,
        [companyId, applicationId, evidenceType, party]
      );
      if ((row.rowCount ?? 0) === 0) {
        throw AppError.conflict(`Verified ${party} ${evidenceType} evidence is required before this action`);
      }
    }
  }
}
