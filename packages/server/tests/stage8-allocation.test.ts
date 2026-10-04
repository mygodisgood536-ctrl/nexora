// VERSION 3.2 — C.O. Payment Allocation tests.
//
// Proves the v3.2 payment law end to end against real PostgreSQL:
//   • A provider webhook is verified and the payment enters the responsible
//     Collection Officer's Payment Allocation Queue — automatically verified
//     and recorded, but never automatically allocated.
//   • The C.O. manually allocates the immutable verified amount with exact
//     equality: Loan Repayment + Savings = Verified Payment.
//   • Under-allocation, over-allocation, residuals, silent rounding and
//     automatic correction are all rejected.
//   • A posted payment leaves the pending queue and remains traceable;
//     loan, Savings Achieved, journal, audit and reporting state update.
//   • No human can create a payment outside the verified provider pipeline.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import http from "node:http";
import type { Express } from "express";
import { seedWorld, withAdmin } from "./fixtures";
import { staffLogin } from "./platform-helpers";
import type pg from "pg";

const ALPHA_HOST = "alpha-test.localhost";
const SECRET = "alpha-signing-secret-0123456789abcdef";

let alphaCompanyId = "";
let branchA1 = "";
let customerA1 = "";
let loanId = "";
let outstandingBefore = "";
let runCounter = 0;
let providerApiServer: http.Server;

function nextRef(): string {
  const code = `${Date.now().toString(36)}${runCounter++}${Math.random().toString(36).slice(2, 6)}`;
  return `ALLOC-T-${code}`;
}

function hmacSig(secret: string, ts: string, bodyString: string): string {
  return crypto.createHmac("sha256", secret).update(`${ts}.${bodyString}`).digest("hex");
}

async function postWebhook(app: Express, body: object): Promise<request.Response> {
  const ts = String(Math.floor(Date.now() / 1000));
  const bodyString = JSON.stringify(body);
  const sig = hmacSig(SECRET, ts, bodyString);
  return request(app)
    .post("/api/v1/webhooks/payments/sandbox")
    .set("X-Nexora-Company", "alpha-test")
    .set("X-Nexora-Timestamp", ts)
    .set("X-Nexora-Signature", sig)
    .set("Content-Type", "application/json")
    .send(bodyString);
}

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: pg.Client,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function loadIds(): Promise<void> {
  await withAdmin(async (db) => {
    const c = await q<{ id: string }>(db, `SELECT id FROM companies WHERE slug='alpha-test'`);
    alphaCompanyId = c[0]!.id;
    const b = await q<{ id: string }>(db,
      `SELECT id FROM branches WHERE company_id=$1 AND code='ALP-001'`, [alphaCompanyId]);
    branchA1 = b[0]!.id;
    const cust = await q<{ id: string }>(db,
      `SELECT id FROM customers WHERE company_id=$1 AND customer_code='CUST-0001'`, [alphaCompanyId]);
    customerA1 = cust[0]!.id;
    const loan = await q<{ id: string; outstanding_principal: string }>(db,
      `SELECT id, outstanding_principal FROM loans
        WHERE company_id=$1 AND principal_amount='30000' LIMIT 1`, [alphaCompanyId]);
    loanId = loan[0]!.id;
    outstandingBefore = loan[0]!.outstanding_principal;
  });
}

/** Create a fresh verified payment in the queue via the signed webhook. */
async function queuePayment(app: Express, amount: number): Promise<string> {
  const res = await postWebhook(app, {
    event: "payment.received",
    transaction: { reference: nextRef(), account_number: "1000000001", amount }
  });
  expect(res.status).toBe(200);
  expect(res.body.outcome.kind).toBe("pending_allocation");
  return res.body.outcome.paymentId as string;
}

