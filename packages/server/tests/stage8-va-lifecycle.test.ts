// Stage 7A - Virtual Account lifecycle tests (Part 1 Section 22, as
// overridden: VA is issued at loan disbursement). VAs used here are
// provisioned via disbursement (see stage7-loans / stage8-customer-portal)
// or inserted directly to exercise the lifecycle endpoints: activation
// transition (pending -> active), provider-forced replacement, automatic
// retry, and the terminal close with open-loan guard.
import { describe, expect, it } from "vitest";
import request from "supertest";
import { seedWorld, withAdmin } from "./fixtures";
import { staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

let seq = 1000;

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

async function getAlphaCompanyId(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM companies WHERE slug='alpha-test'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

/** Create a customer via the API (active, no VA yet). */
async function createCustomer(app: any, token: string, branchId: string, first: string, last: string): Promise<string> {
  const r = await request(app)
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${token}`)
    .send({ branchId, firstName: first, lastName: last, address: "1 VA Way" });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

/** Insert a VA directly (simulating a disbursement-issued VA). */
async function insertVa(
  customerId: string,
  status: "pending" | "active" = "active"
): Promise<string> {
  const accountNumber = `3000000${seq++}`;
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO virtual_accounts (company_id, branch_id, customer_id, provider,
                                     bank_name, account_name, account_number, status)
       VALUES ((SELECT company_id FROM customers WHERE id=$1),
               (SELECT branch_id FROM customers WHERE id=$1),
               $1, 'sandbox', 'Nexora Sandbox Bank', 'Test Customer', $2, $3)
       RETURNING id`,
      [customerId, accountNumber, status]
    );
    id = r.rows[0]!.id;
  });
  return id;
}

