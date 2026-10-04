// Stage 7C — Loan Documents, Credit Assessments, and on_rejection handling
// (Part 1 §23, Part 2 §28–31).
//
// Loan Documents: upload, list, confirm (Part 1 §23: "Document Collection"
// stage requires upload/confirm of required docs).
//
// Credit Assessments: record credit decision (approve/reject/request_information)
// with required reason — used during Credit Assessment stage.
//
// on_rejection: configurable per approval chain — either "return_to_applicant"
// (back to applicant) or "previous_stage" (back one stage).
import type pg from "pg";
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

export interface LoanActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

async function auditLoanDocument(
  db: pg.PoolClient,
  companyId: string,
  branchId: string | null,
  actorUserId: string,
  action: string,
  entityType: "loan_documents" | "credit_assessments",
  entityId: string,
  previousValue: unknown,
  newValue: unknown,
  reason: string | null,
  meta: ActorMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
    [
      companyId, branchId, actorUserId, action, entityType, entityId,
      previousValue === undefined ? null : JSON.stringify(previousValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      reason,
      meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null,
    ]
  );
}

export interface LoanDocumentRow {
  id: string;
  application_id: string;
  doc_type: string;
  file_url: string;
  uploaded_by: string;
  uploaded_at: Date;
  confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  branch_id: string;
  file_sha256: string | null;
  /** bigint comes back as a numeric string from the pg driver. */
  file_size_bytes: string | null;
  mime_type: string | null;
}

export interface UploadDocumentInput {
  applicationId: string;
  docType: string;
  fileUrl: string;
  /**
   * Part 20.1.2 / RULE 19.7 — content-identity evidence captured at upload so
   * a loan document can be proven unmodified. Optional for API back-compat;
   * when supplied the columns become immutable (0046 trigger).
   */
  fileSha256?: string | null;
  fileSizeBytes?: number | null;
  mimeType?: string | null;
}

export interface CreditAssessmentInput {
  applicationId: string;
  decision: "approve" | "reject" | "request_information";
  reason: string;
}

export interface CreditAssessmentRow {
  id: string;
  application_id: string;
  assessed_by: string;
  decision: string;
  reason: string;
  created_at: Date;
}

/** Upload a document for a loan application (Document Collection stage). */
export async function uploadDocument(
  actor: LoanActor,
  input: UploadDocumentInput,
  meta: ActorMeta = {}
): Promise<LoanDocumentRow> {
  if (!input.applicationId) throw AppError.unprocessable("applicationId is required");
  if (!input.docType || input.docType.trim().length === 0) throw AppError.unprocessable("docType is required");
  if (!input.fileUrl || input.fileUrl.trim().length === 0) throw AppError.unprocessable("fileUrl is required");

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    // Verify application exists and actor has access
    const app = await db.query<{ id: string; branch_id: string }>(
      `SELECT id, branch_id FROM loan_applications WHERE id=$1`,
      [input.applicationId]
    );
    if ((app.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    if (actor.branchId && actor.branchId !== app.rows[0]!.branch_id) {
      throw AppError.forbidden("Cannot access application in a different branch");
    }

    const inserted = await db.query<LoanDocumentRow>(
      `INSERT INTO loan_documents (company_id, application_id, doc_type, file_url, uploaded_by,
                                   file_sha256, file_size_bytes, mime_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, application_id, doc_type, file_url, uploaded_by, uploaded_at,
                 confirmed, confirmed_by, confirmed_at,
                 file_sha256, file_size_bytes, mime_type`,
      [
        actor.companyId,
        input.applicationId,
        input.docType.trim(),
        input.fileUrl.trim(),
        actor.sub,
        input.fileSha256 ?? null,
        input.fileSizeBytes ?? null,
        input.mimeType ?? null
      ]
    );
    const doc = inserted.rows[0]!;
    await auditLoanDocument(
      db, actor.companyId, actor.branchId, actor.sub,
      "loan_document.uploaded", "loan_documents", doc.id,
      null,
      {
        application_id: doc.application_id,
        doc_type: doc.doc_type,
        file_url: doc.file_url,
        file_sha256: doc.file_sha256,
        file_size_bytes: doc.file_size_bytes,
        mime_type: doc.mime_type
      },
      null, meta
    );
    return doc;
  });
}