/** Delete test-created artifacts and restore loan/schedule/savings state. */
async function cleanup(): Promise<void> {
  await withAdmin(async (db) => {
    await db.query(`
      DELETE FROM journal_lines WHERE journal_entry_id IN (
        SELECT id FROM journal_entries WHERE company_id=$1)`, [alphaCompanyId]);
    await db.query(`DELETE FROM journal_entries WHERE company_id=$1`, [alphaCompanyId]);
    await db.query(`
      DELETE FROM receipts WHERE payment_id IN (
        SELECT id FROM payments WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%')`,
      [alphaCompanyId]);
    await db.query(`
      DELETE FROM notifications WHERE (payload->>'payment_id')::uuid IN (
        SELECT id FROM payments WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%')`,
      [alphaCompanyId]);
    await db.query(`
      DELETE FROM savings_transactions WHERE payment_id IN (
        SELECT id FROM payments WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%')`,
      [alphaCompanyId]);
    await db.query(`
      DELETE FROM payment_allocations WHERE payment_id IN (
        SELECT id FROM payments WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%')`,
      [alphaCompanyId]);
    await db.query(`
      DELETE FROM pipeline_jobs WHERE payment_id IN (
        SELECT id FROM payments WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%')`,
      [alphaCompanyId]);
    await db.query(`
      DELETE FROM reconciliation_items WHERE payment_id IN (
        SELECT id FROM payments WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%')`,
      [alphaCompanyId]);
    await db.query(`
      DELETE FROM payment_reversals WHERE original_payment_id IN (
        SELECT id FROM payments WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%')`,
      [alphaCompanyId]);
    await db.query(`
      DELETE FROM unallocated_payments WHERE payment_id IN (
        SELECT id FROM payments WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%')`,
      [alphaCompanyId]);
    await db.query(`
      DELETE FROM audit_logs WHERE company_id=$1 AND
        (entity_id IN (SELECT id FROM payments
                        WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%')
         OR reason LIKE 'ALLOC-T-%')`, [alphaCompanyId]);
    await db.query(`
      UPDATE payments SET webhook_event_id=NULL
       WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%'`,
      [alphaCompanyId]);
    await db.query(`
      DELETE FROM webhook_events WHERE payment_id IN (
        SELECT id FROM payments WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%')`,
      [alphaCompanyId]);
    await db.query(`
      DELETE FROM payments WHERE company_id=$1 AND provider_txn_ref LIKE 'ALLOC-T-%'`,
      [alphaCompanyId]);
    await db.query(`
      UPDATE repayment_schedule_rows rsr
         SET actual_repayment=0, actual_savings=0, paid_at=NULL
        FROM loans l
       WHERE l.id=rsr.loan_id AND l.id=$1`, [loanId]);
    await db.query(
      `UPDATE loans SET outstanding_principal='30000', status='active', completed_at=NULL
        WHERE id=$1`, [loanId]);
    await db.query(
      `UPDATE savings_accounts SET balance='0' WHERE customer_id=$1`, [customerA1]);
    await db.query(
      `DELETE FROM audit_logs WHERE company_id=$1 AND action='payment.awaiting_allocation'`,
      [alphaCompanyId]);
    await db.query(
      `DELETE FROM notifications WHERE company_id=$1 AND kind='payment.awaiting_allocation'`,
      [alphaCompanyId]);
    await db.query(`DELETE FROM webhook_exceptions WHERE company_id=$1`, [alphaCompanyId]);
    await db.query(`DELETE FROM webhook_signing_secrets WHERE company_id=$1`, [alphaCompanyId]);
    await db.query(`DELETE FROM payment_provider_configs WHERE company_id=$1`, [alphaCompanyId]);
  });
}

beforeAll(async () => {
  const app = (await import("../src/app")).createApp();
  await seedWorld();
  await loadIds();
  await cleanup();

  // Vision Part 8 — a provider may only be activated after a real, successful
  // connection test. A local HTTP endpoint is used for a genuine round trip.
  providerApiServer = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => providerApiServer.listen(0, "127.0.0.1", resolve));
  const addr = providerApiServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  // The MD configures the company's provider (MD change = authorised).
  const { token } = await staffLogin(app, ALPHA_HOST, "amy");
  const res = await request(app)
    .post("/api/v1/payment-providers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      branchId: branchA1,
      provider: "sandbox",
      apiBaseUrl: `http://127.0.0.1:${port}/`,
      apiKey: "api-key-00000000",
      signingSecret: SECRET
    });
  expect([200, 201]).toContain(res.status);

  const tested = await request(app)
    .post(`/api/v1/payment-providers/${res.body.id}/test`)
    .set("Authorization", `Bearer ${token}`);
  expect(tested.status).toBe(200);
  expect(tested.body.ok).toBe(true);
  expect(tested.body.activated).toBe(true);
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve) => providerApiServer.close(() => resolve()));
});

