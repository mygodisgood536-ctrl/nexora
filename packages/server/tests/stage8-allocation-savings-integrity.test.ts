// Regression test for the silent automatic savings posting in the allocation
// pipeline (RULE 9.1.3, RULE 10.5.1, RULE 19.6.1, Part 15 prohibition 11).
//
// Defect found by independent verification: when a loan had no open repayment
// schedule row, `applyToSchedule` silently credited the ENTIRE payment
// (repayment + savings) to savings, and the caller then ALSO reduced
// outstanding principal by the repayment portion. The same money was counted
// twice, and a repayment was converted into savings without the C.O. ever
// allocating it as savings.
//
// This proves the corrected behaviour against real PostgreSQL:
//   1. a normal allocation against a loan WITH an open cycle posts exactly once
//      and moves savings by exactly the allocated savings portion;
//   2. a loan with NO open schedule row is refused, writes no allocation,
//      savings transaction or principal movement, and the verified payment
//      stays in the C.O.'s queue.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import http from "node:http";
import type { Express } from "express";
import type pg from "pg";
import { seedWorld, withAdmin, withAdminValue } from "./fixtures";
import { staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const SECRET = "settled-signing-secret-0123456789abcd";

let app: Express;
let companyId = "";
let branchA1 = "";
let customerA1 = "";
let openLoanId = "";
let providerApiServer: http.Server;
let runCounter = 0;

function nextRef(): string {
  return `SETTLED-T-${Date.now().toString(36)}${runCounter++}`;
}

function hmacSig(secret: string, ts: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: pg.Client,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** A verified payment for the seeded virtual account, via a correctly signed webhook. */
async function queuePayment(amount: number): Promise<string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    event: "payment.received",
    transaction: { reference: nextRef(), account_number: "1000000001", amount }
  });
  const res = await request(app)
    .post("/api/v1/webhooks/payments/sandbox")
    .set("X-Nexora-Company", "alpha-test")
    .set("X-Nexora-Timestamp", ts)
    .set("X-Nexora-Signature", hmacSig(SECRET, ts, body))
    .set("Content-Type", "application/json")
    .send(body);
  expect(res.status).toBe(200);
  return res.body.outcome.paymentId as string;
}

beforeAll(async () => {
  app = (await import("../src/app")).createApp();
  await seedWorld();

  await withAdmin(async (db) => {
    const c = await q<{ id: string }>(db, `SELECT id FROM companies WHERE slug='alpha-test'`);
    companyId = c[0]!.id;
    const b = await q<{ id: string }>(
      db,
      `SELECT id FROM branches WHERE company_id=$1 AND code='ALP-001'`,
      [companyId]
    );
    branchA1 = b[0]!.id;
    const cust = await q<{ id: string }>(
      db,
      `SELECT id FROM customers WHERE company_id=$1 AND customer_code='CUST-0001'`,
      [companyId]
    );
    customerA1 = cust[0]!.id;
    const loan = await q<{ id: string }>(
      db,
      `SELECT id FROM loans WHERE company_id=$1 AND principal_amount='30000' LIMIT 1`,
      [companyId]
    );
    openLoanId = loan[0]!.id;
  });

  // Real provider endpoint so activation follows a genuine connection test.
  providerApiServer = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => providerApiServer.listen(0, "127.0.0.1", r));
  const addr = providerApiServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

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

  // Part 15 prohibition 19: a provider configuration is never activated without
  // a successful connection test, and the signing secret only becomes usable
  // once it is. A webhook before this must be refused.
  const tested = await request(app)
    .post(`/api/v1/payment-providers/${res.body.id}/test`)
    .set("Authorization", `Bearer ${token}`);
  expect(tested.status).toBe(200);
  expect(tested.body.ok).toBe(true);
  expect(tested.body.activated).toBe(true);
}, 120_000);

afterAll(async () => {
  // Restore the shared world so this file cannot affect any other suite that
  // shares the database: drop the provider/webhook artifacts and settle the
  // schedule rows this test deliberately closed.
  await withAdmin(async (db) => {
    await db.query(
      `DELETE FROM webhook_signing_secrets WHERE company_id=$1`,
      [companyId]
    );
    await db.query(`DELETE FROM payment_provider_configs WHERE company_id=$1`, [companyId]);
    await db.query(
      `DELETE FROM webhook_exceptions WHERE company_id=$1`,
      [companyId]
    );
    await db.query(
      `UPDATE repayment_schedule_rows
          SET paid_at=NULL, actual_repayment=0, actual_savings=0
        WHERE loan_id=$1`,
      [openLoanId]
    );
    await db.query(
      `UPDATE loans SET outstanding_principal='30000', status='active', completed_at=NULL
        WHERE id=$1`,
      [openLoanId]
    );
  });
  await new Promise<void>((r) => providerApiServer.close(() => r()));
});

