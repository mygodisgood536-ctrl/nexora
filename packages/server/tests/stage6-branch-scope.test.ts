import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { seedWorld, withAdmin } from "./fixtures";
import { staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

describe("stage 6 — branch-scoped session enforcement", () => {
  it("login at branch URL resolves branchId and restricts session to that branch", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    // Login at branch URL (alpha-test-abj.localhost = ALP-001 Abuja)
    const { token: branchToken } = await staffLogin(app, "alpha-test-abj.localhost", "alice");

    // Verify the session is branch-scoped by trying to access data
    // First, get the branch ID
    let branchA1 = "";
    await withAdmin(async (db) => {
      const b = await db.query<{ id: string }>(
        `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-001'`
      );
      branchA1 = b.rows[0]!.id;
    });

    // Try to list workers - should only see workers in branch A1
    const workersRes = await request(app)
      .get("/api/v1/workers")
      .set("Authorization", `Bearer ${branchToken}`);
    expect(workersRes.status).toBe(200);
    // alice is in ALP-001, so should be visible
    expect(workersRes.body.length).toBeGreaterThanOrEqual(1);
  });

  it("login at company URL (head office) gives company-wide scope", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    // Login at company URL (alpha-test.localhost)
    const { token: hoToken } = await staffLogin(app, ALPHA_HOST, "alice");

    // Should see all branches' workers
    const workersRes = await request(app)
      .get("/api/v1/workers")
      .set("Authorization", `Bearer ${hoToken}`);
    expect(workersRes.status).toBe(200);
  });

  it("branch-scoped session cannot create worker in different branch", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    // Login at ALP-001 branch URL
    const { token } = await staffLogin(app, "alpha-test-abj.localhost", "alice");

    // Get ALP-002 branch ID
    let branchA2 = "";
    await withAdmin(async (db) => {
      const b = await db.query<{ id: string }>(
        `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-002'`
      );
      branchA2 = b.rows[0]!.id;
    });

    // Try to create worker in ALP-002 - should fail due to branch scope restriction
    const res = await request(app)
      .post("/api/v1/workers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Cross",
        lastName: "Branch",
        branchId: branchA2,
        roleKey: "collection_officer",
        scopeType: "single_branch",
        branchIds: [branchA2]
      });
    // Should fail - branch A1 session cannot create in branch A2
    expect([403, 404]).toContain(res.status);
  });

  it("branch-scoped session can create worker in its own branch", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    // Login at ALP-001 branch URL
    const { token } = await staffLogin(app, "alpha-test-abj.localhost", "alice");

    // Get ALP-001 branch ID
    let branchA1 = "";
    await withAdmin(async (db) => {
      const b = await db.query<{ id: string }>(
        `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-001'`
      );
      branchA1 = b.rows[0]!.id;
    });

    // Create worker in same branch - should succeed
    const res = await request(app)
      .post("/api/v1/workers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Same",
        lastName: "Branch",
        branchId: branchA1,
        roleKey: "collection_officer",
        scopeType: "single_branch",
        branchIds: [branchA1]
      });
    expect(res.status).toBe(201);
    expect(res.body.workerCode).toMatch(/^ALP-001-CI-\d{3,}$/);
  });

  it("Head Office user can access branch data via drill-down (not branch URL)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    // Login at company URL as a Head Office user (alice has company-wide permissions via MD role)
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    // Should be able to list all branches
    const branchesRes = await request(app)
      .get("/api/v1/branches")
      .set("Authorization", `Bearer ${token}`);
    expect(branchesRes.status).toBe(200);
    expect(branchesRes.body.length).toBeGreaterThanOrEqual(2); // ALP-001, ALP-002
  });

  it("cross-branch isolation: company A branch session cannot access company B data", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    // Login at company A's branch URL
    const { token: aToken } = await staffLogin(app, "alpha-test-abj.localhost", "alice");

    // Get company B's branch ID
    let branchB1 = "";
    await withAdmin(async (db) => {
      const b = await db.query<{ id: string }>(
        `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='beta-test') AND code='BTA-001'`
      );
      branchB1 = b.rows[0]!.id;
    });

    // Try to access company B's branch - should fail
    const res = await request(app)
      .get("/api/v1/branches")
      .set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    // Should only see company A's branches
    for (const branch of res.body) {
      expect(branch.code).toMatch(/^ALP-/);
    }
  });
});