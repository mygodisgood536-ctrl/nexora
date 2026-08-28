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
    expect(second.body.code).toBe("USERNAME_TAKEN");
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
});

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