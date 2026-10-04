// Stage 7E - Accounting statements (Part 1 §21 step [9]; Part 2 §38-39).
// The pipeline posts balanced journals; this suite proves the read surface
// derives those statements exclusively from journal data: General Ledger
// with running balances, an always-balanced Trial Balance, a Cash Book that
// reflects verified electronic movement only, and a Cash Flow Statement
// grouped by journal source. Rows are scoped to the logged-in tenant.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { Express } from "express";
import { seedWorld, withAdmin } from "./fixtures";
import { activateProvider, staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";
const SECRET_A = "alpha-signing-secret-0123456789abcdef";

let runCounter = 0;
function nextRef(prefix: string): string {
  const code = `${Date.now().toString(36)}${runCounter++}${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${code}`;
}

function hmacSig(secret: string, ts: string, bodyString: string): string {
  return crypto.createHmac("sha256", secret).update(`${ts}.${bodyString}`).digest("hex");
}

function postWebhook(app: Express, body: object): request.Test {
  const req = request(app)
    .post("/api/v1/webhooks/payments/sandbox")
    .set("X-Nexora-Company", "alpha-test")
    .set("Content-Type", "application/json");
  const ts = String(Math.floor(Date.now() / 1000));
  req.set("X-Nexora-Timestamp", ts);
  req.set("X-Nexora-Signature", hmacSig(SECRET_A, ts, JSON.stringify(body)));
  req.send(JSON.stringify(body));
  return req;
}

async function alphaCompanyId(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(`SELECT id FROM companies WHERE slug='alpha-test'`);
    id = r.rows[0]!.id;
  });
  return id;
}

