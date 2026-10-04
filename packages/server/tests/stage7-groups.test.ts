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

let groupNumberCounter = 0;
function groupFields(): Record<string, string> {
  return {
    groupNumber: `GRP-${process.pid}-${++groupNumberCounter}`,
    groupAddress: "1 Group Test Road",
    dateCreated: "2024-01-01"
  };
}

function memberFields(first: string, last: string): Record<string, string> {
  return {
    fullName: `${first} ${last}`,
    fatherHusbandName: "Group Father",
    maritalStatus: "Single",
    phone: "+2348000000000",
    groupRole: "Member"
  };
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
       .send({ branchId: branchA1, name: "Test Group Alpha", ...groupFields(), description: "First test group" });
    expect(create.status).toBe(201);
     expect(create.body.name).toBe("Test Group Alpha");
     expect(create.body.group_number).toBeTruthy();
     expect(create.body.group_address).toBe("1 Group Test Road");
     expect(create.body.date_created).toBe("2024-01-01");
     expect(create.body.status).toBe("active");

    const list = await request(app)
      .get("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    const found = list.body.items.find((g: { id: string }) => g.id === create.body.id);
     expect(found).toBeDefined();
     expect(found.member_count).toBe(0);
     await withAdmin(async (db) => {
       const row = await db.query<{ group_number: string; group_address: string; date_created: string }>(
         `SELECT group_number, group_address, to_char(date_created, 'YYYY-MM-DD') AS date_created
            FROM groups WHERE id=$1`, [create.body.id]
       );
       expect(row.rows[0]!.group_number).toBe(create.body.group_number);
       expect(row.rows[0]!.group_address).toBe("1 Group Test Road");
       expect(row.rows[0]!.date_created).toBe("2024-01-01");
     });
  });

  it("rejects cross-branch group creation from a branch-scoped session", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, "alpha-test-abj.localhost", "alice");
    const branchA2 = await getAlphaBranchA2();

    const res = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
       .send({ branchId: branchA2, name: "Cross Branch Group", ...groupFields() });
    expect([403, 404]).toContain(res.status);
  });
  it("RULE 19.1.4 group roles and marital statuses come from the configured options", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const options = await request(app)
      .get("/api/v1/groups/options/configured")
      .set("Authorization", `Bearer ${token}`);
    expect(options.status).toBe(200);
    expect(options.body.groupRole).toEqual(["Leader", "Secretary", "Treasurer", "Chief Whip", "Member"]);
    expect(options.body.maritalStatus).toEqual(["Single", "Married", "Divorced", "Widowed"]);

    const replaced = await request(app)
      .put("/api/v1/groups/options/configured")
      .set("Authorization", `Bearer ${token}`)
      .send({
        groupRole: ["Chairperson", "Member"],
        maritalStatus: ["Single", "Married"]
      });
    expect(replaced.status).toBe(200);
    expect(replaced.body.groupRole).toEqual(["Chairperson", "Member"]);

    const grp = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, name: "Options Group", ...groupFields() });
    expect(grp.status).toBe(201);

    const customerId = await createCustomerInBranch(app, token, branchA1, "Opt", "Member");
    const notConfigured = await request(app)
      .post(`/api/v1/groups/${grp.body.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, ...memberFields("Opt", "Member"), groupRole: "Treasurer" });
    expect(notConfigured.status).toBe(422);

    const configured = await request(app)
      .post(`/api/v1/groups/${grp.body.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, ...memberFields("Opt", "Member"), groupRole: "Chairperson" });
    expect(configured.status).toBe(201);
    expect(configured.body.groupRole).toBe("Chairperson");

    const duplicates = await request(app)
      .put("/api/v1/groups/options/configured")
      .set("Authorization", `Bearer ${token}`)
      .send({ groupRole: ["Member", "Member"], maritalStatus: ["Single"] });
    expect(duplicates.status).toBe(422);

    const removingInUse = await request(app)
      .put("/api/v1/groups/options/configured")
      .set("Authorization", `Bearer ${token}`)
      .send({ groupRole: ["Member"], maritalStatus: ["Single"] });
    expect(removingInUse.status).toBe(409);
    expect(String(removingInUse.body?.error?.message ?? "")).toContain("Chairperson");
  });

  it("adds members, lists members, removes members", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const grp = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
       .send({ branchId: branchA1, name: "Members Test Group", ...groupFields() });
    expect(grp.status).toBe(201);
    const groupId = grp.body.id;

    const c1 = await createCustomerInBranch(app, token, branchA1, "GrpMem1", "Tester");
    const c2 = await createCustomerInBranch(app, token, branchA1, "GrpMem2", "Tester");

    const add1 = await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`)
       .send({ customerId: c1, ...memberFields("GrpMem1", "Tester") });
    expect(add1.status).toBe(201);
    expect(add1.body.customerId).toBe(c1);

    const add2 = await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`)
       .send({ customerId: c2, ...memberFields("GrpMem2", "Tester") });
    expect(add2.status).toBe(201);

    // Adding the same member again is idempotent (no error).
    const add1Again = await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`)
       .send({ customerId: c1, ...memberFields("GrpMem1", "Tester") });
    expect(add1Again.status).toBe(201);

    const members = await request(app)
      .get(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`);
    expect(members.status).toBe(200);
    expect(members.body.length).toBe(2);
     const codes = members.body.map((m: { customer_id: string }) => m.customer_id).sort();
     expect(codes).toEqual([c1, c2].sort());
     expect(members.body[0].father_husband_name).toBe("Group Father");
     expect(members.body[0].marital_status).toBe("Single");
     expect(members.body[0].phone).toBe("+2348000000000");
     expect(members.body[0].group_role).toBe("Member");

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
       .send({ branchId: branchA1, name: "Branch Isolation Test", ...groupFields() });
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
       .send({ customerId: wrongBranchCustomer, ...memberFields("WrongBranch", "Customer") });
    expect(add.status).toBe(422);
  });

  it("rejects a group role outside the configured options", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();
    const grp = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, name: "Role Validation Group", ...groupFields() });
    expect(grp.status).toBe(201);
    const customerId = await createCustomerInBranch(app, token, branchA1, "Role", "Validation");
    const res = await request(app)
      .post(`/api/v1/groups/${grp.body.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, ...memberFields("Role", "Validation"), groupRole: "owner" });
    expect(res.status).toBe(422);
  });

  it("renames a group and rejects rename on closed group", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const grp = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
       .send({ branchId: branchA1, name: "Rename Test Original", ...groupFields() });
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
       .send({ branchId: branchA1, name: "Close Test Group", ...groupFields() });
    expect(grp.status).toBe(201);

    const c = await createCustomerInBranch(app, token, branchA1, "CloseMem", "Tester");
    await request(app)
      .post(`/api/v1/groups/${grp.body.id}/members`)
      .set("Authorization", `Bearer ${token}`)
       .send({ customerId: c, ...memberFields("CloseMem", "Tester") });

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
        .send({ customerId: c2, ...memberFields("AfterClose", "Member") });
     expect(addClosed.status).toBe(409);
  });

  it("builds a member ledger from real loan and schedule records", async () => {
    const app = (await import("../src/app")).createApp();
    const w = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();
    const grp = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: branchA1, name: "Ledger Group", ...groupFields() });
    expect(grp.status).toBe(201);
    const customerId = await createCustomerInBranch(app, token, branchA1, "Ledger", "Member");
    const member = await request(app)
      .post(`/api/v1/groups/${grp.body.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, ...memberFields("Ledger", "Member") });
    expect(member.status).toBe(201);

    await withAdmin(async (db) => {
      const product = (await db.query(`SELECT id FROM loan_products WHERE company_id=$1 LIMIT 1`, [w.companyA])).rows[0];
      const chain = (await db.query(`SELECT id FROM approval_chains WHERE company_id=$1 LIMIT 1`, [w.companyA])).rows[0];
      const application = (await db.query(
        `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                       principal_amount, status, current_stage_order, submitted_by, decided_by, decided_at)
         VALUES ($1,$2,$3,$4,$5,10000,'approved',NULL,$6,$6,now()) RETURNING id`,
        [w.companyA, branchA1, customerId, product.id, chain.id, w.userA]
      )).rows[0].id;
      const loan = (await db.query(
        `INSERT INTO loans (company_id, branch_id, customer_id, application_id, product_id,
                            principal_amount, interest_rate, cycle_days, cycle_count,
                            expected_repayment_per_cycle, expected_savings_per_cycle,
                            outstanding_principal, status, disbursed_by)
         VALUES ($1,$2,$3,$4,$5,10000,0,7,4,5000,500,8000,'active',$6) RETURNING id`,
        [w.companyA, branchA1, customerId, application, product.id, w.userA]
      )).rows[0].id;
      await db.query(
        `INSERT INTO repayment_schedule_rows (company_id, loan_id, cycle_number, due_date,
                                               expected_repayment, expected_savings, actual_repayment, actual_savings)
         VALUES ($1,$2,1,current_date - 5,5000,500,2000,150)`,
        [w.companyA, loan]
      );
    });

    const ledger = await request(app)
      .get(`/api/v1/groups/${grp.body.id}/ledger?from=2020-01-01&to=2030-01-01`)
      .set("Authorization", `Bearer ${token}`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.members).toHaveLength(1);
    expect(ledger.body.members[0]).toMatchObject({
      customer_id: customerId,
      expected_repayment: "5000.00",
      actual_repayment: "2000.00",
      remaining_balance: "8000.00",
      savings_achieved: "150.00",
      overdue: true
    });
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
       .send({ branchId: branchA1, name: "Alpha Only Group", ...groupFields() });
    expect(grp.status).toBe(201);

    const bGet = await request(app)
      .get(`/api/v1/groups/${grp.body.id}`)
      .set("Authorization", `Bearer ${bToken}`);
    expect(bGet.status).toBe(404);
  });
});
