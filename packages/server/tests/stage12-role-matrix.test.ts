import { describe, it, expect } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { seedWorld, withAdmin, withAdminValue, type TestWorld } from "./fixtures";
import { staffLogin, completeProfile } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const SEED_HASH = bcrypt.hashSync(process.env.SEED_PASSWORD ?? "TestPassword!123", 8);

/**
 * RULE 5.5 / 6.3 / 6.4 / 6.5 / 6.6 / 7.x - the role matrix.
 *
 * Each row is a real session for a worker who holds exactly ONE role, so the
 * answer is about that role's own authority and not about a second assignment
 * widening it. Every surface is a real route with the real middleware chain:
 * an allowed row must not be refused, and a refused row must arrive as an
 * explicit 403 naming the missing permission.
 */
describe("role permission matrix", () => {
  async function makeSingleRoleUser(
    app: Express,
    w: TestWorld,
    roleKey: string,
    username: string,
    firstName: string
  ): Promise<string> {
    const { token: mdToken } = await staffLogin(app, ALPHA_HOST, "amy");
    const created = await request(app)
      .post("/api/v1/workers")
      .set("Authorization", `Bearer ${mdToken}`)
      .send({
        firstName,
        lastName: username,
        branchId: w.branchA1,
        roleKey,
        scopeType: "single_branch",
        branchIds: [w.branchA1]
      });
    expect(created.status, `create ${roleKey} probe: ${JSON.stringify(created.body)}`).toBe(201);
    const userId = created.body.id as string;
    // RULE 5.1.1 - the username is the full name, so the probe logs in as that.
    const fullName = created.body.username as string;
    await withAdmin(async (db) => {
      await db.query(
        `UPDATE users SET must_change_password=false, credential_state='secured',
                          totp_secret_encrypted='x', totp_verified_at=now(),
                          temp_password_expires_at=NULL, password_hash=$2
          WHERE id=$1`,
        [userId, SEED_HASH]
      );
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", ALPHA_HOST)
      .send({ username: fullName, password: process.env.SEED_PASSWORD ?? "TestPassword!123" });
    expect(login.status, `login ${fullName}`).toBe(200);
    return login.body.accessToken as string;
  }

  it("each role reaches exactly the surfaces its authority covers", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();

    const co = await makeSingleRoleUser(app, w, "collection_officer", `probe${Date.now()}co`, "Co");
    const md = await staffLogin(app, ALPHA_HOST, "amy").then((r) => r.token);
    const auditor = await staffLogin(app, ALPHA_HOST, "audrey").then((r) => r.token);
    const finance = await staffLogin(app, ALPHA_HOST, "fiona").then((r) => r.token);
    const hr = await staffLogin(app, ALPHA_HOST, "harry").then((r) => r.token);

    const probe = `probe${Date.now()}`;
    const newCustomer = {
      branchId: w.branchA1,
      firstName: "Matrix",
      lastName: `${probe}x`,
      address: "1 Matrix Road",
      ...completeProfile({ identificationNumber: `ID-MATRIX-${probe}` })
    };
    const newGroup = {
      branchId: w.branchA1,
      name: `Matrix Group ${probe}`,
      groupNumber: `GRP-MX-${probe}`,
      groupAddress: "1 Matrix Road",
      dateCreated: "2024-01-01"
    };
    const newWorker = {
      firstName: "Made",
      lastName: `${probe}y`,
      branchId: w.branchA1,
      roleKey: "collection_officer",
      scopeType: "single_branch",
      branchIds: [w.branchA1]
    };
    const providerBody = {
      branchId: w.branchA1,
      provider: "sandbox",
      apiBaseUrl: "https://sandbox.example/",
      apiKey: "12345678",
      signingSecret: "1234567890123456"
    };
    const allocateBody = {
      loanId: w.loanA1,
      repaymentAmount: 1000,
      savingsAmount: 0
    };
    // A real verified, pending payment so the allocation rows test authority
    // rather than a missing record.
    const pendingPaymentId = await withAdminValue(async (db) => {
      const va = (await db.query<{ id: string }>(
        `SELECT id FROM virtual_accounts WHERE company_id=$1 AND status='active' LIMIT 1`,
        [w.companyA]
      )).rows[0]!;
      return (await db.query<{ id: string }>(
        `INSERT INTO payments (company_id, branch_id, customer_id, virtual_account_id,
                               provider, provider_txn_ref, amount, status, received_at, value_date)
         VALUES ($1,$2,$3,$4,'sandbox',$5,1000,'pending_allocation',now(),current_date)
         RETURNING id`,
        [w.companyA, w.branchA1, w.customerA1, va.id, `matrix-alloc-${probe}`]
      )).rows[0]!.id;
    });

    interface Case {
      role: string;
      token: string;
      method: "get" | "post" | "put" | "patch" | "delete";
      path: string;
      body?: Record<string, unknown>;
      allow: boolean;
      why: string;
    }

    const cases: Case[] = [
      // Reading the customer book
      { role: "co", token: co, method: "get", path: "/api/v1/customers", allow: true, why: "RULE 19.1: the C.O. works the customer book" },
      { role: "auditor", token: auditor, method: "get", path: "/api/v1/customers", allow: true, why: "RULE 6.5.1: unlimited read" },
      { role: "finance", token: finance, method: "get", path: "/api/v1/customers", allow: true, why: "RULE 6.6.1: Finance reads the book" },
      { role: "hr", token: hr, method: "get", path: "/api/v1/customers", allow: true, why: "RULE 6.4.1: HR must know the customer book" },

      // Registering a customer
      { role: "co", token: co, method: "post", path: "/api/v1/customers", body: newCustomer, allow: true, why: "RULE 19.1: the C.O. registers the customer" },
      { role: "md", token: md, method: "post", path: "/api/v1/customers", body: newCustomer, allow: true, why: "RULE 6.3.2: the MD can always create" },
      { role: "auditor", token: auditor, method: "post", path: "/api/v1/customers", body: newCustomer, allow: false, why: "RULE 6.5.2: the Auditor edits nothing" },
      { role: "finance", token: finance, method: "post", path: "/api/v1/customers", body: newCustomer, allow: false, why: "RULE 6.6.1: Finance never enters a customer record" },
      { role: "hr", token: hr, method: "post", path: "/api/v1/customers", body: newCustomer, allow: false, why: "RULE 6.4.3: HR is people, not customers" },

      // Operating the savings group book
      { role: "co", token: co, method: "post", path: "/api/v1/groups", body: newGroup, allow: true, why: "RULE 19.1: the C.O. runs the group" },
      { role: "hr", token: hr, method: "post", path: "/api/v1/groups", body: newGroup, allow: false, why: "RULE 6.4.3: HR never acts on money" },
      { role: "auditor", token: auditor, method: "post", path: "/api/v1/groups", body: newGroup, allow: false, why: "RULE 6.5.2: the Auditor edits nothing" },

      // Allocating a verified payment. A real pending payment is created so the
      // only thing being tested is authority, not payload.
      { role: "co", token: co, method: "get", path: "/api/v1/payments/pending", allow: true, why: "RULE 6.6: the C.O. allocates verified payments" },
      { role: "finance", token: finance, method: "get", path: "/api/v1/payments/pending", allow: true, why: "RULE 6.6.1: Finance reconciles payments" },
      { role: "finance", token: finance, method: "post", path: `/api/v1/payments/${pendingPaymentId}/allocate`, body: allocateBody, allow: false, why: "RULE 6.6.1: Finance cannot enter or edit an allocation" },
      { role: "hr", token: hr, method: "post", path: `/api/v1/payments/${pendingPaymentId}/allocate`, body: allocateBody, allow: false, why: "RULE 6.4.3: HR can never act on money" },
      { role: "auditor", token: auditor, method: "post", path: `/api/v1/payments/${pendingPaymentId}/allocate`, body: allocateBody, allow: false, why: "RULE 6.5.2: the Auditor edits nothing" },
      { role: "md", token: md, method: "post", path: `/api/v1/payments/${pendingPaymentId}/allocate`, body: allocateBody, allow: true, why: "RULE 6.6.2: the MD holds the whole book" },

      // Company performance views
      { role: "auditor", token: auditor, method: "get", path: "/api/v1/reports/summary", allow: true, why: "RULE 6.5.1: the Auditor reads reports" },
      { role: "finance", token: finance, method: "get", path: "/api/v1/reports/summary", allow: true, why: "RULE 6.6.1: Finance produces the statements" },
      { role: "co", token: co, method: "get", path: "/api/v1/reports/summary", allow: false, why: "RULE 12.0.2: a C.O. has no company performance view" },
      { role: "co", token: co, method: "get", path: "/api/v1/reports/branches", allow: false, why: "RULE 12.0.2: the branch table is not a C.O. page" },
      { role: "hr", token: hr, method: "get", path: "/api/v1/reports/summary", allow: false, why: "RULE 6.4.3: HR has no performance table" },

      // People operations
      { role: "hr", token: hr, method: "get", path: "/api/v1/workers", allow: true, why: "RULE 6.4.1: HR knows who works here" },
      { role: "hr", token: hr, method: "post", path: "/api/v1/workers", body: newWorker, allow: true, why: "RULE 6.3.1: HR creates credentials" },
      { role: "md", token: md, method: "post", path: "/api/v1/workers", body: newWorker, allow: true, why: "RULE 6.3.1: the MD creates credentials" },
      { role: "co", token: co, method: "post", path: "/api/v1/workers", body: newWorker, allow: false, why: "RULE 6.3.1: creation follows the MD, then HR" },
      { role: "auditor", token: auditor, method: "post", path: "/api/v1/workers", body: newWorker, allow: false, why: "RULE 6.5.2: the Auditor creates nothing" },
      { role: "finance", token: finance, method: "post", path: "/api/v1/workers", body: newWorker, allow: false, why: "RULE 6.6.1: Finance never touches HR records" },

      // Portfolio controls (RULE 5.8.1)
      { role: "hr", token: hr, method: "post", path: `/api/v1/workers/${w.userA}/portfolio/hold`, body: { reason: "matrix probe" }, allow: true, why: "RULE 5.8.1: HR holds a portfolio" },
      { role: "md", token: md, method: "post", path: `/api/v1/workers/${w.userA}/portfolio/hold`, body: { reason: "matrix probe" }, allow: true, why: "RULE 5.8.1: the MD holds a portfolio" },
      { role: "co", token: co, method: "post", path: `/api/v1/workers/${w.userA}/portfolio/hold`, body: { reason: "matrix probe" }, allow: false, why: "RULE 5.8.1: the control is HR and MD only" },
      { role: "auditor", token: auditor, method: "post", path: `/api/v1/workers/${w.userA}/portfolio/hold`, body: { reason: "matrix probe" }, allow: false, why: "RULE 6.5.2: the Auditor acts on nothing" },
      { role: "finance", token: finance, method: "post", path: `/api/v1/workers/${w.userA}/portfolio/hold`, body: { reason: "matrix probe" }, allow: false, why: "RULE 6.6.1: Finance never touches HR records" },

      // Provider configuration (RULE 6.6.2)
      { role: "md", token: md, method: "post", path: "/api/v1/payment-providers", body: providerBody, allow: true, why: "RULE 6.6.2: the MD configures providers" },
      { role: "co", token: co, method: "post", path: "/api/v1/payment-providers", body: providerBody, allow: false, why: "RULE 6.6.2: only Finance, GM, MD, Deputy MD" },
      { role: "hr", token: hr, method: "post", path: "/api/v1/payment-providers", body: providerBody, allow: false, why: "RULE 6.6.2: HR never configures providers" },
      { role: "auditor", token: auditor, method: "post", path: "/api/v1/payment-providers", body: providerBody, allow: false, why: "RULE 6.5.2: the Auditor edits nothing" },

      // Recovery and consistency (RULE 20.6)
      { role: "md", token: md, method: "get", path: "/api/v1/recovery/checks", allow: true, why: "RULE 20.6: the MD sees recovery runs" },
      { role: "auditor", token: auditor, method: "get", path: "/api/v1/recovery/checks", allow: true, why: "RULE 6.5.5: the Auditor sees inconsistency" },
      { role: "co", token: co, method: "post", path: "/api/v1/recovery/checks/referential-integrity", allow: false, why: "RULE 20.6.1: running a check writes a run record" },

      // Company AI (RULE 21.1)
      { role: "auditor", token: auditor, method: "get", path: "/api/v1/company-ai/capabilities", allow: true, why: "RULE 21.1.1: the AI runs as the caller" },
      { role: "co", token: co, method: "get", path: "/api/v1/company-ai/capabilities", allow: true, why: "RULE 21.1.1: any authorised member may ask" },
      { role: "hr", token: hr, method: "get", path: "/api/v1/company-ai/capabilities", allow: true, why: "RULE 21.1.1: any authorised member may ask" }
    ];

    const results: string[] = [];
    for (const testCase of cases) {
      const call = (request(app) as unknown as Record<string, ((p: string) => { set(k: string, v: string): { send(b?: unknown): { status: number; body: unknown } } }) | undefined>)[testCase.method];
      const res = await call!(testCase.path)
        .set("Authorization", `Bearer ${testCase.token}`)
        .send(testCase.body ?? {});
      const refused = res.status === 403;
      if (testCase.allow) {
        expect(
          refused,
          `${testCase.role} ${testCase.method.toUpperCase()} ${testCase.path} was refused (${res.status}) - ${testCase.why}`
        ).toBe(false);
      } else {
        expect(
          refused,
          `${testCase.role} ${testCase.method.toUpperCase()} ${testCase.path} returned ${res.status} instead of 403 - ${testCase.why}`
        ).toBe(true);
        const body = res.body as { error?: { message?: string } };
        expect(
          String(body?.error?.message ?? ""),
          `${testCase.role} ${testCase.path} refusal is not explained`
        ).toMatch(/Missing permission/i);
      }
      results.push(`${testCase.role} ${testCase.method.toUpperCase()} ${testCase.path} -> ${res.status}`);
    }
    // eslint-disable-next-line no-console
    console.log("ROLE_MATRIX_RESULTS\n" + results.join("\n"));

    const customers = await withAdminValue(async (db) =>
      Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n)
    );
    expect(customers).toBeGreaterThan(0);
  });
});
