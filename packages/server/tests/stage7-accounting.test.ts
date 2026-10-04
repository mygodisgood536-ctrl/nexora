// Stage 7D - Accounting posts (Part 1 §21 step [9]; Part 2 §38-39).
// Verifies that the payment pipeline writes real, balanced double-entry
// journal records for verified payments (manual C.O. allocation with exact
// equality, provider value dates, reversals) and provisions the company
// chart of accounts idempotently.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { Express } from "express";
import { seedWorld, withAdmin } from "./fixtures";
import { activateProvider, staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const SECRET_A = "alpha-signing-secret-0123456789abcdef";

let providerA: string;

let runCounter = 0;
function nextRef(prefix: string): string {
  const code = `${Date.now().toString(36)}${runCounter++}${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${code}`;
}

async function hmacSig(secret: string, ts: string, bodyString: string): Promise<string> {
  return crypto.createHmac("sha256", secret).update(`${ts}.${bodyString}`).digest("hex");
}

async function postWebhook(app: Express, body: object): Promise<request.Response> {
  const provider = "sandbox";
  const req = request(app)
    .post(`/api/v1/webhooks/payments/${provider}`)
    .set("X-Nexora-Company", "alpha-test")
    .set("Content-Type", "application/json");
  const ts = String(Math.floor(Date.now() / 1000));
  req.set("X-Nexora-Timestamp", ts);
  req.set("X-Nexora-Signature", await hmacSig(SECRET_A, ts, JSON.stringify(body)));
  req.send(JSON.stringify(body));
  return req;
}

async function getAlphaBranchA1(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM branches
        WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-001'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function getCompanyId(slug: string): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(`SELECT id FROM companies WHERE slug=$1`, [slug]);
    id = r.rows[0]!.id;
  });
  return id;
}

async function getActiveLoanId(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT l.id FROM loans l
        JOIN companies c ON c.id=l.company_id
       WHERE c.slug='alpha-test' AND l.principal_amount='30000'
         AND l.status IN ('active','overdue')
       LIMIT 1`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function createVaCustomer(
  accountNumber: string,
  customerCode: string,
  status: string
): Promise<string> {
  let vaId = "";
  await withAdmin(async (db) => {
    const company = await getCompanyId("alpha-test");
    const branch = await getAlphaBranchA1();
    const cust = await db.query<{ id: string }>(
      `INSERT INTO customers (company_id, branch_id, customer_code, first_name,
                              last_name, phone, address, status)
       VALUES ($1,$2,$3,'Accounting','Test','0000000000','test', 'active')
       RETURNING id`,
      [company, branch, customerCode]
    );
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO virtual_accounts (company_id, branch_id, customer_id, provider,
                                     bank_name, account_name, account_number, status)
       VALUES ($1,$2,$3,'sandbox','Sandbox Bank','Accounting Test',$4,$5)
       RETURNING id`,
      [company, branch, cust.rows[0]!.id, accountNumber, status]
    );
    vaId = inserted.rows[0]!.id;
  });
  return vaId;
}

async function journalOf(paymentId: string): Promise<{ id: string; net: string } | null> {
  let out: { id: string; net: string } | null = null;
  await withAdmin(async (db) => {
    const entry = await db.query<{ id: string }>(
      `SELECT id FROM journal_entries WHERE payment_id=$1 AND source='payment_pipeline'
       ORDER BY created_at DESC LIMIT 1`,
      [paymentId]
    );
    if ((entry.rowCount ?? 0) === 0) return;
    const balance = await db.query<{ net: string }>(
      `SELECT COALESCE(SUM(
         CASE WHEN direction='debit' THEN amount ELSE -amount END),0)::text AS net
         FROM journal_lines WHERE journal_entry_id=$1`,
      [entry.rows[0]!.id]
    );
    out = { id: entry.rows[0]!.id, net: balance.rows[0]!.net };
  });
  return out;
}

async function linesOf(entryId: string): Promise<Array<{ code: string; direction: string; amount: string }>> {
  let out: Array<{ code: string; direction: string; amount: string }> = [];
  await withAdmin(async (db) => {
    const r = await db.query<{ code: string; direction: string; amount: string }>(
      `SELECT gl.code, jl.direction, jl.amount
         FROM journal_lines jl
         JOIN gl_accounts gl ON gl.id=jl.gl_account_id
        WHERE jl.journal_entry_id=$1
        ORDER BY gl.code`,
      [entryId]
    );
    out = r.rows;
  });
  return out;
}

