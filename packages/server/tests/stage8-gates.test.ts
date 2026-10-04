// Stage 8 — access gates for the new Part 5.8 / 7 / 8 surfaces.
// Covers: Branch Workplace entry is role+scope gated (RULE 7.2.1/7.2.2) and
// audited on entry (RULE 7.2.3); a Collection Officer cannot run/read EOD
// operations; the provider registry read surface returns the seeded providers.
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

describe("stage 8 — new surface access gates", () => {
  it("Branch Workplace: a Collection Officer is denied entry (RULE 7.2.2)", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const world = await seedWorld();
    const branchA1 = await getAlphaBranchA1();

    // Create a worker whose only role is Collection Officer (NOT on the
    // workplace entry list, so RULE 7.2.2 denies the page entirely).
    const mdToken = (await staffLogin(app, ALPHA_HOST, "amy")).token;
    const created = await request(app)
      .post("/api/v1/workers")
      .set("Authorization", `Bearer ${mdToken}`)
      .set("Host", ALPHA_HOST)
      .send({
        firstName: "Denied",
        lastName: "Officer",
        branchId: branchA1,
        roleKey: "collection_officer",
        scopeType: "single_branch",
        branchIds: [branchA1]
      });
    expect(created.status).toBe(201);
    const { token } = await staffLogin(app, ALPHA_HOST, "Denied Officer", "@Denied");

    const res = await request(app)
      .get("/api/v1/branch-workplace/overview")
      .query({ branch: branchA1 })
      .set("Authorization", `Bearer ${token}`)
      .set("Host", ALPHA_HOST);
    expect(res.status).toBe(403);
    void world;
  });

  it("Branch Workplace: the MD enters and the entry is audited (RULE 7.2.1/7.2.3)", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const world = await seedWorld();
    const branchA1 = await getAlphaBranchA1();

    const { token } = await staffLogin(app, ALPHA_HOST, "amy");
    const res = await request(app)
      .get("/api/v1/branch-workplace/overview")
      .query({ branch: branchA1 })
      .set("Authorization", `Bearer ${token}`)
      .set("Host", ALPHA_HOST);
    expect(res.status).toBe(200);

    // RULE 7.2.3 — entering the workplace writes an audit entry naming the
    // user, the branch, the time and the role used.
    await withAdmin(async (db) => {
      const a = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_logs
          WHERE action='branch_workplace.enter'
            AND entity_type='branches' AND entity_id=$1
            AND role_used='md'`,
        [branchA1]
      );
      expect(a.rows[0]!.count).toBe("1");
    });
    void world;
  });

  it("EOD: a Collection Officer cannot run or read end-of-day operations", async () => {
    const app: Express = (await import("../src/app")).createApp();
    await seedWorld();

    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const post = await request(app)
      .post("/api/v1/eod")
      .set("Authorization", `Bearer ${token}`)
      .set("Host", ALPHA_HOST);
    expect(post.status).toBe(403);

    const last = await request(app)
      .get("/api/v1/eod/last")
      .set("Authorization", `Bearer ${token}`)
      .set("Host", ALPHA_HOST);
    expect(last.status).toBe(403);
  });

  it("Provider registry: an authenticated member reads the seeded providers", async () => {
    const app: Express = (await import("../src/app")).createApp();
    await seedWorld();

    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .get("/api/v1/payment-providers/registry")
      .set("Authorization", `Bearer ${token}`)
      .set("Host", ALPHA_HOST);
    expect(res.status).toBe(200);
    const codes = (res.body.providers as Array<{ code: string }>).map((p) => p.code);
    // RULE 8.1.2 — the registry ships pre-configured with all seven entries.
    expect(codes).toEqual(
      expect.arrayContaining([
        "monnify",
        "flutterwave",
        "paystack",
        "squad",
        "opay",
        "palmpay",
        "generic"
      ])
    );
    const monnify = (res.body.providers as Array<{ code: string; requirementSet: unknown; capabilityFlags: unknown }>).find(
      (p) => p.code === "monnify"
    );
    expect(monnify!.requirementSet).toBeTruthy();
    expect(monnify!.capabilityFlags).toBeTruthy();
  });
});