describe("stage 7 - virtual account lifecycle", () => {
  it("activate transitions a pending disbursed VA to active; KYC stays active", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const mdToken = (await staffLogin(app, ALPHA_HOST, "amy")).token;
    const branchA1 = await getAlphaBranchA1();

    const customerId = await createCustomer(app, token, branchA1, "Vera", "Okonkwo");
    const vaId = await insertVa(customerId, "pending");

    const act = await request(app)
      .post(`/api/v1/virtual-accounts/${vaId}/activate`)
      .set("Authorization", `Bearer ${mdToken}`);
    expect(act.status).toBe(200);
    expect(act.body.status).toBe("active");

    const kyc = await request(app)
      .put(`/api/v1/customers/${customerId}/kyc`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kycComplete: true, kycDocuments: [{ type: "nin", reference: "NIN-VA-1" }] });
    expect(kyc.status).toBe(200);
    expect(kyc.body.status).toBe("active");
  });

  it("rejects activating an already-active or replaced VA (409), and 404s for another company", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const mdToken = (await staffLogin(app, ALPHA_HOST, "amy")).token;
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");
    const branchA1 = await getAlphaBranchA1();

    const customerId = await createCustomer(app, token, branchA1, "Twice", "Activator");
    const vaId = await insertVa(customerId, "active");

    // Already-active (issued at disbursement): cannot be activated again.
    const first = await request(app)
      .post(`/api/v1/virtual-accounts/${vaId}/activate`)
      .set("Authorization", `Bearer ${mdToken}`);
    expect(first.status).toBe(409);

    const second = await request(app)
      .post(`/api/v1/virtual-accounts/${vaId}/activate`)
      .set("Authorization", `Bearer ${mdToken}`);
    expect(second.status).toBe(409);

    // Cross-company isolation: beta cannot see alpha's VA.
    const cross = await request(app)
      .get(`/api/v1/virtual-accounts/${vaId}`)
      .set("Authorization", `Bearer ${bToken}`);
    expect(cross.status).toBe(404);

    // A random uuid is a 404, not a crash.
    const missing = await request(app)
      .get("/api/v1/virtual-accounts/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });

  it("lists a customer's VA history (old replaced + current active)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const mdToken = (await staffLogin(app, ALPHA_HOST, "amy")).token;
    const branchA1 = await getAlphaBranchA1();

    const customerId = await createCustomer(app, token, branchA1, "Historic", "Accounts");
    const vaId = await insertVa(customerId, "active");

    const rep = await request(app)
      .post("/api/v1/virtual-accounts/replace")
      .set("Authorization", `Bearer ${mdToken}`)
      .send({ customerId });
    expect(rep.status).toBe(200);
    expect(rep.body.previous.status).toBe("replaced");
    expect(rep.body.current.status).toBe("active");
    expect(rep.body.current.customer_id).toBe(customerId);
    expect(rep.body.current.account_number).not.toBe(rep.body.previous.account_number);

    const list = await request(app)
      .get(`/api/v1/virtual-accounts?customerId=${customerId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(2);
    const statuses = list.body.map((v: { status: string }) => v.status).sort();
    expect(statuses).toEqual(["active", "replaced"]);
    // The old account is preserved, never deleted.
    expect(list.body.some((v: { id: string; status: string }) => v.id === vaId && v.status === "replaced")).toBe(true);
  });

  it("automatic retry resolves pending VAs (provider-outage recovery)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const customerId = await createCustomer(app, token, branchA1, "Pending", "Retry");
    const vaId = await insertVa(customerId, "pending");

    const companyId = await getAlphaCompanyId();
    const { retryPendingVirtualAccounts } = await import("../src/modules/customers/service");
    const activated = await retryPendingVirtualAccounts(companyId);
    expect(activated).toBeGreaterThanOrEqual(1);

    const list = await request(app)
      .get(`/api/v1/virtual-accounts?customerId=${customerId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.body[0].status).toBe("active");
    expect(list.body[0].id).toBe(vaId);
  });

  it("closes a VA with a reason (terminal), and blocks close while loans are open", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const mdToken = (await staffLogin(app, ALPHA_HOST, "amy")).token;
    const branchA1 = await getAlphaBranchA1();

    const customerId = await createCustomer(app, token, branchA1, "Closing", "Sequence");
    const vaId = await insertVa(customerId, "pending");
    await request(app)
      .post(`/api/v1/virtual-accounts/${vaId}/activate`)
      .set("Authorization", `Bearer ${mdToken}`);

    const noReason = await request(app)
      .post(`/api/v1/virtual-accounts/${vaId}/close`)
      .set("Authorization", `Bearer ${mdToken}`)
      .send({});
    expect(noReason.status).toBe(422);

    const closed = await request(app)
      .post(`/api/v1/virtual-accounts/${vaId}/close`)
      .set("Authorization", `Bearer ${mdToken}`)
      .send({ reason: "customer left the program" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");

    const again = await request(app)
      .post(`/api/v1/virtual-accounts/${vaId}/close`)
      .set("Authorization", `Bearer ${mdToken}`)
      .send({ reason: "again" });
    expect(again.status).toBe(409);

    // A new customer whose VA is active, but who holds an open loan,
    // cannot have their payment destination closed.
    const c2Id = await createCustomer(app, token, branchA1, "Locked", "Loan");
    const c2Va = await insertVa(c2Id, "pending");
    await request(app)
      .post(`/api/v1/virtual-accounts/${c2Va}/activate`)
      .set("Authorization", `Bearer ${mdToken}`);

    await withAdmin(async (db) => {
      const product = await db.query<{ id: string }>(
        `SELECT id FROM loan_products WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') LIMIT 1`
      );
      const chain = await db.query<{ id: string }>(
        `SELECT id FROM approval_chains WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') LIMIT 1`
      );
      const user = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') LIMIT 1`
      );
      const appRow = await db.query<{ id: string }>(
        `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                        principal_amount, status, submitted_by)
         VALUES ((SELECT company_id FROM customers WHERE id=$1), $2, $1, $3, $4, 1000, 'approved', $5)
         RETURNING id`,
        [c2Id, branchA1, product.rows[0]!.id, chain.rows[0]!.id, user.rows[0]!.id]
      );
      await db.query(
        `INSERT INTO loans (company_id, branch_id, customer_id, application_id, product_id,
                            principal_amount, interest_rate, cycle_days, cycle_count,
                            expected_repayment_per_cycle, expected_savings_per_cycle,
                            outstanding_principal, status, disbursed_by)
         VALUES ((SELECT company_id FROM customers WHERE id=$1), $2, $1, $3, $4, 1000, 0,
                 30, 4, 250, 50, 1000, 'active', $5)`,
        [c2Id, branchA1, appRow.rows[0]!.id, product.rows[0]!.id, user.rows[0]!.id]
      );
    });

    const blocked = await request(app)
      .post(`/api/v1/virtual-accounts/${c2Va}/close`)
      .set("Authorization", `Bearer ${mdToken}`)
      .send({ reason: "close attempt with open loan" });
    expect(blocked.status).toBe(409);
  });
});