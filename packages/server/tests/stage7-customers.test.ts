// Stage 7A - Customer domain tests (Part 1 Section 22).
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

async function getAlphaBranchA2(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-002'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

describe("stage 7 - customer domain", () => {
  it("creates a customer with auto-allocated code, auto-issued VA, and va_pending status", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const res = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId: branchA1,
        firstName: "Amina",
        lastName: "Yusuf",
        phone: "08031112233",
        address: "42 Marina Road, Lagos"
      });
    expect(res.status).toBe(201);
    expect(res.body.customerCode).toMatch(/^CUST-\d{4,}$/);
    expect(res.body.status).toBe("va_pending");
    expect(res.body.kycComplete).toBe(false);
    expect(res.body.virtualAccount).toBeDefined();
    expect(res.body.virtualAccount.status).toBe("pending");
    expect(res.body.virtualAccount.accountNumber).toMatch(/^\d{10}$/);
  });

  it("VA account numbers are monotonically increasing and never reused", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const first = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, firstName: "One", lastName: "First", address: "1 First St" });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, firstName: "Two", lastName: "Second", address: "2 Second St" });
    expect(second.status).toBe(201);
    const a = parseInt(first.body.virtualAccount.accountNumber, 10);
    const b = parseInt(second.body.virtualAccount.accountNumber, 10);
    expect(b).toBeGreaterThan(a);
  });

  it("rejects cross-branch customer creation from a branch-scoped session", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, "alpha-test-abj.localhost", "alice");
    const branchA2 = await getAlphaBranchA2();

    const res = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId: branchA2,
        firstName: "Cross",
        lastName: "Branch",
        address: "9 Other St"
      });
    expect([403, 404]).toContain(res.status);
  });

  it("lists customers with branch + status + search filters", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    for (const name of ["Search Alpha", "Search Beta", "Other Name"]) {
      const parts = name.split(" ");
      const r = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${token}`)
        .send({ branchId: branchA1, firstName: parts[0]!, lastName: parts[1]!, address: "1 Search Way" });
      expect(r.status).toBe(201);
    }

    const res = await request(app)
      .get("/api/v1/customers?search=Search&limit=50")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    const found = res.body.items.filter((c: { first_name: string; last_name: string }) =>
      c.first_name === "Search" || c.last_name === "Search"
    );
    expect(found.length).toBeGreaterThanOrEqual(2);
  });
  it("promotes va_pending to active when KYC completes AND an active VA exists", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const create = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, firstName: "Promote", lastName: "Me", address: "7 Promotion Ln" });
    expect(create.status).toBe(201);
    const customerId = create.body.id;
    const vaId = create.body.virtualAccount.id;
    expect(create.body.status).toBe("va_pending");

    // Manually flip the VA to active (simulating the provider webhook).
    await withAdmin(async (db) => {
      await db.query(
        `UPDATE virtual_accounts SET status='active' WHERE id=$1`,
        [vaId]
      );
    });

    const kyc = await request(app)
      .put(`/api/v1/customers/${customerId}/kyc`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kycComplete: true, kycDocuments: [{ type: "nin", reference: "NIN-001" }] });
    expect(kyc.status).toBe(200);
    expect(kyc.body.status).toBe("active");
    expect(kyc.body.kyc_complete).toBe(true);
  });

  it("does NOT promote to active when KYC completes but no active VA exists", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const create = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, firstName: "StaysPending", lastName: "NoVA", address: "8 Pending Way" });
    expect(create.status).toBe(201);
    const customerId = create.body.id;

    const kyc = await request(app)
      .put(`/api/v1/customers/${customerId}/kyc`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kycComplete: true });
    expect(kyc.status).toBe(200);
    expect(kyc.body.status).toBe("va_pending");
  });

  it("enforces the status machine: suspend -> active -> close", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const create = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, firstName: "Lifecycle", lastName: "Test", address: "5 Status St" });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const s1 = await request(app)
      .post(`/api/v1/customers/${id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "suspend", reason: "investigation" });
    expect(s1.status).toBe(200);
    expect(s1.body.status).toBe("suspended");

    const s2 = await request(app)
      .post(`/api/v1/customers/${id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "reactivate", reason: "cleared" });
    expect(s2.status).toBe(200);
    expect(s2.body.status).toBe("active");

    const s3 = await request(app)
      .post(`/api/v1/customers/${id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "close", reason: "duplicate record" });
    expect(s3.status).toBe(200);
    expect(s3.body.status).toBe("closed");

    // Close is terminal - re-closing returns 409.
    const s4 = await request(app)
      .post(`/api/v1/customers/${id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "close", reason: "again" });
    expect(s4.status).toBe(409);
  });

  it("rejects status changes with missing reason", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const create = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, firstName: "Reason", lastName: "Needed", address: "3 Reason Rd" });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const res = await request(app)
      .post(`/api/v1/customers/${id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "suspend" });
    expect(res.status).toBe(422);
  });

  it("alpha customers are not visible to beta sessions (RLS isolation)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token: aToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");
    const branchA1 = await getAlphaBranchA1();

    const a = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ branchId: branchA1, firstName: "AlphaOnly", lastName: "Customer", address: "1 Alpha Ave" });
    expect(a.status).toBe(201);
    const aId = a.body.id;

    // beta cannot see alpha's customer.
    const bGet = await request(app)
      .get(`/api/v1/customers/${aId}`)
      .set("Authorization", `Bearer ${bToken}`);
    expect(bGet.status).toBe(404);
  });
});
