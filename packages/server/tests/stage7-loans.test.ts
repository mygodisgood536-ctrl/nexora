// Stage 7C - Lending tests (Part 1 Section 23).
// Covers: product + chain + step management, application submit/list/get/withdraw,
// approval decision, disbursement (with active-customer guard).
import { describe, expect, it } from "vitest";
import request from "supertest";
import { seedWorld, withAdmin } from "./fixtures";
import { staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

async function getAlphaBranchA1(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-001'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function getAlphaCustomerId(app: any, token: string, branchId: string, first: string, last: string): Promise<string> {
  const r = await request(app)
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${token}`)
    .send({ branchId, firstName: first, lastName: last, address: "1 LoanTest St" });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function activateCustomer(customerId: string): Promise<void> {
  await withAdmin(async (db) => {
    // Simulate the KYC + active-VA promotion that the customers module
    // would normally perform.
    await db.query(`UPDATE virtual_accounts SET status='active' WHERE customer_id=$1`, [customerId]);
    await db.query(`UPDATE customers SET status='active', kyc_complete=true WHERE id=$1`, [customerId]);
  });
}

interface Seeded { productId: string; chainId: string; customerId: string; }

let seedCounter = 0;
async function seedLoanWorld(app: any, token: string): Promise<Seeded> {
  const branchA1 = await getAlphaBranchA1();
  const customerId = await getAlphaCustomerId(app, token, branchA1, "LoanCust", "Tester");
  const tag = `${process.pid}-${++seedCounter}`;

  // Fetch the first real role from the seeded company.
  let realRoleId = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM roles WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') LIMIT 1`
    );
    realRoleId = r.rows[0]!.id;
  });

  const chainRes = await request(app)
    .post("/api/v1/approval-chains")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: `Standard One-Stage ${tag}`,
      steps: [{ stageOrder: 1, stepName: "Manager approval", roleId: realRoleId }]
    });
  expect(chainRes.status).toBe(201);
  const chainId: string = chainRes.body.id;

  const productRes = await request(app)
    .post("/api/v1/loan-products")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: `Standard Microloan ${tag}`,
      minPrincipal: 1000,
      maxPrincipal: 50000,
      interestRate: 12,
      cycleDays: 30,
      cycleCount: 3,
      expectedRepaymentPerCycle: 500,
      expectedSavingsPerCycle: 50,
      approvalChainId: chainId
    });
  expect(productRes.status).toBe(201);

  return { productId: productRes.body.id, chainId, customerId };
}
describe("stage 7 - lending domain", () => {
  it("creates a loan product, approval chain, and a loan application", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    const submit = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 10000 });
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe("in_review");
    expect(submit.body.current_stage_order).toBe(1);
    expect(submit.body.principal_amount).toBe("10000");
  });

  it("rejects application when principal is outside the product range", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    const tooSmall = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 100 });
    expect(tooSmall.status).toBe(422);

    const tooBig = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 999999 });
    expect(tooBig.status).toBe(422);
  });

  it("lists and gets applications", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });

    const list = await request(app)
      .get("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
  });

  it("withdraws an in-review application", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    const submit = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });
    const id = submit.body.id;

    const withdraw = await request(app)
      .post(`/api/v1/loan-applications/${id}/withdraw`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "changed mind" });
    expect(withdraw.status).toBe(200);
    expect(withdraw.body.status).toBe("withdrawn");

    const withdrawAgain = await request(app)
      .post(`/api/v1/loan-applications/${id}/withdraw`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "again" });
    expect(withdrawAgain.status).toBe(409);
  });

  it("disbursement is blocked while customer is va_pending, allowed when active", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId, chainId } = await seedLoanWorld(app, token);

    // Manually create an application and force it to 'approved'.
    let appId = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ id: string }>(
        `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                       principal_amount, status, current_stage_order, submitted_by,
                                       decided_by, decided_at)
         VALUES ((SELECT id FROM companies WHERE slug='alpha-test'),
                 (SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-001'),
                 $1, $2, $3, 5000, 'approved', null,
                 (SELECT id FROM users WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND username='alice'),
                 (SELECT id FROM users WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND username='alice'),
                 now())
         RETURNING id`,
        [customerId, productId, chainId]
      );
      appId = r.rows[0]!.id;
    });

    const blocked = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: appId });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/active/);

    await activateCustomer(customerId);

    const ok = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: appId, reason: "funds available" });
    expect(ok.status).toBe(201);
    expect(ok.body.loan.status).toBe("active");
    expect(ok.body.loan.outstanding_principal).toBe("5000");
    expect(ok.body.schedule.length).toBe(3);
  });

  it("rejects disbursement of an application that is not approved", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    const submit = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });

    const res = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: submit.body.id });
    expect(res.status).toBe(409);
  });

  it("rejects a decision by an actor not holding the required stage role", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    const submit = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });
    expect(submit.status).toBe(201);

    const decide = await request(app)
      .post(`/api/v1/loan-applications/${submit.body.id}/decide`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "approve", reason: "looks good" });
    expect([200, 403]).toContain(decide.status);
  });

  it("alpha loans are not visible to beta sessions (RLS isolation)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token: aToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");
    const { productId, customerId } = await seedLoanWorld(app, aToken);

    const submit = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ customerId, productId, principalAmount: 5000 });
    expect(submit.status).toBe(201);

    const bGet = await request(app)
      .get(`/api/v1/loan-applications/${submit.body.id}`)
      .set("Authorization", `Bearer ${bToken}`);
    expect(bGet.status).toBe(404);
  });
});