async function alphaBranchA1(): Promise<string> {
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

async function alphaLoanId(): Promise<string> {
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

// Wipe every alpha/beta journal artifact company-scoped (not ref-keyed) so the
// statement numbers this suite asserts on are exactly the ones it posted.
// Mirrors stage7-accounting's cleanup so reruns stay deterministic.
async function resetLedgerAndLoan(): Promise<void> {
  await withAdmin(async (db) => {
    await db.query(`
      WITH seeded AS (SELECT id AS company_id FROM companies WHERE slug IN ('alpha-test','beta-test'))
      DELETE FROM journal_lines WHERE journal_entry_id IN (
        SELECT id FROM journal_entries WHERE company_id IN (SELECT company_id FROM seeded)
      )
    `);
    await db.query(`
      WITH seeded AS (SELECT id AS company_id FROM companies WHERE slug IN ('alpha-test','beta-test'))
      DELETE FROM journal_entries WHERE company_id IN (SELECT company_id FROM seeded)
    `);
    await db.query(`
      WITH seeded AS (SELECT id AS company_id FROM companies WHERE slug IN ('alpha-test','beta-test'))
      DELETE FROM journal_entries WHERE company_id IN (SELECT company_id FROM seeded)
    `);
    await db.query(`
      WITH seeded AS (SELECT id AS company_id FROM companies WHERE slug IN ('alpha-test','beta-test'))
      DELETE FROM gl_accounts WHERE company_id IN (SELECT company_id FROM seeded)
    `);
    await db.query(`
      UPDATE payments SET webhook_event_id=NULL
       WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
         AND provider_txn_ref LIKE 'STMT-%'
    `);
    await db.query(`DELETE FROM webhook_events WHERE provider_event_id LIKE 'STMT-%'`);
    await db.query(`DELETE FROM webhook_signing_secrets`);
    await db.query(`DELETE FROM payment_provider_configs`);
    await db.query(`
      UPDATE payments SET webhook_event_id=NULL
       WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
         AND provider_txn_ref LIKE 'STMT-%'
    `);
    for (const tbl of [
      "unmatched_payments",
      "unallocated_payments",
      "payment_allocations",
      "pipeline_jobs",
      "savings_transactions",
      "reconciliation_items",
      "receipts"
    ]) {
      await db.query(
        `DELETE FROM ${tbl} WHERE payment_id IN (
           SELECT id FROM payments
            WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
              AND provider_txn_ref LIKE 'STMT-%')`
      );
    }
    await db.query(`
      DELETE FROM payment_reversals WHERE original_payment_id IN (
        SELECT id FROM payments
         WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
           AND provider_txn_ref LIKE 'STMT-%'
      )
    `);
    await db.query(`
      DELETE FROM payments
       WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
         AND provider_txn_ref LIKE 'STMT-%'
    `);
    await db.query(`
      DELETE FROM savings_transactions WHERE savings_account_id IN (
        SELECT sa.id FROM savings_accounts sa
          JOIN customers c ON c.id=sa.customer_id
         WHERE c.customer_code LIKE 'STMT-TEST-%'
      )
    `);
    await db.query(`
      DELETE FROM savings_accounts WHERE customer_id IN (
        SELECT id FROM customers WHERE customer_code LIKE 'STMT-TEST-%'
      )
    `);
    await db.query(`
      DELETE FROM virtual_accounts WHERE account_number LIKE '555050000%'
    `);
    // Payment/membership notifications reference these customers; clear them
    // before the FK-backed customer delete.
    await db.query(`
      DELETE FROM notifications
       WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
         AND (recipient_customer_id IN (SELECT id FROM customers WHERE customer_code LIKE 'STMT-TEST-%')
              OR payload->>'payment_id' IS NOT NULL)
    `);
    await db.query(`
      DELETE FROM customers WHERE customer_code LIKE 'STMT-TEST-%'
    `);
    // Restore the seeded 30000 alpha loan exactly (seedWorld does not reset
    // loan state, and this file drives a payment against it).
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

async function createSavingsCustomer(): Promise<{ customerId: string }> {
  let out = { customerId: "" };
  await withAdmin(async (db) => {
    const company = await alphaCompanyId();
    const branch = await alphaBranchA1();
    const cust = await db.query<{ id: string }>(
      `INSERT INTO customers (company_id, branch_id, customer_code, first_name,
                              last_name, phone, address, status)
       VALUES ($1,$2,'STMT-TEST-SAVE','Statement','Savings','0000000000','test','active')
       RETURNING id`,
      [company, branch]
    );
    await db.query(
      `INSERT INTO virtual_accounts (company_id, branch_id, customer_id, provider,
                                     bank_name, account_name, account_number, status)
       VALUES ($1,$2,$3,'sandbox','Sandbox Bank','Statement Savings','5550500001','active')`,
      [company, branch, cust.rows[0]!.id]
    );
    out = { customerId: cust.rows[0]!.id };
  });
  return out;
}

beforeAll(async () => {
  const app = (await import("../src/app")).createApp();
  await resetLedgerAndLoan();
  await seedWorld();
  await resetLedgerAndLoan();
  await createSavingsCustomer();

  const { token } = await staffLogin(app, ALPHA_HOST, "amy");
  await activateProvider(app, {
    host: ALPHA_HOST,
    mdUsername: "amy",
    branchId: await alphaBranchA1(),
    signingSecret: SECRET_A
  });

  // Seed the ledger this suite asserts on:
  //   A: 5000 against the active seeded loan  -> DR 1000 5000 / CR 1100 4000 / CR 2100 1000
  //   B: 2000 pure savings                    -> DR 1000 2000 / CR 2100 2000
  //   R: reversal of A                        -> CR 1000 5000 / DR 1100 4000 / DR 2100 1000
  const refA = nextRef("STMT-PAY-A-");
  const a = await postWebhook(app, {
    event: "payment.received",
    transaction: { reference: refA, account_number: "1000000001", amount: 5000 }
  });
  expect(a.status).toBe(200);

  // A lands pending_allocation (active loan); the C.O. posts it so the
  // journal legs (DR 1000 5000 / CR 1100 4000 / CR 2100 1000) are created.
  const paymentAId = a.body.outcome.paymentId as string;
  const allocA = await request(app)
    .post(`/api/v1/payments/${paymentAId}/allocate`)
    .set("Authorization", `Bearer ${token}`)
    .send({ loanId: await alphaLoanId(), repaymentAmount: 4000, savingsAmount: 1000, note: "statements test allocation" });
  expect(allocA.status).toBe(200);

  // B: a 2000 verified payment posted with a pure-savings allocation
  // (Repayment 0 + Savings 2000 = 2000) -> DR 1000 2000 / CR 2100 2000.
  const b = await postWebhook(app, {
    event: "payment.received",
    transaction: { reference: nextRef("STMT-PAY-B-"), account_number: "1000000001", amount: 2000 }
  });
  expect(b.status).toBe(200);
  const paymentBId = b.body.outcome.paymentId as string;
  const allocB = await request(app)
    .post(`/api/v1/payments/${paymentBId}/allocate`)
    .set("Authorization", `Bearer ${token}`)
    .send({ loanId: await alphaLoanId(), repaymentAmount: 0, savingsAmount: 2000, note: "statements savings allocation" });
  expect(allocB.status).toBe(200);

  const r = await postWebhook(app, {
    event: "payment.reversed",
    transaction: { reference: nextRef("STMT-REV-A-"), account_number: "1000000001", amount: 5000 },
    reversal: { original_reference: refA, reason: "statements test reversal" }
  });
  expect(r.status).toBe(200);
  expect(r.body.outcome.kind).toBe("reversed");
});

describe("stage 7E - accounting statements", () => {
  it("trial balance reports account totals and always balances", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .get("/api/v1/accounting/trial-balance")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.balanced).toBe(true);
    expect(res.body.totalDebits).toBe(res.body.totalCredits);
    expect(res.body.totalDebits).toBe("12000.00");

    const byCode = new Map<string, { debits: string; credits: string; balance: string; accountType: string }>(
      res.body.rows.map((row: { code: string; debits: string; credits: string; balance: string; accountType: string }) => [row.code, row])
    );
    const c1000 = byCode.get("1000")!;
    expect(c1000.debits).toBe("7000.00");
    expect(c1000.credits).toBe("5000.00");
    expect(c1000.balance).toBe("2000.00");
    expect(c1000.accountType).toBe("asset");
    const c1100 = byCode.get("1100")!;
    expect(c1100.debits).toBe("4000.00");
    expect(c1100.credits).toBe("4000.00");
    expect(c1100.balance).toBe("0.00");
    const c2100 = byCode.get("2100")!;
    expect(c2100.debits).toBe("1000.00");
    expect(c2100.credits).toBe("3000.00");
    expect(c2100.balance).toBe("-2000.00");
    expect(c2100.accountType).toBe("liability");
  });

  it("general ledger lists every line with account running balances", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .get("/api/v1/accounting/ledger")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const cash = res.body.items.filter(
      (i: { glAccount: { code: string } }) => i.glAccount.code === "1000"
    );
    expect(cash).toHaveLength(3);
    // Chronological: DR 5000, DR 2000, CR 5000 -> running 5000, 7000, 2000.
    expect(cash[0].direction).toBe("debit");
    expect(cash[0].amount).toBe("5000.00");
    expect(cash[0].runningBalance).toBe("5000.00");
    expect(cash[1].direction).toBe("debit");
    expect(cash[1].amount).toBe("2000.00");
    expect(cash[1].runningBalance).toBe("7000.00");
    expect(cash[2].direction).toBe("credit");
    expect(cash[2].amount).toBe("5000.00");
    expect(cash[2].runningBalance).toBe("2000.00");

    const account1000 = res.body.accounts.find(
      (a: { glAccount: { code: string } }) => a.glAccount.code === "1000"
    );
    expect(account1000.debits).toBe("7000.00");
    expect(account1000.credits).toBe("5000.00");
    expect(account1000.balance).toBe("2000.00");
    expect(account1000.glAccount.isCash).toBe(true);
    expect(res.body.totals.debits).toBe("12000.00");
    expect(res.body.totals.credits).toBe("12000.00");

    // Date-bound filtering: a `to` before today leaves the ledger empty.
    const empty = await request(app)
      .get("/api/v1/accounting/ledger")
      .query({ to: "2000-01-01" })
      .set("Authorization", `Bearer ${token}`);
    expect(empty.status).toBe(200);
    expect(empty.body.items).toHaveLength(0);
  });

  it("cash book shows only verified electronic movement on cash accounts", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .get("/api/v1/accounting/cash-book")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    for (const item of res.body.items) {
      expect(item.glAccount.isCash).toBe(true);
      expect(item.glAccount.code).toBe("1000");
    }
    expect(res.body.inflows).toBe("7000.00");
    expect(res.body.outflows).toBe("5000.00");
    expect(res.body.net).toBe("2000.00");

    // No physical cash anywhere: every line traces to a payment reference.
    const refs = res.body.items.map((i: { paymentRef: string | null }) => i.paymentRef);
    expect(refs.every((r: string | null) => r !== null && r.startsWith("STMT-"))).toBe(true);
  });

  it("cash flow statement reconciles opening to closing via journal sources", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .get("/api/v1/accounting/cash-flow")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.openingBalance).toBe("0.00");
    expect(res.body.netCashFlow).toBe("2000.00");
    expect(res.body.closingBalance).toBe("2000.00");

    const bySource = new Map<string, { inflows: string; outflows: string }>(
      res.body.categories.map((c: { source: string; inflows: string; outflows: string }) => [c.source, c])
    );
    expect(bySource.get("payment_pipeline")).toMatchObject({ inflows: "7000.00", outflows: "0.00" });
    expect(bySource.get("reversal")).toMatchObject({ inflows: "0.00", outflows: "5000.00" });
    expect(bySource.get("system")).toBeUndefined();
    expect(res.body.totals.inflows).toBe("7000.00");
    expect(res.body.totals.outflows).toBe("5000.00");
  });

  it("enforces tenant isolation and input validation", async () => {
    const app = (await import("../src/app")).createApp();
    const alphaToken = (await staffLogin(app, ALPHA_HOST, "alice")).token;
    const betaToken = (await staffLogin(app, BETA_HOST, "bob")).token;

    const beta = await request(app)
      .get("/api/v1/accounting/trial-balance")
      .set("Authorization", `Bearer ${betaToken}`);
    expect(beta.status).toBe(200);
    expect(beta.body.rows).toHaveLength(0);
    expect(beta.body.balanced).toBe(true);

    const badDate = await request(app)
      .get("/api/v1/accounting/trial-balance")
      .query({ asOf: "not-a-date" })
      .set("Authorization", `Bearer ${alphaToken}`);
    expect(badDate.status).toBe(400);

    const noAuth = await request(app).get("/api/v1/accounting/ledger");
    expect(noAuth.status).toBe(401);

    const betaLedger = await request(app)
      .get("/api/v1/accounting/ledger")
      .set("Authorization", `Bearer ${betaToken}`);
    expect(betaLedger.status).toBe(200);
    expect(betaLedger.body.items).toHaveLength(0);
  });
});

afterAll(async () => {
  await resetLedgerAndLoan();
});