describe("allocation must never invent savings (RULE 9.1.3 / 10.5.1 / 19.6.1)", () => {
  it("a loan with an open cycle posts exactly once and moves savings by the savings portion only", async () => {
    const paymentId = await queuePayment(3000);
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const before = await withAdminValue(async (db) => {
      const r = await q<{ balance: string }>(
        db,
        `SELECT balance FROM savings_accounts WHERE customer_id=$1`,
        [customerA1]
      );
      return Number(r[0]?.balance ?? 0);
    });

    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId: openLoanId, repaymentAmount: "2000", savingsAmount: "1000" });
    expect(res.status).toBe(200);

    await withAdmin(async (db) => {
      const allocs = await q<{ repayment_amount: string; savings_amount: string }>(
        db,
        `SELECT repayment_amount, savings_amount FROM payment_allocations WHERE payment_id=$1`,
        [paymentId]
      );
      expect(allocs.length).toBe(1);
      expect(Number(allocs[0]!.repayment_amount)).toBe(2000);
      expect(Number(allocs[0]!.savings_amount)).toBe(1000);

      const after = await q<{ balance: string }>(
        db,
        `SELECT balance FROM savings_accounts WHERE customer_id=$1`,
        [customerA1]
      );
      // Savings grew by exactly the allocated savings — the repayment portion
      // was NOT swept into savings.
      expect(Number(after[0]?.balance ?? 0) - before).toBe(1000);
    });
  });

  it("a loan with no open schedule row is refused, writes nothing, and stays queued", async () => {
    // Build the exact precondition: a loan whose every schedule row is settled.
    const targetLoan = openLoanId;
    await withAdmin(async (db) => {
      await db.query(
        `UPDATE repayment_schedule_rows
            SET paid_at=now(),
                actual_repayment=expected_repayment,
                actual_savings=expected_savings
          WHERE loan_id=$1`,
        [targetLoan]
      );
    });

    const open = await withAdminValue(async (db) => {
      const r = await q<{ n: string }>(
        db,
        `SELECT count(*)::text n FROM repayment_schedule_rows
          WHERE loan_id=$1 AND paid_at IS NULL`,
        [targetLoan]
      );
      return parseInt(r[0]!.n, 10);
    });
    expect(open, "precondition: the loan must have no open schedule row").toBe(0);

    const paymentId = await queuePayment(2500);

    const before = await withAdminValue(async (db) => {
      const loan = await q<{ outstanding_principal: string }>(
        db, `SELECT outstanding_principal FROM loans WHERE id=$1`, [targetLoan]
      );
      const sav = await q<{ balance: string }>(
        db, `SELECT balance FROM savings_accounts WHERE customer_id=$1`, [customerA1]
      );
      return {
        outstanding: loan[0]!.outstanding_principal,
        savings: Number(sav[0]?.balance ?? 0)
      };
    });

    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId: targetLoan, repaymentAmount: "2500", savingsAmount: "0" });

    // The system must REFUSE rather than silently resolve the discrepancy.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    await withAdmin(async (db) => {
      const alloc = await q<{ n: string }>(
        db, `SELECT count(*)::text n FROM payment_allocations WHERE payment_id=$1`, [paymentId]
      );
      expect(parseInt(alloc[0]!.n, 10), "no allocation may be written").toBe(0);

      const savTx = await q<{ n: string }>(
        db, `SELECT count(*)::text n FROM savings_transactions WHERE payment_id=$1`, [paymentId]
      );
      expect(parseInt(savTx[0]!.n, 10), "no savings may be credited by a failed allocation").toBe(0);

      const loan = await q<{ outstanding_principal: string }>(
        db, `SELECT outstanding_principal FROM loans WHERE id=$1`, [targetLoan]
      );
      expect(loan[0]!.outstanding_principal, "principal must not move").toBe(before.outstanding);

      const sav = await q<{ balance: string }>(
        db, `SELECT balance FROM savings_accounts WHERE customer_id=$1`, [customerA1]
      );
      expect(Number(sav[0]?.balance ?? 0), "savings must not move").toBe(before.savings);

      const pay = await q<{ status: string }>(
        db, `SELECT status FROM payments WHERE id=$1`, [paymentId]
      );
      expect(pay[0]!.status, "the verified payment stays the C.O.'s to allocate")
        .toBe("pending_allocation");
    });
  });
});

