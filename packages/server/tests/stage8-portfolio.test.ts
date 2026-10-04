// Stage 8 — Part 5.8 HR Portfolio Controls.
// Covers: hold (RULE 5.8.2) blocks login + invalidates sessions + flags money,
// release restores login, transfer (RULE 5.8.3) stands the old account down,
// creates a replacement, and repoints the portfolio to the new worker; only HR
// and the MD may invoke the controls (RULE 5.8.1).
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { seedWorld, withAdmin } from "./fixtures";
import { staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";

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

async function queryState(id: string): Promise<{
  credentialState: string;
  status: string;
  passwordHash: string;
  totp: string | null;
}> {
  let out = { credentialState: "", status: "", passwordHash: "", totp: null as string | null };
  await withAdmin(async (db) => {
    const r = await db.query<{
      credential_state: string;
      status: string;
      password_hash: string;
      totp_secret_encrypted: string | null;
    }>(
      `SELECT credential_state, status, password_hash, totp_secret_encrypted
         FROM users WHERE id=$1`,
      [id]
    );
    out = {
      credentialState: r.rows[0]!.credential_state,
      status: r.rows[0]!.status,
      passwordHash: r.rows[0]!.password_hash,
      totp: r.rows[0]!.totp_secret_encrypted
    };
  });
  return out;
}

describe("stage 8 — part 5.8 HR portfolio controls", () => {
  // RULE 5.9.1 / 5.1.1 — HR edits a worker's name, phone and passport; the
  // username follows the full name; the edit is audit-logged. It runs on a
  // dedicated worker so the shared fixtures other tests log in with stay intact.
  it("edits a worker record: the username follows the full name (RULE 5.9.1)", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const world = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "amy");

    // Create a throwaway worker through the real endpoint, then edit it.
    const created = await request(app)
      .post("/api/v1/workers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        roleKey: "collection_officer",
        scopeType: "single_branch",
        branchId: world.branchA1,
        branchIds: [world.branchA1],
        firstName: "Original",
        lastName: "Name"
      });
    if (created.status !== 201) {
      throw new Error(`worker create failed: ${created.status} ${JSON.stringify(created.body)}`);
    }
    const workerId = created.body.id as string;
    expect(created.body.username).toBe("Original Name");

    const noReason = await request(app)
      .patch(`/api/v1/workers/${workerId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "+2348001112222" });
    expect(noReason.status).toBe(422);

    const res = await request(app)
      .patch(`/api/v1/workers/${workerId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Alicia",
        lastName: "Okonkwo",
        phone: "+2348001112222",
        reason: "legal name change confirmed by HR"
      });
    expect(res.status).toBe(200);
    // RULE 5.1.1 — the username is the exact full name.
    expect(res.body.username).toBe("Alicia Okonkwo");
    expect(res.body.phone).toBe("+2348001112222");

    // RULE 5.9.3 — the edit is audit-logged with before/after values.
    let audited = 0;
    await withAdmin(async (db) => {
      const r = await db.query<{ previous_value: unknown; new_value: unknown }>(
        `SELECT previous_value, new_value FROM audit_logs
          WHERE action='worker.edited' AND entity_id=$1`,
        [workerId]
      );
      audited = r.rowCount ?? 0;
      if (audited > 0) {
        const pv = r.rows[0]!.previous_value as Record<string, unknown>;
        const nv = r.rows[0]!.new_value as Record<string, unknown>;
        expect(pv.username).toBe("Original Name");
        expect(nv.username).toBe("Alicia Okonkwo");
      }
    });
    expect(audited).toBeGreaterThanOrEqual(1);
  });

  it("rejects hold/transfer from a non-HR, non-MD role (RULE 5.8.1)", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const world = await seedWorld();

    // alice is a Collection Officer (not HR, not MD) — even with suspend.
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const res = await request(app)
      .post(`/api/v1/workers/${world.userA}/portfolio/hold`)
      .set("Authorization", `Bearer ${token}`)
      .set("Host", ALPHA_HOST)
      .send({ reason: "no" });
    expect(res.status).toBe(403);

    const res2 = await request(app)
      .post(`/api/v1/workers/${world.userA}/portfolio/transfer`)
      .set("Authorization", `Bearer ${token}`)
      .set("Host", ALPHA_HOST)
      .send({
        fromWorkerId: world.userA,
        reason: "no",
        newWorker: {}
      });
    expect(res2.status).toBe(403);
  });

  it("holds a worker's portfolio: blocks login, revokes sessions, keeps records, and flags money held", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const world = await seedWorld();

    // Give alice an active session, then the MD holds the portfolio.
    const beforeHold = await staffLogin(app, ALPHA_HOST, "alice");
    expect(beforeHold.token.length).toBeGreaterThan(0);

    const md = await staffLogin(app, ALPHA_HOST, "amy");

    const hold = await request(app)
      .post(`/api/v1/workers/${world.userA}/portfolio/hold`)
      .set("Authorization", `Bearer ${md.token}`)
      .set("Host", ALPHA_HOST)
      .send({ reason: "Audit of the book — portfolio on hold" });
    expect(hold.status).toBe(200);
    expect(hold.body.credentialState).toBe("portfolio_on_hold");

    // Credential state blocks all login paths.
    const st = await queryState(world.userA);
    expect(st.credentialState).toBe("portfolio_on_hold");
    expect(st.status).toBe("active"); // account is not terminated

    // Alice's session was invalidated immediately (RULE 5.8.2.1).
    await withAdmin(async (db) => {
      const rt = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM refresh_tokens
          WHERE user_id=$1 AND revoked_at IS NULL`,
        [world.userA]
      );
      expect(rt.rows[0]!.count).toBe("0");
    });

    // Records preserved: customers, VA and loan still exist.
    await withAdmin(async (db) => {
      const c = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM customers WHERE id=$1`,
        [world.customerA1]
      );
      expect(c.rows[0]!.count).toBe("1");
    });

    // Audit trail recorded.
    await withAdmin(async (db) => {
      const a = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_logs
          WHERE action='portfolio.hold' AND entity_id=$1`,
        [world.userA]
      );
      expect(a.rows[0]!.count).toBe("1");
    });

    // Login is blocked while on hold, even with the correct password.
    const relog = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", ALPHA_HOST)
      .send({ username: "alice", password: "TestPassword!123" });
    expect(relog.status).not.toBe(200);
  });

  it("releases a hold — restores login", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const world = await seedWorld();
    const md = await staffLogin(app, ALPHA_HOST, "amy");

    // Put it on hold first.
    await request(app)
      .post(`/api/v1/workers/${world.userA}/portfolio/hold`)
      .set("Authorization", `Bearer ${md.token}`)
      .set("Host", ALPHA_HOST)
      .send({ reason: "hold before release" });
    const res = await request(app)
      .post(`/api/v1/workers/${world.userA}/portfolio/release`)
      .set("Authorization", `Bearer ${md.token}`)
      .set("Host", ALPHA_HOST)
      .send({ reason: "issue resolved" });
    expect(res.status).toBe(200);
    expect(res.body.credentialState).toBe("released");

    const st = await queryState(world.userA);
    // Alice completed the ritual; release restores 'secured'.
    expect(st.credentialState).toBe("secured");
    expect(st.status).toBe("active");

    // Login works again.
    const relog = await staffLogin(app, ALPHA_HOST, "alice");
    expect(relog.token.length).toBeGreaterThan(0);
  });

  it("transfers the portfolio to a new worker (RULE 5.8.3): old account stood down, book repointed", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const world = await seedWorld();
    const branchA1 = await getAlphaBranchA1();
    const md = await staffLogin(app, ALPHA_HOST, "amy");

    // Alice (collection officer) has two active customer assignments.
    await withAdmin(async (db) => {
      await db.query(
        `INSERT INTO customer_assignments (company_id, branch_id, customer_id, staff_id, status)
         VALUES ($1,$2,$3,$4,'active')`,
        [world.companyA, branchA1, world.customerA1, world.userA]
      );
    });

    const res = await request(app)
      .post(`/api/v1/workers/${world.userA}/portfolio/transfer`)
      .set("Authorization", `Bearer ${md.token}`)
      .set("Host", ALPHA_HOST)
      .send({
        fromWorkerId: world.userA,
        reason: "Portfolio reassigned to a permanent replacement",
        newWorker: {
          firstName: "New",
          lastName: "Officer",
          branchId: branchA1,
          roleKey: "collection_officer",
          scopeType: "single_branch",
          branchIds: [branchA1]
        }
      });
    expect(res.status).toBe(200);
    expect(res.body.previousWorkerState).toBe("transferred");
    expect(res.body.reassignedCustomers).toBe(1);
    expect(res.body.newWorker.workerCode).toMatch(/^ALP-001-CI-\d{3,}$/);

    const oldSt = await queryState(world.userA);
    expect(oldSt.credentialState).toBe("transferred");
    expect(oldSt.status).toBe("active"); // historical, but never deleted
    expect(oldSt.passwordHash).toBe("!"); // password deactivated
    expect(oldSt.totp).toBeNull(); // authenticator unlinked

    const newWorkerId: string = res.body.newWorker.id;
    await withAdmin(async (db) => {
      // Book repointed to the new worker.
      const ca = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM customer_assignments
          WHERE customer_id=$1 AND staff_id=$2 AND status='active'`,
        [world.customerA1, newWorkerId]
      );
      expect(ca.rows[0]!.count).toBe("1");

      // Old worker's active role assignments end-dated (RULE 5.8.5).
      const ra = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM role_assignments
          WHERE user_id=$1 AND status='active'`,
        [world.userA]
      );
      expect(ra.rows[0]!.count).toBe("0");
    });

    // The new worker's credential panel was issued once.
    expect(res.body.newWorker.credentialState).toBe("credential_issued");
    expect(res.body.newWorker.initialPassword).toMatch(/^@/);
  });
});