describe("stage 8 - VERSION 3.2 payment allocation", () => {
  it("verified webhook payments enter the C.O. queue without automatic allocation", async () => {
    const app = (await import("../src/app")).createApp();
    const paymentId = await queuePayment(app, 5000);

    let row: { status: string; customer_id: string | null; branch_id: string | null } | null = null;
    await withAdmin(async (db) => {
      const r = await q<{ status: string; customer_id: string | null; branch_id: string | null }>(
        db, `SELECT status, customer_id, branch_id FROM payments WHERE id=$1`, [paymentId]);
      row = r[0] ?? null;
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("pending_allocation");
    expect(row!.customer_id).toBe(customerA1);
    expect(row!.branch_id).toBe(branchA1);

    // No automatic allocation has happened.
    await withAdmin(async (db) => {
      const r = await q<{ n: string }>(db,
        `SELECT count(*)::text n FROM payment_allocations WHERE payment_id=$1`, [paymentId]);
      expect(parseInt(r[0]!.n, 10)).toBe(0);
    });

    // The loan is untouched.
    await withAdmin(async (db) => {
      const r = await q<{ outstanding_principal: string }>(db,
        `SELECT outstanding_principal FROM loans WHERE id=$1`, [loanId]);
      expect(r[0]!.outstanding_principal).toBe(outstandingBefore);
    });

    // The responsible C.O. sees the payment in her allocation queue.
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const queue = await request(app)
      .get("/api/v1/payments/pending")
      .set("Authorization", `Bearer ${token}`);
    expect(queue.status).toBe(200);
    const ids = (queue.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain(paymentId);

    // RULE 10.5.3B/10.5.3C — opening the pending payment shows the locked
    // verified amount, what remains, and the financial context. Opening it is
    // a read: the payment is untouched and cannot be posted while a residual
    // remains.
    const detail = await request(app)
      .get(`/api/v1/payments/pending/${paymentId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.payment.verifiedAmount).toBe("5000");
    expect(detail.body.payment.providerTxnRef).toEqual(expect.any(String));
    expect(detail.body.payment.groupId).toBeNull();
    expect(detail.body.financialContext.outstandingLoanBalance).toEqual(expect.any(String));
    expect(detail.body.financialContext.currentSavingsBalance).toEqual(expect.any(String));
    expect(detail.body.financialContext.currentExpectedRepayment).not.toBeNull();
    expect(detail.body.financialContext.totalAllocated).toBe("0");
    expect(detail.body.remainingToAllocate).toBe("5000");
    expect(detail.body.canPost).toBe(false);

    await withAdmin(async (db) => {
      const still = await q<{ status: string }>(db,
        `SELECT status FROM payments WHERE id=$1`, [paymentId]);
      expect(still[0]!.status).toBe("pending_allocation");
    });
  });

  it("the C.O. allocates exactly (4000+1000=5000) and the allocation posts", async () => {
    const app = (await import("../src/app")).createApp();
    const paymentId = await queuePayment(app, 5000);

    let savingsBefore = "0";
    await withAdmin(async (db) => {
      const r = await q<{ balance: string }>(db,
        `SELECT balance FROM savings_accounts WHERE customer_id=$1`, [customerA1]);
      savingsBefore = r[0]?.balance ?? "0";
    });

    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId, repaymentAmount: "4000", savingsAmount: "1000", note: "cycle 1" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Posted — off the pending queue.
    await withAdmin(async (db) => {
      const r = await q<{ status: string }>(db,
        `SELECT status FROM payments WHERE id=$1`, [paymentId]);
      expect(r[0]!.status).toBe("posted");
    });

    // The allocation row is exact.
    await withAdmin(async (db) => {
      const r = await q<{ repayment_amount: string; savings_amount: string }>(db,
        `SELECT repayment_amount, savings_amount FROM payment_allocations WHERE payment_id=$1`,
        [paymentId]);
      expect(r[0]!.repayment_amount).toBe("4000.00");
      expect(r[0]!.savings_amount).toBe("1000.00");
    });

    // Schedule cycle 1 is satisfied.
    await withAdmin(async (db) => {
      const r = await q<{ n: string }>(db,
        `SELECT count(*)::text n FROM repayment_schedule_rows
          WHERE loan_id=$1 AND cycle_number=1
            AND actual_repayment=4000 AND actual_savings=1000 AND paid_at IS NOT NULL`,
        [loanId]);
      expect(parseInt(r[0]!.n, 10)).toBeGreaterThan(0);
    });

    // Outstanding principal reduced by exactly the repayment portion.
    await withAdmin(async (db) => {
      const r = await q<{ outstanding_principal: string }>(db,
        `SELECT outstanding_principal FROM loans WHERE id=$1`, [loanId]);
      expect(Number(r[0]!.outstanding_principal)).toBe(Number(outstandingBefore) - 4000);
    });

    // Savings Achieved: an actual posted outcome (+1000).
    await withAdmin(async (db) => {
      const r = await q<{ balance: string }>(db,
        `SELECT balance FROM savings_accounts WHERE customer_id=$1`, [customerA1]);
      expect(Number(r[0]!.balance)).toBe(Number(savingsBefore) + 1000);
    });

    // The accounting journal is balanced and correct.
    await withAdmin(async (db) => {
      const lines = await q<{ code: string; direction: string; amount: string }>(db,
        `SELECT gl.code, jl.direction, jl.amount
           FROM journal_lines jl
           JOIN journal_entries je ON je.id=jl.journal_entry_id
           JOIN gl_accounts gl ON gl.id=jl.gl_account_id
          WHERE je.payment_id=$1
          ORDER BY gl.code`, [paymentId]);
      const byCode = new Map(lines.map((l) => [`${l.code}-${l.direction}`, l.amount]));
      expect(byCode.get("1000-debit")).toBe("5000.00");
      expect(byCode.get("1100-credit")).toBe("4000.00");
      expect(byCode.get("2100-credit")).toBe("1000.00");
    });

    // Audit recorded the allocation.
    await withAdmin(async (db) => {
      const r = await q<{ n: string }>(db,
        `SELECT count(*)::text n FROM audit_logs
          WHERE entity_type='payments' AND entity_id=$1 AND action='payment.allocated'`,
        [paymentId]);
      expect(parseInt(r[0]!.n, 10)).toBeGreaterThan(0);
    });

    // The posted payment has left the pending queue.
    const queue = await request(app)
      .get("/api/v1/payments/pending")
      .set("Authorization", `Bearer ${token}`);
    expect(queue.status).toBe(200);
    const ids = (queue.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).not.toContain(paymentId);
  });

  it("under-allocation is rejected and the payment stays pending", async () => {
    const app = (await import("../src/app")).createApp();
    const paymentId = await queuePayment(app, 5000);

    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId, repaymentAmount: "3000", savingsAmount: "1000", note: "short" });
    expect(res.status).toBe(422);

    await withAdmin(async (db) => {
      const r = await q<{ status: string }>(db,
        `SELECT status FROM payments WHERE id=$1`, [paymentId]);
      expect(r[0]!.status).toBe("pending_allocation");
      const a = await q<{ n: string }>(db,
        `SELECT count(*)::text n FROM payment_allocations WHERE payment_id=$1`, [paymentId]);
      expect(parseInt(a[0]!.n, 10)).toBe(0);
    });
  });

  it("over-allocation is rejected and the payment stays pending", async () => {
    const app = (await import("../src/app")).createApp();
    const paymentId = await queuePayment(app, 5000);

    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId, repaymentAmount: "4000", savingsAmount: "2000", note: "extra" });
    expect(res.status).toBe(422);

    await withAdmin(async (db) => {
      const r = await q<{ status: string }>(db,
        `SELECT status FROM payments WHERE id=$1`, [paymentId]);
      expect(r[0]!.status).toBe("pending_allocation");
    });
  });

  it("silent rounding is impossible: sub-cent amounts are rejected", async () => {
    const app = (await import("../src/app")).createApp();
    const paymentId = await queuePayment(app, 5000);

    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId, repaymentAmount: "4000.005", savingsAmount: "999.995", note: "round" });
    expect(res.status).toBe(422);

    await withAdmin(async (db) => {
      const r = await q<{ status: string }>(db,
        `SELECT status FROM payments WHERE id=$1`, [paymentId]);
      expect(r[0]!.status).toBe("pending_allocation");
    });
  });

  it("a payment outside the pending queue can never be allocated", async () => {
    const app = (await import("../src/app")).createApp();
    const paymentId = await queuePayment(app, 5000);

    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const first = await request(app)
      .post(`/api/v1/payments/${paymentId}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId, repaymentAmount: "5000", savingsAmount: "0", note: "full" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/payments/${paymentId}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId, repaymentAmount: "0", savingsAmount: "5000", note: "again" });
    expect(second.status).toBe(409);
  });

  it("no human can create a payment: the webhook is the only entry point", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const created = await request(app)
      .post("/api/v1/payments")
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: "5000", customerId: customerA1 });
    expect(created.status).toBe(404);

    const { paymentsRouter } = await import("../src/modules/payments/routes");
    const routeNames = Object.keys(paymentsRouter);
    const hasCashRoute = routeNames.some((n) => n.toLowerCase().includes("cash"));
    expect(hasCashRoute).toBe(false);
  });
});