/**
 * Complete the C.O. allocation flow for a pending_allocation payment
 * (VERSION 3.2: Loan Repayment + Savings = Verified, exactly).
 */
async function coAllocateAndPost(
  app: Express,
  paymentId: string,
  opts: { repayment: number; savings: number; note?: string }
): Promise<void> {
  const { token } = await staffLogin(app, ALPHA_HOST, "alice");
  const loanId = await getActiveLoanId();
  const alloc = await request(app)
    .post(`/api/v1/payments/${paymentId}/allocate`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      loanId,
      repaymentAmount: opts.repayment,
      savingsAmount: opts.savings,
      note: opts.note ?? "accounting allocation"
    });
  expect(alloc.status).toBe(200);
}

async function cleanupAccounting(): Promise<void> {
  await withAdmin(async (db) => {
    // Journal artifacts are deleted company-scoped (not keyed to ACC- payment
    // refs) so leftovers from model.test's journal-integrity probes and any
    // entry that did not resolve to a payment are removed too.
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test')
      DELETE FROM journal_lines WHERE journal_entry_id IN (
        SELECT id FROM journal_entries WHERE company_id IN (SELECT company_id FROM alpha)
      )
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test')
      DELETE FROM journal_entries WHERE company_id IN (SELECT company_id FROM alpha)
    `);
    await db.query(`
      DELETE FROM unmatched_payments WHERE payment_id IN (
        SELECT id FROM payments
         WHERE provider_txn_ref LIKE 'ACC-PAY-%'
            OR provider_txn_ref LIKE 'ACC-VDT-%'
            OR provider_txn_ref LIKE 'ACC-UNA-%'
      )
    `);
    await db.query(`
      DELETE FROM unallocated_payments WHERE payment_id IN (
        SELECT id FROM payments
         WHERE provider_txn_ref LIKE 'ACC-PAY-%'
            OR provider_txn_ref LIKE 'ACC-VDT-%'
            OR provider_txn_ref LIKE 'ACC-UNA-%'
      )
    `);
    await db.query(`
      DELETE FROM payment_allocations WHERE payment_id IN (
        SELECT id FROM payments
         WHERE provider_txn_ref LIKE 'ACC-PAY-%'
            OR provider_txn_ref LIKE 'ACC-VDT-%'
            OR provider_txn_ref LIKE 'ACC-UNA-%'
      )
    `);
    await db.query(`
      DELETE FROM savings_transactions WHERE payment_id IN (
        SELECT id FROM payments
         WHERE provider_txn_ref LIKE 'ACC-PAY-%'
            OR provider_txn_ref LIKE 'ACC-VDT-%'
            OR provider_txn_ref LIKE 'ACC-UNA-%'
      )
    `);
    await db.query(`
      DELETE FROM pipeline_jobs WHERE payment_id IN (
        SELECT id FROM payments
         WHERE provider_txn_ref LIKE 'ACC-PAY-%'
            OR provider_txn_ref LIKE 'ACC-VDT-%'
            OR provider_txn_ref LIKE 'ACC-UNA-%'
      )
    `);
    await db.query(`
      DELETE FROM reconciliation_items WHERE payment_id IN (
        SELECT id FROM payments
         WHERE provider_txn_ref LIKE 'ACC-PAY-%'
            OR provider_txn_ref LIKE 'ACC-VDT-%'
            OR provider_txn_ref LIKE 'ACC-UNA-%'
      )
    `);
    await db.query(`
      DELETE FROM notifications WHERE payload->>'payment_id' IN (
        SELECT id::text FROM payments
         WHERE provider_txn_ref LIKE 'ACC-PAY-%'
            OR provider_txn_ref LIKE 'ACC-VDT-%'
            OR provider_txn_ref LIKE 'ACC-UNA-%'
      )
    `);
    await db.query(`
      DELETE FROM receipts WHERE payment_id IN (
        SELECT id FROM payments
         WHERE provider_txn_ref LIKE 'ACC-PAY-%'
            OR provider_txn_ref LIKE 'ACC-VDT-%'
            OR provider_txn_ref LIKE 'ACC-UNA-%'
      )
    `);
    // Provisioned chart rows must not survive this file: model.test inserts
    // codes '1000'/'1100' into the same company, so leftovers would trip its
    // UNIQUE (company_id, code) on the next run.
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test')
      DELETE FROM gl_accounts WHERE company_id IN (SELECT company_id FROM alpha)
    `);
    await db.query(`
      UPDATE payments SET webhook_event_id=NULL
       WHERE provider_txn_ref LIKE 'ACC-PAY-%'
          OR provider_txn_ref LIKE 'ACC-VDT-%'
          OR provider_txn_ref LIKE 'ACC-UNA-%'
    `);
    await db.query(`
      DELETE FROM webhook_events WHERE provider_event_id LIKE 'ACC-%'
    `);
    await db.query(`
      DELETE FROM payment_reversals WHERE original_payment_id IN (
        SELECT id FROM payments
         WHERE provider_txn_ref LIKE 'ACC-PAY-%'
            OR provider_txn_ref LIKE 'ACC-VDT-%'
            OR provider_txn_ref LIKE 'ACC-UNA-%'
      )
    `);
    await db.query(`
      DELETE FROM payments
       WHERE provider_txn_ref LIKE 'ACC-PAY-%'
          OR provider_txn_ref LIKE 'ACC-VDT-%'
          OR provider_txn_ref LIKE 'ACC-UNA-%'
    `);
    await db.query(`
      DELETE FROM savings_transactions WHERE savings_account_id IN (
        SELECT sa.id FROM savings_accounts sa
          JOIN customers c ON c.id=sa.customer_id
         WHERE c.customer_code LIKE 'ACC-TEST-%'
      )
    `);
    await db.query(`
      DELETE FROM savings_accounts WHERE customer_id IN (
        SELECT id FROM customers WHERE customer_code LIKE 'ACC-TEST-%'
      )
    `);
    await db.query(`
      DELETE FROM virtual_accounts WHERE account_number LIKE '555000000%'
    `);
    await db.query(`
      DELETE FROM customers WHERE customer_code LIKE 'ACC-TEST-%'
    `);
    // Reset the seeded 30000 loan that the pipeline mutates (seedWorld does
    // not); mirrors the reset in stage7-payments' cleanup so reruns stay
    // deterministic.
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test')
      UPDATE repayment_schedule_rows rsr
         SET actual_repayment=0, actual_savings=0, paid_at=NULL
        FROM loans l, alpha
       WHERE l.id=rsr.loan_id AND l.company_id=alpha.company_id
         AND l.principal_amount='30000'
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test')
      UPDATE loans l
         SET outstanding_principal='30000', status='active', completed_at=NULL
        FROM alpha
       WHERE l.company_id=alpha.company_id AND l.principal_amount='30000'
    `);
  });
}

beforeAll(async () => {
  const app = (await import("../src/app")).createApp();
  // Remove leftovers from prior runs FIRST: seedWorld's rerun path deletes
  // non-seed customers, which orphan payments created by failed runs would
  // otherwise block (payments.customer_id FK).
  await cleanupAccounting();
  await seedWorld();
  await cleanupAccounting();
  providerA = await getAlphaBranchA1();
  await activateProvider(app, {
    host: ALPHA_HOST,
    mdUsername: "amy",
    branchId: providerA,
    signingSecret: SECRET_A
  });
});

describe("stage 7D - accounting posts (step [9])", () => {
  it("posts a balanced GL entry for a verified active-loan payment", async () => {
    const app = (await import("../src/app")).createApp();
    const ref = nextRef("ACC-PAY-");
    const res = await postWebhook(app, {
      event: "payment.received",
      transaction: { reference: ref, account_number: "1000000001", amount: 5000 }
    });
    expect(res.status).toBe(200);
    expect(res.body.outcome.kind).toBe("pending_allocation");
    const paymentId: string = res.body.outcome.paymentId;

    await coAllocateAndPost(app, paymentId, { repayment: 4000, savings: 1000 });

    const journal = await journalOf(paymentId);
    expect(journal).not.toBeNull();
    expect(Number(journal!.net)).toBe(0);

    const lines = await linesOf(journal!.id);
    const byCode = new Map(lines.map((l) => [l.code, l]));
    expect(byCode.get("1000")).toMatchObject({ direction: "debit", amount: "5000.00" });
    expect(byCode.get("1100")).toMatchObject({ direction: "credit", amount: "4000.00" });
    expect(byCode.get("2100")).toMatchObject({ direction: "credit", amount: "1000.00" });
  });

  it("provisions the chart of accounts exactly once across payments", async () => {
    const app = (await import("../src/app")).createApp();
    const company = await getCompanyId("alpha-test");
    const before = await (async () => {
      let n = 0;
      await withAdmin(async (db) => {
        const r = await db.query<{ n: string }>(
          `SELECT count(*)::text n FROM gl_accounts WHERE company_id=$1`,
          [company]
        );
        n = parseInt(r.rows[0]!.n, 10);
      });
      return n;
    })();
    // RULE 11.6.1 — the chart carries asset, liability, equity and income
    // accounts so an income statement and a financial position can be derived:
    // 1000 Collection, 1100 Loan Receivables, 2100 Customer Savings,
    // 3000 Retained Earnings, 4000 Interest Income.
    expect(before).toBe(5);

    const ref = nextRef("ACC-PAY-");
    const res = await postWebhook(app, {
      event: "payment.received",
      transaction: { reference: ref, account_number: "1000000001", amount: 5000 }
    });
    expect(res.status).toBe(200);

    let after = before;
    await withAdmin(async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text n FROM gl_accounts WHERE company_id=$1`,
        [company]
      );
      after = parseInt(r.rows[0]!.n, 10);
    });
    // Idempotent: processing a payment must not add another set of accounts.
    expect(after).toBe(5);
  });

  it("records a no-loan deposit as an unallocated exception, never crediting savings", async () => {
    const app = (await import("../src/app")).createApp();
    await createVaCustomer("5550000001", "ACC-TEST-SAVE", "active");
    const ref = nextRef("ACC-PAY-");
    const res = await postWebhook(app, {
      event: "payment.received",
      transaction: { reference: ref, account_number: "5550000001", amount: 2000 }
    });
    expect(res.status).toBe(200);
    // VERSION 3.2 — no savings-only flow: a customer with no active loan to
    // allocate against cannot have its payment posted, so the funds land in
    // the unallocated exception queue and never reach savings.
    expect(res.body.outcome.kind).toBe("unallocated");
    const paymentId: string = res.body.outcome.paymentId;

    const journal = await journalOf(paymentId);
    expect(journal).toBeNull();

    let exceptionCount = 0;
    await withAdmin(async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text n FROM unallocated_payments WHERE payment_id=$1`,
        [paymentId]
      );
      exceptionCount = parseInt(r.rows[0]!.n, 10);
    });
    expect(exceptionCount).toBe(1);
  });

  it("carries the provider value date into the journal entry date", async () => {
    const app = (await import("../src/app")).createApp();
    const ref = nextRef("ACC-VDT-");
    const res = await postWebhook(app, {
      event: "payment.received",
      transaction: {
        reference: ref,
        account_number: "1000000001",
        amount: 5000,
        timestamp: "2024-05-10T09:30:00Z"
      }
    });
    expect(res.status).toBe(200);
    const paymentId: string = res.body.outcome.paymentId;

    await coAllocateAndPost(app, paymentId, { repayment: 4000, savings: 1000 });

    let entryDate = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ entry_date: string }>(
        `SELECT to_char(entry_date,'YYYY-MM-DD') AS entry_date
           FROM journal_entries WHERE payment_id=$1`,
        [paymentId]
      );
      entryDate = r.rows[0]!.entry_date;
    });
    expect(entryDate).toBe("2024-05-10");
  });

  it("posts the journal for manual allocation with a large savings portion", async () => {
    const app = (await import("../src/app")).createApp();
    const ref = nextRef("ACC-UNA-");
    const webhook = await postWebhook(app, {
      event: "payment.received",
      transaction: { reference: ref, account_number: "1000000001", amount: 5000 }
    });
    expect(webhook.status).toBe(200);
    expect(webhook.body.outcome.kind).toBe("pending_allocation");
    const paymentId: string = webhook.body.outcome.paymentId;

    // VERSION 3.2 — exact equality: Loan Repayment + Savings = Verified.
    // The C.O. chose 1000 to the loan and 4000 to the customer's savings.
    const loanId = await getActiveLoanId();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const alloc = await request(app)
      .post(`/api/v1/payments/${paymentId}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId, repaymentAmount: 1000, savingsAmount: 4000, note: "accounting test" });
    expect(alloc.status).toBe(200);
    expect(alloc.body.ok).toBe(true);

    const journal = await journalOf(paymentId);
    expect(journal).not.toBeNull();
    expect(Number(journal!.net)).toBe(0);
    const lines = await linesOf(journal!.id);
    const byCode = new Map(lines.map((l) => [l.code, l]));
    expect(byCode.get("1000")).toMatchObject({ direction: "debit", amount: "5000.00" });
    expect(byCode.get("1100")).toMatchObject({ direction: "credit", amount: "1000.00" });
    expect(byCode.get("2100")).toMatchObject({ direction: "credit", amount: "4000.00" });

    // The 4000 remainder really landed in the loan owner's savings account.
    let savingsCredit = 0;
    await withAdmin(async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text n FROM savings_transactions
          WHERE payment_id=$1 AND direction='credit' AND amount=4000`,
        [paymentId]
      );
      savingsCredit = parseInt(r.rows[0]!.n, 10);
    });
    expect(savingsCredit).toBe(1);
  });

  it("mirrors a provider reversal in a linked reversal journal entry", async () => {
    const app = (await import("../src/app")).createApp();
    const loanId = await getActiveLoanId();
    let beforeOutstanding = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ outstanding_principal: string }>(
        `SELECT outstanding_principal::text FROM loans WHERE id=$1`,
        [loanId]
      );
      beforeOutstanding = r.rows[0]!.outstanding_principal;
    });

    const ref = nextRef("ACC-PAY-");
    const res = await postWebhook(app, {
      event: "payment.received",
      transaction: { reference: ref, account_number: "1000000001", amount: 5000 }
    });
    expect(res.status).toBe(200);
    expect(res.body.outcome.kind).toBe("pending_allocation");
    const paymentId: string = res.body.outcome.paymentId;

    await coAllocateAndPost(app, paymentId, { repayment: 4000, savings: 1000 });

    const original = await journalOf(paymentId);
    expect(original).not.toBeNull();
    expect(Number(original!.net)).toBe(0);

    // The seeded loan's schedules are shared across sequential tests, so
    // assert against the row this payment wound onto (captured before the
    // reversal) rather than absolute zeroes.
    let rowId: string | null = null;
    let preRow: { ar: number; asv: number } | null = null;
    await withAdmin(async (db) => {
      const r = await db.query<{ schedule_row_id: string | null }>(
        `SELECT schedule_row_id FROM payment_allocations WHERE payment_id=$1 LIMIT 1`,
        [paymentId]
      );
      rowId = r.rows[0]?.schedule_row_id ?? null;
    });
    expect(rowId).not.toBeNull();
    await withAdmin(async (db) => {
      const r = await db.query<{ ar: string; asv: string }>(
        `SELECT actual_repayment::text ar, actual_savings::text asv
           FROM repayment_schedule_rows WHERE id=$1`,
        [rowId!]
      );
      preRow = { ar: Number(r.rows[0]!.ar), asv: Number(r.rows[0]!.asv) };
    });

    const revRes = await postWebhook(app, {
      event: "payment.reversed",
      transaction: { reference: nextRef("ACC-REV-"), account_number: "1000000001", amount: 5000 },
      reversal: { original_reference: ref, reason: "accounting reversal test" }
    });
    expect(revRes.status).toBe(200);
    expect(revRes.body.outcome.kind).toBe("reversed");

    let revEntry: { id: string; reversal_of_entry_id: string | null } | null = null;
    await withAdmin(async (db) => {
      const r = await db.query<{ id: string; reversal_of_entry_id: string | null }>(
        `SELECT id, reversal_of_entry_id FROM journal_entries
          WHERE payment_id=$1 AND source='reversal'`,
        [paymentId]
      );
      revEntry = r.rows[0] ?? null;
    });
    expect(revEntry).not.toBeNull();
    // §21: the reversal links back to the original and never edits it.
    expect(revEntry!.reversal_of_entry_id).toBe(original!.id);

    // Mirrored lines: every debit/credit swapped, same amounts.
    const revLines = await linesOf(revEntry!.id);
    expect(revLines.reduce((net, l) => net + (l.direction === "debit" ? 1 : -1) * Number(l.amount), 0)).toBe(0);
    const rb = new Map(revLines.map((l) => [l.code, l]));
    expect(rb.get("1000")).toMatchObject({ direction: "credit", amount: "5000.00" });
    expect(rb.get("1100")).toMatchObject({ direction: "debit", amount: "4000.00" });
    expect(rb.get("2100")).toMatchObject({ direction: "debit", amount: "1000.00" });

    // The original entry is byte-for-byte unchanged.
    const origLines = await linesOf(original!.id);
    const ob = new Map(origLines.map((l) => [l.code, l]));
    expect(ob.get("1000")).toMatchObject({ direction: "debit", amount: "5000.00" });
    expect(ob.get("1100")).toMatchObject({ direction: "credit", amount: "4000.00" });
    expect(ob.get("2100")).toMatchObject({ direction: "credit", amount: "1000.00" });

    // Ledger fully reversed: loan restored to its pre-payment outstanding,
    // and the exact schedule row unwound by precisely what this payment
    // applied.
    let outstanding = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ outstanding_principal: string }>(
        `SELECT outstanding_principal::text FROM loans WHERE id=$1`,
        [loanId]
      );
      outstanding = r.rows[0]!.outstanding_principal;
    });
    expect(outstanding).toBe(beforeOutstanding);

    let postRow: { ar: number; asv: number } | null = null;
    await withAdmin(async (db) => {
      const r = await db.query<{ ar: string; asv: string }>(
        `SELECT actual_repayment::text ar, actual_savings::text asv
           FROM repayment_schedule_rows WHERE id=$1`,
        [rowId!]
      );
      postRow = { ar: Number(r.rows[0]!.ar), asv: Number(r.rows[0]!.asv) };
    });
    expect(postRow).not.toBeNull();
    expect(postRow!.ar).toBe(preRow!.ar - 4000);
    expect(postRow!.asv).toBe(preRow!.asv - 1000);
  });

  it("links the webhook event to the tenant and the payment it produced", async () => {
    const app = (await import("../src/app")).createApp();
    const company = await getCompanyId("alpha-test");
    const ref = nextRef("ACC-PAY-");
    const res = await postWebhook(app, {
      event: "payment.received",
      transaction: { reference: ref, account_number: "1000000001", amount: 5000 }
    });
    expect(res.status).toBe(200);
    expect(res.body.outcome.kind).toBe("pending_allocation");
    const paymentId: string = res.body.outcome.paymentId;

    let ev: { company_id: string | null; payment_id: string | null } | null = null;
    await withAdmin(async (db) => {
      const r = await db.query<{ company_id: string | null; payment_id: string | null }>(
        `SELECT company_id, payment_id FROM webhook_events WHERE provider_event_id=$1`,
        [ref]
      );
      ev = r.rows[0] ?? null;
    });
    expect(ev).not.toBeNull();
    expect(ev!.company_id).toBe(company);
    expect(ev!.payment_id).toBe(paymentId);

    // Reverse pointer on the payment (Payment -> Webhook).
    let webhookEventId: string | null = null;
    await withAdmin(async (db) => {
      const r = await db.query<{ webhook_event_id: string | null }>(
        `SELECT webhook_event_id FROM payments WHERE id=$1`,
        [paymentId]
      );
      webhookEventId = r.rows[0]!.webhook_event_id;
    });
    expect(webhookEventId).not.toBeNull();

    // A reversal webhook links back to the ORIGINAL payment, not a new one.
    const revRef = nextRef("ACC-REV-");
    const revRes = await postWebhook(app, {
      event: "payment.reversed",
      transaction: { reference: revRef, account_number: "1000000001", amount: 5000 },
      reversal: { original_reference: ref, reason: "traceability test" }
    });
    expect(revRes.status).toBe(200);
    expect(revRes.body.outcome.kind).toBe("reversed");
    let revEv: { company_id: string | null; payment_id: string | null } | null = null;
    await withAdmin(async (db) => {
      const r = await db.query<{ company_id: string | null; payment_id: string | null }>(
        `SELECT company_id, payment_id FROM webhook_events WHERE provider_event_id=$1`,
        [revRef]
      );
      revEv = r.rows[0] ?? null;
    });
    expect(revEv).not.toBeNull();
    expect(revEv!.company_id).toBe(company);
    expect(revEv!.payment_id).toBe(paymentId);
  });
});

// Leave the DB clean when this file finishes so the next suite's seedWorld
// rerun does not hit orphan payments on non-seed customers (TableTest gets
// no afterAll of its own from the framework).
afterAll(async () => {
  await cleanupAccounting();
});