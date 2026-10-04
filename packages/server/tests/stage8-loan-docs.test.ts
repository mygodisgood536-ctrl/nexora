// Stage 7C — Loan Documents + Credit Assessments + on_rejection tests (Part 1 §23, Part 2 §28–31).
// Covers: document upload/list/confirm, credit assessment create/list, on_rejection: return_to_applicant and previous_stage.
import { describe, it, expect, beforeAll } from "vitest";
import { withAdmin } from "./fixtures";
import { randomPrefix, attachVerifiedFaceEvidence } from "./platform-helpers";
import { pool } from "../src/db/pool";
import type pg from "pg";
import {
  uploadDocument,
  listDocuments,
  confirmDocument,
  createCreditAssessment,
  listCreditAssessments,
  type LoanActor,
} from "../src/modules/loans/documents";
import {
  createApplication,
  decideApplication,
  type LoanActor as ServiceLoanActor,
} from "../src/modules/loans/service";

const PREFIX = randomPrefix();

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return pool.query<T>(sql, params);
}

describe("stage 7C - loan documents + credit assessments + on_rejection", () => {
  let alphaCompanyId: string;
  let betaCompanyId: string;
  let aliceId: string;
  let bobId: string;
  let aliceBranchId: string;
  let productId: string;
  let chainId: string;
  let applicationId: string;
  let applicationId2: string;
  let customerId2: string;

  function makeActor(): LoanActor {
    return { sub: aliceId, companyId: alphaCompanyId, branchId: aliceBranchId };
  }

  function makeServiceActor(): ServiceLoanActor {
    return { sub: aliceId, companyId: alphaCompanyId, branchId: null };
  }

  beforeAll(async () => {
    await withAdmin(async (db) => {
      const alpha = await db.query<{ id: string }>(`SELECT id FROM companies WHERE slug='alpha-test'`);
      const beta = await db.query<{ id: string }>(`SELECT id FROM companies WHERE slug='beta-test'`);
      alphaCompanyId = alpha.rows[0]!.id;
      betaCompanyId = beta.rows[0]!.id;

      const aliceUser = await db.query<{ id: string; branch_id: string }>(
        `SELECT id, branch_id FROM users WHERE company_id=$1 AND username='alice'`,
        [alphaCompanyId]
      );
      aliceId = aliceUser.rows[0]!.id;
      aliceBranchId = aliceUser.rows[0]!.branch_id;

      const bobUser = await db.query<{ id: string; branch_id: string }>(
        `SELECT id, branch_id FROM users WHERE company_id=$1 AND username='bob'`,
        [betaCompanyId]
      );
      bobId = bobUser.rows[0]!.id;

      // Create a loan product
      const prod = await db.query<{ id: string }>(
        `INSERT INTO loan_products (company_id, name, min_principal, max_principal, interest_rate,
                                   cycle_days, cycle_count, expected_repayment_per_cycle,
                                   expected_savings_per_cycle, approval_chain_id, is_active)
         VALUES ($1,$2,1000,100000,0.1,30,1,5000,1000,
                 (SELECT id FROM approval_chains WHERE company_id=$1 LIMIT 1), true)
         RETURNING id`,
        [alphaCompanyId, `${PREFIX} Product`]
      );
      productId = prod.rows[0]!.id;

      // Create an approval chain with on_rejection = return_to_applicant
      const chain = await db.query<{ id: string }>(
        `INSERT INTO approval_chains (company_id, name, on_rejection)
         VALUES ($1, $2, 'return_to_applicant')
         RETURNING id`,
        [alphaCompanyId, `${PREFIX} Chain Return`]
      );
      chainId = chain.rows[0]!.id;

      await db.query(
        `INSERT INTO approval_chain_steps (company_id, chain_id, stage_order, step_name, role_id)
         VALUES ($1,$2,1,'Review',(SELECT id FROM roles WHERE company_id=$1 AND role_key='branch_manager' LIMIT 1))`,
        [alphaCompanyId, chainId]
      );

      // Create first application
      const cust = await db.query<{ id: string }>(
        `INSERT INTO customers (company_id, branch_id, customer_code, first_name, last_name, address, status)
         VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING id`,
        [alphaCompanyId, aliceBranchId, `${PREFIX}CUST1`, "Test", "Customer", "123 St"]
      );
      const customerId = cust.rows[0]!.id;

      const app = await db.query<{ id: string }>(
        `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                       principal_amount, status, current_stage_order, submitted_by)
         VALUES ($1,$2,$3,$4,$5,50000,'in_review',1,$6)
         RETURNING id`,
        [alphaCompanyId, aliceBranchId, customerId, productId, chainId, aliceId]
      );
      applicationId = app.rows[0]!.id;

      // Create second application for previous_stage test
      const chain2 = await db.query<{ id: string }>(
        `INSERT INTO approval_chains (company_id, name, on_rejection)
         VALUES ($1, $2, 'previous_stage')
         RETURNING id`,
        [alphaCompanyId, `${PREFIX} Chain Previous`]
      );
      const chainId2 = chain2.rows[0]!.id;

      await db.query(
        `INSERT INTO approval_chain_steps (company_id, chain_id, stage_order, step_name, role_id)
         VALUES ($1,$2,1,'Review',(SELECT id FROM roles WHERE company_id=$1 AND role_key='branch_manager' LIMIT 1)),
                ($1,$2,2,'Credit',(SELECT id FROM roles WHERE company_id=$1 AND role_key='branch_manager' LIMIT 1))`,
        [alphaCompanyId, chainId2]
      );

      const cust2 = await db.query<{ id: string }>(
        `INSERT INTO customers (company_id, branch_id, customer_code, first_name, last_name, address, status)
         VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING id`,
        [alphaCompanyId, aliceBranchId, `${PREFIX}CUST2`, "Test", "Customer2", "123 St"]
      );
      customerId2 = cust2.rows[0]!.id;

      const app2 = await db.query<{ id: string }>(
        `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                       principal_amount, status, current_stage_order, submitted_by)
         VALUES ($1,$2,$3,$4,$5,50000,'in_review',1,$6)
         RETURNING id`,
        [alphaCompanyId, aliceBranchId, customerId2, productId, chainId2, aliceId]
      );
       applicationId2 = app2.rows[0]!.id;
     });
     await attachVerifiedFaceEvidence(
       { sub: aliceId, companyId: alphaCompanyId, branchId: aliceBranchId },
       customerId2,
       applicationId2
     );
   });

  

  it("uploads a document for an application", async () => {
    const doc = await uploadDocument(makeActor(), {
      applicationId,
      docType: "id_card",
      fileUrl: "https://example.com/id_card.pdf",
      fileSha256: "abc123def456",
      fileSizeBytes: 2048,
      mimeType: "application/pdf",
    });
    expect(doc.id).toBeDefined();
    expect(doc.doc_type).toBe("id_card");
    expect(doc.confirmed).toBe(false);
    // Part 20.1.2 / RULE 19.7 — content identity is captured at upload.
    expect(doc.file_sha256).toBe("abc123def456");
    expect(String(doc.file_size_bytes)).toBe("2048");
    expect(doc.mime_type).toBe("application/pdf");
  });

  it("locks the document content identity after upload (immutable evidence)", async () => {
    // RULE 19.7 — rewriting file_url / hash / size / mime on an uploaded
    // document is refused by the 0046 trigger: evidence is immutable.
    await uploadDocument(makeActor(), {
      applicationId,
      docType: "id_card",
      fileUrl: "https://example.com/id_card.pdf",
      fileSha256: "abc123def456",
      fileSizeBytes: 2048,
      mimeType: "application/pdf",
    });
    const docs = await listDocuments(makeActor(), applicationId);
    const doc = docs.find((d) => d.doc_type === "id_card")!;

    let rejected = false;
    try {
      await withAdmin(async (db) => {
        await db.query(
          `UPDATE loan_documents SET file_sha256='tampered' WHERE id=$1`,
          [doc.id]
        );
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    // The original identity survives untouched.
    await withAdmin(async (db) => {
      const r = await db.query<{ file_sha256: string | null }>(
        `SELECT file_sha256 FROM loan_documents WHERE id=$1`, [doc.id]
      );
      expect(r.rows[0]!.file_sha256).toBe("abc123def456");
    });
  });

  it("lists documents for an application", async () => {
    const docs = await listDocuments(makeActor(), applicationId);
    expect(docs.length).toBeGreaterThanOrEqual(1);
    expect(docs[0]!.application_id).toBe(applicationId);
  });

  it("confirms a document", async () => {
    const docs = await listDocuments(makeActor(), applicationId);
    const docId = docs[0]!.id;
    const confirmed = await confirmDocument(makeActor(), docId);
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.confirmed_by).toBe(aliceId);
  });

  it("creates a credit assessment", async () => {
    const assessment = await createCreditAssessment(makeActor(), {
      applicationId,
      decision: "approve",
      reason: "Customer meets all criteria",
    });
    expect(assessment.id).toBeDefined();
    expect(assessment.decision).toBe("approve");
    expect(assessment.reason).toBe("Customer meets all criteria");
  });

  it("lists credit assessments", async () => {
    const assessments = await listCreditAssessments(makeActor(), applicationId);
    expect(assessments.length).toBeGreaterThanOrEqual(1);
    expect(assessments[0]!.decision).toBe("approve");
  });

  it("on_rejection=return_to_applicant sets status to submitted", async () => {
    const serviceActor = makeServiceActor();
    const result = await decideApplication(serviceActor, {
      applicationId,
      decision: "reject",
      reason: "Insufficient income",
    });
    expect(result.status).toBe("submitted");
    expect(result.current_stage_order).toBeNull();
  });

  it("on_rejection=previous_stage moves back one stage", async () => {
    const serviceActor = makeServiceActor();
    // Application starts at stage 1 (Review). First approve to move to stage 2.
    await decideApplication(serviceActor, {
      applicationId: applicationId2,
      decision: "approve",
      reason: "Passed review",
    });
    // Now at stage 2. Reject - should go back to stage 1 (previous_stage).
    const result = await decideApplication(serviceActor, {
      applicationId: applicationId2,
      decision: "reject",
      reason: "Failed credit",
    });
    expect(result.status).toBe("in_review");
    expect(result.current_stage_order).toBe(1);
  });
});