/** List documents for an application. */
export async function listDocuments(
  actor: LoanActor,
  applicationId: string
): Promise<LoanDocumentRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const app = await db.query<{ id: string; branch_id: string }>(
      `SELECT id, branch_id FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((app.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    if (actor.branchId && actor.branchId !== app.rows[0]!.branch_id) {
      throw AppError.forbidden("Cannot access application in a different branch");
    }

    const r = await db.query<LoanDocumentRow>(
      `SELECT id, application_id, doc_type, file_url, uploaded_by, uploaded_at, confirmed, confirmed_by, confirmed_at,
              file_sha256, file_size_bytes, mime_type
         FROM loan_documents WHERE application_id=$1 ORDER BY uploaded_at`,
      [applicationId]
    );
    return r.rows;
  });
}

/** Confirm a document (Document Collection stage — confirms required doc is present). */
export async function confirmDocument(
  actor: LoanActor,
  documentId: string,
  meta: ActorMeta = {}
): Promise<LoanDocumentRow> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const doc = await db.query<LoanDocumentRow>(
      `SELECT d.id, d.application_id, d.doc_type, d.file_url, d.uploaded_by, d.uploaded_at,
              d.confirmed, d.confirmed_by, d.confirmed_at,
              d.file_sha256, d.file_size_bytes, d.mime_type, a.branch_id
         FROM loan_documents d
         JOIN loan_applications a ON a.id = d.application_id
        WHERE d.id=$1`,
      [documentId]
    );
    if ((doc.rowCount ?? 0) === 0) throw AppError.notFound("Document not found");
    const d = doc.rows[0]!;
    if (actor.branchId && actor.branchId !== d.branch_id) {
      throw AppError.forbidden("Cannot confirm document in a different branch");
    }
    if (d.confirmed) throw AppError.conflict("Document already confirmed");

    const updated = await db.query<LoanDocumentRow>(
      `UPDATE loan_documents
          SET confirmed=true, confirmed_by=$1, confirmed_at=now()
        WHERE id=$2
        RETURNING id, application_id, doc_type, file_url, uploaded_by, uploaded_at, confirmed, confirmed_by, confirmed_at,
                  file_sha256, file_size_bytes, mime_type`,
      [actor.sub, documentId]
    );
    const confirmedDoc = updated.rows[0]!;
    await auditLoanDocument(
      db, actor.companyId, actor.branchId, actor.sub,
      "loan_document.confirmed", "loan_documents", confirmedDoc.id,
      { confirmed: false },
      { confirmed: true, confirmed_by: confirmedDoc.confirmed_by, confirmed_at: confirmedDoc.confirmed_at },
      null, meta
    );
    return confirmedDoc;
  });
}

/** Record a credit assessment (Credit Assessment stage). */
export async function createCreditAssessment(
  actor: LoanActor,
  input: CreditAssessmentInput,
  meta: ActorMeta = {}
): Promise<CreditAssessmentRow> {
  if (!["approve", "reject", "request_information"].includes(input.decision)) {
    throw AppError.unprocessable("decision must be approve, reject, or request_information");
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw AppError.unprocessable("reason is required");
  }

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const app = await db.query<{ id: string; branch_id: string; chain_id: string }>(
      `SELECT id, branch_id, chain_id FROM loan_applications WHERE id=$1`,
      [input.applicationId]
    );
    if ((app.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    if (actor.branchId && actor.branchId !== app.rows[0]!.branch_id) {
      throw AppError.forbidden("Cannot assess application in a different branch");
    }

    const inserted = await db.query<CreditAssessmentRow>(
      `INSERT INTO credit_assessments (company_id, application_id, assessed_by, decision, reason)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, application_id, assessed_by, decision, reason, created_at`,
      [actor.companyId, input.applicationId, actor.sub, input.decision, input.reason.trim()]
    );
    const assessment = inserted.rows[0]!;
    await auditLoanDocument(
      db, actor.companyId, actor.branchId, actor.sub,
      "credit_assessment.recorded", "credit_assessments", assessment.id,
      null,
      { application_id: assessment.application_id, decision: assessment.decision, reason: assessment.reason },
      input.reason.trim(), meta
    );
    return assessment;
  });
}

/** List credit assessments for an application. */
export async function listCreditAssessments(
  actor: LoanActor,
  applicationId: string
): Promise<CreditAssessmentRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const app = await db.query<{ id: string; branch_id: string }>(
      `SELECT id, branch_id FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((app.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    if (actor.branchId && actor.branchId !== app.rows[0]!.branch_id) {
      throw AppError.forbidden("Cannot access application in a different branch");
    }

    const r = await db.query<CreditAssessmentRow>(
      `SELECT id, application_id, assessed_by, decision, reason, created_at
         FROM credit_assessments WHERE application_id=$1 ORDER BY created_at`,
      [applicationId]
    );
    return r.rows;
  });
}