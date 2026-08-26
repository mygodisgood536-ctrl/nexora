import { describe, expect, it } from "vitest";
import request from "supertest";
import { seedWorld, withAdmin } from "./fixtures";
import { initPlatformOwner, poLogin, staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

async function branchSeqFloor(companyId: string): Promise<number> {
  let floor = 0;
  await withAdmin(async (db) => {
    const r = await db.query<{ mx: string | null }>(
      `SELECT max(code) AS mx FROM branches WHERE company_id=$1`,
      [companyId]
    );
    const mx = r.rows[0]!.mx; // e.g. 'ALP-002'
    floor = mx ? parseInt(mx.split("-")[1]!, 10) : 0;
    const c = await db.query<{ next_value: number }>(
      `SELECT next_value FROM company_counters WHERE company_id=$1 AND counter_key='branch_seq'`,
      [companyId]
    );
    // The counter may already be ahead of existing rows (prior test runs);
    // allocation starts at the counter's current value, so use the higher.
    if (c.rows[0]) floor = Math.max(floor, c.rows[0].next_value - 1);
  });
  return floor;
}

describe("stage 5 — branch system", () => {
  it("allocates deterministic, never-reused codes under concurrency (race test)", { timeout: 90_000 }, async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    let companyId = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ id: string }>(`SELECT id FROM companies WHERE slug='alpha-test'`);
      companyId = r.rows[0]!.id;
    });
    const start = await branchSeqFloor(companyId);

    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        request(app)
          .post("/api/v1/branches")
          .set("Authorization", `Bearer ${token}`)
          .send({ name: `Race Branch ${Date.now()}-${i}`, address: "12 Race Rd, Lagos" })
      )
    );
    for (const res of results) expect(res.status).toBe(201);

    const codes = results.map((r) => r.body.code as string).sort();
    const expected = Array.from({ length: N }, (_, i) =>
      `ALP-${String(start + 1 + i).padStart(3, "0")}`
    ).sort();
    expect(codes).toEqual(expected); // distinct, contiguous, gap-free

    for (const res of results) {
      expect(res.body.code).toMatch(/^ALP-\d{3,}$/);
      expect(String(res.body.portal_url)).toMatch(/^alpha-test-[a-z0-9-]+\.nexora\.app$/);
    }
  });

  it("dedupes slugs within a company and keeps codes monotonic after close", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const name = `Twin Branch ${Date.now()}`;

    const first = await request(app)
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${token}`)
      .send({ name, address: "1 Twin St" });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${token}`)
      .send({ name, address: "2 Twin St" });
    expect(second.status).toBe(201);
    expect(second.body.slug).not.toBe(first.body.slug);
    expect(second.body.slug.startsWith(`${first.body.slug}-`)).toBe(true);

    // Lifecycle: close requires a reason and is terminal; codes never reused.
    const noReason = await request(app)
      .post(`/api/v1/branches/${first.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "close" });
    expect(noReason.status).toBe(422);

    const close = await request(app)
      .post(`/api/v1/branches/${first.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "close", reason: "Consolidating operations" });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe("closed");

    const reopen = await request(app)
      .post(`/api/v1/branches/${first.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "reactivate" });
    expect(reopen.status).toBe(409); // closed is terminal

    const after = await request(app)
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: `After Close ${Date.now()}`, address: "3 After Ave" });
    expect(after.status).toBe(201);
    expect(parseInt(after.body.code.split("-")[1]!, 10))
      .toBeGreaterThan(parseInt(first.body.code.split("-")[1]!, 10));
  });

  it("scopes every branch read/write to the caller's own company (isolation)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const alpha = await staffLogin(app, ALPHA_HOST, "alice");
    const beta = await staffLogin(app, BETA_HOST, "bob");

    const betaList = await request(app)
      .get("/api/v1/branches")
      .set("Authorization", `Bearer ${beta.token}`);
    expect(betaList.status).toBe(200);
    for (const row of betaList.body) expect(row.code).toMatch(/^BTA-/);

    // Beta cannot touch an alpha branch even knowing its id — RLS hides it.
    const alphaList = await request(app)
      .get("/api/v1/branches")
      .set("Authorization", `Bearer ${alpha.token}`);
    expect(alphaList.status).toBe(200);
    const alphaBranchId = alphaList.body[0].id as string;

    const crossStatus = await request(app)
      .post(`/api/v1/branches/${alphaBranchId}/status`)
      .set("Authorization", `Bearer ${beta.token}`)
      .send({ action: "suspend", reason: "cross-tenant attempt" });
    expect([403, 404]).toContain(crossStatus.status);
  });

  it("exposes structural-only branches to the Platform Owner (drill-down)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    await initPlatformOwner();
    const token = await poLogin(app);
    let companyId = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ id: string }>(`SELECT id FROM companies WHERE slug='alpha-test'`);
      companyId = r.rows[0]!.id;
    });

    const list = await request(app)
      .get(`/platform/v1/companies/${companyId}/branches`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(
      list.body.length,
      `drill-down body: ${JSON.stringify(list.body).slice(0, 400)}`
    ).toBeGreaterThanOrEqual(2); // ALP-001, ALP-002 fixtures
    for (const row of list.body) {
      // Structural fields ONLY — §40 boundary holds by response shape.
      expect(Object.keys(row).sort()).toEqual(
        ["closed_at", "code", "created_at", "id", "name", "portal_url", "slug", "status"].sort()
      );
      expect(row.code).toMatch(/^ALP-/);
    }

    const unauthed = await request(app).get(`/platform/v1/companies/${companyId}/branches`);
    expect(unauthed.status).toBe(401);
  });
});
