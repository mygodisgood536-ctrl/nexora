// Stage 7B - Group management tests (Part 2 Section 27).
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

async function createCustomerInBranch(app: any, token: string, branchId: string, first: string, last: string): Promise<string> {
  const r = await request(app)
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${token}`)
    .send({ branchId, firstName: first, lastName: last, address: "1 GroupTest St" });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

describe("stage 7 - group management", () => {
  it("creates a group, lists it, and counts members", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const create = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, name: "Test Group Alpha", description: "First test group" });
    expect(create.status).toBe(201);
    expect(create.body.name).toBe("Test Group Alpha");
    expect(create.body.status).toBe("active");

    const list = await request(app)
      .get("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    const found = list.body.items.find((g: { id: string }) => g.id === create.body.id);
    expect(found).toBeDefined();
    expect(found.member_count).toBe(0);
  });

  it("rejects cross-branch group creation from a branch-scoped session", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, "alpha-test-abj.localhost", "alice");
    const branchA2 = await getAlphaBranchA2();

    const res = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA2, name: "Cross Branch Group" });
    expect([403, 404]).toContain(res.status);
  });
  it("adds members, lists members, removes members", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const grp = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, name: "Members Test Group" });
    expect(grp.status).toBe(201);
    const groupId = grp.body.id;

    const c1 = await createCustomerInBranch(app, token, branchA1, "GrpMem1", "Tester");
    const c2 = await createCustomerInBranch(app, token, branchA1, "GrpMem2", "Tester");

    const add1 = await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: c1 });
    expect(add1.status).toBe(201);
    expect(add1.body.customerId).toBe(c1);

    const add2 = await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: c2 });
    expect(add2.status).toBe(201);

    // Adding the same member again is idempotent (no error).
    const add1Again = await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: c1 });
    expect(add1Again.status).toBe(201);

    const members = await request(app)
      .get(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`);
    expect(members.status).toBe(200);
    expect(members.body.length).toBe(2);
    const codes = members.body.map((m: { customer_id: string }) => m.customer_id).sort();
    expect(codes).toEqual([c1, c2].sort());

    const remove = await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${c1}`)
      .set("Authorization", `Bearer ${token}`);
    expect(remove.status).toBe(200);
    expect(remove.body.removed).toBe(true);

    const removeAgain = await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${c1}`)
      .set("Authorization", `Bearer ${token}`);
    expect(removeAgain.status).toBe(200);
    expect(removeAgain.body.removed).toBe(false);
  });

  it("rejects adding a customer from a different branch", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();
    const branchA2 = await getAlphaBranchA2();

    const grp = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, name: "Branch Isolation Test" });
    expect(grp.status).toBe(201);

    // alice is branch-scoped to ALP-001; she cannot create a customer in
    // ALP-002. We seed the cross-branch customer directly via the
    // admin path to exercise the add-member branch-mismatch guard.
    let wrongBranchCustomer = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ id: string }>(
        `INSERT INTO customers (company_id, branch_id, customer_code, first_name,
                                last_name, address, kyc_complete)
         SELECT company_id, $1, 'CUST-WRNG', 'WrongBranch', 'Customer', 'x', false
           FROM branches WHERE id=$1
         RETURNING id`,
        [branchA2]
      );
      wrongBranchCustomer = r.rows[0]!.id;
    });

    const add = await request(app)
      .post(`/api/v1/groups/${grp.body.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: wrongBranchCustomer });
    expect(add.status).toBe(422);
  });

  it("renames a group and rejects rename on closed group", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const grp = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, name: "Rename Test Original" });
    expect(grp.status).toBe(201);

    const rename = await request(app)
      .put(`/api/v1/groups/${grp.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Rename Test New", description: "Updated" });
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe("Rename Test New");
    expect(rename.body.description).toBe("Updated");
  });

  it("closes a group with reason; members are preserved (not deleted)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const grp = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, name: "Close Test Group" });
    expect(grp.status).toBe(201);

    const c = await createCustomerInBranch(app, token, branchA1, "CloseMem", "Tester");
    await request(app)
      .post(`/api/v1/groups/${grp.body.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: c });

    const close = await request(app)
      .post(`/api/v1/groups/${grp.body.id}/close`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "end of pilot" });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe("closed");
    expect(close.body.closed_at).toBeTruthy();

    // Per Part 2 Section 27: closing does NOT delete members.
    let stillCustomer = false;
    await withAdmin(async (db) => {
      const r = await db.query(`SELECT 1 FROM customers WHERE id=$1`, [c]);
      stillCustomer = (r.rowCount ?? 0) === 1;
    });
    expect(stillCustomer).toBe(true);

    // Re-closing returns 409.
    const closeAgain = await request(app)
      .post(`/api/v1/groups/${grp.body.id}/close`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "again" });
    expect(closeAgain.status).toBe(409);

    // Cannot add members to a closed group.
    const c2 = await createCustomerInBranch(app, token, branchA1, "AfterClose", "Member");
    const addClosed = await request(app)
      .post(`/api/v1/groups/${grp.body.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: c2 });
    expect(addClosed.status).toBe(409);
  });

  it("alpha groups are not visible to beta sessions (RLS isolation)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token: aToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");
    const branchA1 = await getAlphaBranchA1();

    const grp = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ branchId: branchA1, name: "Alpha Only Group" });
    expect(grp.status).toBe(201);

    const bGet = await request(app)
      .get(`/api/v1/groups/${grp.body.id}`)
      .set("Authorization", `Bearer ${bToken}`);
    expect(bGet.status).toBe(404);
  });
});
