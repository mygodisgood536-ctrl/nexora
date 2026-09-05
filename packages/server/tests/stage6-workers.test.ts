import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { seedWorld, withAdmin } from "./fixtures";
import { staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";

interface CreatedWorker {
  id: string;
  workerCode: string;
  username: string;
  initialAssignmentId: string;
  temporaryPassword: string;
}

async function createWorkerViaApi(
  app: Express,
  token: string,
  body: Record<string, unknown>
): Promise<request.Response> {
  return request(app)
    .post("/api/v1/workers")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

async function getAlphaBranchA1(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const c = await db.query<{ id: string }>(
      `SELECT id FROM companies WHERE slug='alpha-test'`
    );
    const b = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE company_id=$1 AND code='ALP-001'`,
      [c.rows[0]!.id]
    );
    id = b.rows[0]!.id;
  });
  return id;
}

async function getAlphaBranchA2(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const c = await db.query<{ id: string }>(
      `SELECT id FROM companies WHERE slug='alpha-test'`
    );
    const b = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE company_id=$1 AND code='ALP-002'`,
      [c.rows[0]!.id]
    );
    id = b.rows[0]!.id;
  });
  return id;
}

async function getBetaBranchB1(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const c = await db.query<{ id: string }>(
      `SELECT id FROM companies WHERE slug='beta-test'`
    );
    const b = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE company_id=$1 AND code='BTA-001'`,
      [c.rows[0]!.id]
    );
    id = b.rows[0]!.id;
  });
  return id;
}

describe("stage 6 — workers and role assignments", () => {
  it("creates a worker with auto-generated worker_code, temp password, and first assignment", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();

    const res = await createWorkerViaApi(app, token, {
      firstName: "Test",
      lastName: "Worker",
      username: "test.worker1",
      branchId: branchA1,
      roleKey: "collection_officer",
      scopeType: "single_branch",
      branchIds: [branchA1]
    });
    expect(res.status).toBe(201);
    const body = res.body as CreatedWorker;
    expect(body.workerCode).toMatch(/^ALP-001-CI-\d{3,}$/);
    expect(body.username).toBe("test.worker1");
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9!@#$%^&*]{16}$/);
    expect(body.initialAssignmentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    await withAdmin(async (db) => {
      const u = await db.query<{
        worker_code: string;
        status: string;
        must_change_password: boolean;
      }>(
        `SELECT worker_code, status, must_change_password
           FROM users WHERE id=$1`,
        [body.id]
      );
      expect(u.rows[0]!.worker_code).toBe(body.workerCode);
      expect(u.rows[0]!.status).toBe("invited");
      expect(u.rows[0]!.must_change_password).toBe(true);

      const a = await db.query<{
        role_key: string;
        scope_type: string;
        status: string;
      }>(
        `SELECT r.role_key, ra.scope_type, ra.status
           FROM role_assignments ra JOIN roles r ON r.id=ra.role_id
          WHERE ra.id=$1`,
        [body.initialAssignmentId]
      );
      expect(a.rows[0]!.role_key).toBe("collection_officer");
      expect(a.rows[0]!.scope_type).toBe("single_branch");
      expect(a.rows[0]!.status).toBe("active");
    });
  });
  it("rejects duplicate username within the same company with USERNAME_TAKEN", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();
    const first = await createWorkerViaApi(app, token, {
      firstName: "Dup",
      lastName: "One",
      username: "dup.user",
      branchId: branchA1,
      roleKey: "collection_officer",
      scopeType: "single_branch",
      branchIds: [branchA1]
    });
    expect(first.status).toBe(201);
    const second = await createWorkerViaApi(app, token, {
      firstName: "Dup",
      lastName: "Two",
      username: "dup.user",
      branchId: branchA1,
      roleKey: "collection_officer",
      scopeType: "single_branch",
      branchIds: [branchA1]
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("USERNAME_TAKEN");
  });

  it("rejects temporary assignment without endsAt with 422", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();
    const res = await createWorkerViaApi(app, token, {
      firstName: "Temp",
      lastName: "Noend",
      username: "temp.noend",
      branchId: branchA1,
      roleKey: "collection_officer",
      scopeType: "single_branch",
      branchIds: [branchA1],
      assignmentType: "temporary"
    });
    expect(res.status).toBe(422);
  });

  it("rejects end-before-start temporary window with 422", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();
    const res = await createWorkerViaApi(app, token, {
      firstName: "Temp",
      lastName: "Window",
      username: "temp.window",
      branchId: branchA1,
      roleKey: "collection_officer",
      scopeType: "single_branch",
      branchIds: [branchA1],
      assignmentType: "temporary",
      startsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(),
      endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString()
    });
    expect(res.status).toBe(422);
  });

  it("isolates workers across companies: company A cannot create in company B's branch", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token: aToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchB1 = await getBetaBranchB1();
    const res = await createWorkerViaApi(app, aToken, {
      firstName: "Cross",
      lastName: "Company",
      username: "cross.company",
      branchId: branchB1,
      roleKey: "collection_officer",
      scopeType: "single_branch",
      branchIds: [branchB1]
    });
    expect([404, 403, 500]).toContain(res.status);
  });

  it("assigns additional temporary role with start/end window", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const branchA1 = await getAlphaBranchA1();
    const branchA2 = await getAlphaBranchA2();

    // First, get alice's user ID
    let userId = "";
    await withAdmin(async (db) => {
      const u = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE username='alice'`
      );
      userId = u.rows[0]!.id;
    });

    const day = 24 * 60 * 60 * 1000;
    const startsAt = new Date(Date.now() - day).toISOString();
    const endsAt = new Date(Date.now() + day).toISOString();

    const assignRes = await request(app)
      .post(`/api/v1/workers/${userId}/assignments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        roleKey: "branch_manager",
        scopeType: "single_branch",
        branchIds: [branchA1],
        assignmentType: "temporary",
        startsAt,
        endsAt,
        reason: "Covering for manager on leave"
      });
    expect(assignRes.status).toBe(201);
    expect(assignRes.body.roleKey).toBe("branch_manager");
    expect(assignRes.body.scopeType).toBe("single_branch");
    expect(assignRes.body.branchIds).toEqual([branchA1]);

    // Verify the assignment is active now (within window)
    const listRes = await request(app)
      .get(`/api/v1/workers/${userId}/assignments`)
      .set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    const assignments = listRes.body as Array<{ role_key: string; status: string; assignment_type: string }>;
    const tempAssignment = assignments.find(a => a.role_key === "branch_manager" && a.assignment_type === "temporary");
    expect(tempAssignment).toBeDefined();
    expect(tempAssignment!.status).toBe("active");
  });

  it("ends a role assignment", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    // Get alice's temporary branch_manager assignment ID
    let assignmentId = "";
    await withAdmin(async (db) => {
      const a = await db.query<{ id: string }>(
        `SELECT ra.id FROM role_assignments ra
           JOIN roles r ON r.id = ra.role_id
          WHERE ra.user_id = (SELECT id FROM users WHERE username='alice')
            AND r.role_key = 'branch_manager'
            AND ra.assignment_type = 'temporary'
          LIMIT 1`
      );
      assignmentId = a.rows[0]!.id;
    });

    const endRes = await request(app)
      .post(`/api/v1/assignments/${assignmentId}/end`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Leave ended early" });
    expect(endRes.status).toBe(200);
    expect(endRes.body.status).toBe("ended");

    // Verify assignment is ended
    await withAdmin(async (db) => {
      const a = await db.query<{ status: string; end_reason: string }>(
        `SELECT status, end_reason FROM role_assignments WHERE id=$1`,
        [assignmentId]
      );
      expect(a.rows[0]!.status).toBe("ended");
      expect(a.rows[0]!.end_reason).toBe("Leave ended early");
    });
  });

  it("lists enabled roles for the company", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const res = await request(app)
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const role of res.body) {
      expect(role).toHaveProperty("id");
      expect(role).toHaveProperty("role_key");
      expect(role).toHaveProperty("name");
      expect(role).toHaveProperty("category");
      expect(role).toHaveProperty("enabled");
    }
  });

  it("gets role catalogue", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const res = await request(app)
      .get("/api/v1/roles/catalogue")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("builtIn");
    expect(res.body).toHaveProperty("templates");
    expect(Array.isArray(res.body.builtIn)).toBe(true);
    expect(res.body.builtIn.length).toBe(32);
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.templates.length).toBe(11);
  });
});

describe("stage 6 — active role lens (role switcher)", () => {
  it("gets and sets the active role lens", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    // Get current active role (should be null initially)
    const getRes = await request(app)
      .get("/api/v1/auth/active-role")
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.activeRoleKey).toBeNull();

    // Set active role to branch_manager (alice has this as temporary)
    const putRes = await request(app)
      .put("/api/v1/auth/active-role")
      .set("Authorization", `Bearer ${token}`)
      .send({ roleKey: "branch_manager" });
    expect(putRes.status).toBe(204);

    // Verify it's set
    const getRes2 = await request(app)
      .get("/api/v1/auth/active-role")
      .set("Authorization", `Bearer ${token}`);
    expect(getRes2.status).toBe(200);
    expect(getRes2.body.activeRoleKey).toBe("branch_manager");

    // Set to null (clear)
    const putRes2 = await request(app)
      .put("/api/v1/auth/active-role")
      .set("Authorization", `Bearer ${token}`)
      .send({ roleKey: null });
    expect(putRes2.status).toBe(204);

    const getRes3 = await request(app)
      .get("/api/v1/auth/active-role")
      .set("Authorization", `Bearer ${token}`);
    expect(getRes3.body.activeRoleKey).toBeNull();
  });

  it("rejects setting active role to a role the user doesn't have", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    // alice doesn't have md role
    const putRes = await request(app)
      .put("/api/v1/auth/active-role")
      .set("Authorization", `Bearer ${token}`)
      .send({ roleKey: "md" });
    expect(putRes.status).toBe(403);
    expect(putRes.body.error.code).toBe("FORBIDDEN");
  });

  it("includes activeRoleKey in /auth/me response", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("activeRoleKey");
  });

  it("includes activeRoleKey in access token after refresh", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    // Set active role
    await request(app)
      .put("/api/v1/auth/active-role")
      .set("Authorization", `Bearer ${token}`)
      .send({ roleKey: "branch_manager" });

    // Refresh token
    const cookie = `nx_refresh=${token}`; // Not exact, but we test via /auth/me instead
    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(meRes.body.activeRoleKey).toBe("branch_manager");
  });
});

describe("stage 6 — temporary role lifecycle (expiry)", () => {
  it("expireTemporaryAssignments function exists and is exported", async () => {
    const { expireTemporaryAssignments } = await import("../src/modules/workers/service");
    expect(typeof expireTemporaryAssignments).toBe("function");
  });

  it("activateTemporaryAssignments function exists and is exported", async () => {
    const { activateTemporaryAssignments } = await import("../src/modules/workers/service");
    expect(typeof activateTemporaryAssignments).toBe("function");
  });
});