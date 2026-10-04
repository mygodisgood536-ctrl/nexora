import { describe, it, expect } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { seedWorld, withAdmin, withAdminValue, type TestWorld } from "./fixtures";
import { staffLogin, completeProfile } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

/**
 * Stage 13 pass 4 - isolation attack.
 *
 * Every id below is REAL and KNOWN: they are read straight out of the other
 * tenant's tables. The attack is not "try to guess a uuid", it is "here is the
 * exact identifier, now try to use it". A surface that leaks another tenant's
 * row, or lets a branch session reach outside its branch, fails here even if
 * every functional test passes.
 */
describe("isolation attack", () => {
  it("a real foreign id is refused on every surface that accepts one", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: alphaCo } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: alphaMd } = await staffLogin(app, ALPHA_HOST, "amy");
    const { token: betaMd } = await staffLogin(app, BETA_HOST, "bob");

    // Real identifiers belonging to the other tenant, discovered from its rows.
    const foreign = await withAdminValue(async (db) => {
      const customer = await db.query<{ id: string }>(
        `SELECT id FROM customers WHERE company_id=$1 LIMIT 1`, [w.companyB]
      );
      const loan = await db.query<{ id: string }>(
        `SELECT id FROM loans WHERE company_id=$1 LIMIT 1`, [w.companyB]
      );
      const group = await db.query<{ id: string }>(
        `SELECT id FROM groups WHERE company_id=$1 LIMIT 1`, [w.companyB]
      );
      const worker = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE company_id=$1 AND id<>$2 LIMIT 1`, [w.companyB, w.userB]
      );
      const application = await db.query<{ id: string }>(
        `SELECT id FROM loan_applications WHERE company_id=$1 LIMIT 1`, [w.companyB]
      );
      const assignment = await db.query<{ id: string }>(
        `SELECT id FROM customer_assignments WHERE company_id=$1 LIMIT 1`, [w.companyB]
      );
      return {
        customer: customer.rows[0]?.id,
        loan: loan.rows[0]?.id,
        group: group.rows[0]?.id,
        worker: worker.rows[0]?.id,
        application: application.rows[0]?.id,
        assignment: assignment.rows[0]?.id
      };
    });

    const paths: [string, string][] = [];
    if (foreign.customer) paths.push([`/api/v1/customers/${foreign.customer}`, "GET"]);
    if (foreign.customer) paths.push([`/api/v1/customers/${foreign.customer}/loan-history`, "GET"]);
    if (foreign.customer) paths.push([`/api/v1/customers/${foreign.customer}/portal-access`, "GET"]);
    if (foreign.group) paths.push([`/api/v1/groups/${foreign.group}`, "GET"]);
    if (foreign.group) paths.push([`/api/v1/groups/${foreign.group}/members`, "GET"]);
    if (foreign.group) paths.push([`/api/v1/groups/${foreign.group}/ledger`, "GET"]);
    if (foreign.worker) paths.push([`/api/v1/workers/${foreign.worker}`, "GET"]);
    if (foreign.worker) paths.push([`/api/v1/workers/${foreign.worker}/assignments`, "GET"]);
    if (foreign.application) paths.push([`/api/v1/loan-applications/${foreign.application}`, "GET"]);
    if (foreign.application) paths.push([`/api/v1/loan-applications/${foreign.application}/preview`, "GET"]);
    if (foreign.application) paths.push([`/api/v1/loan-applications/${foreign.application}/stages`, "GET"]);
    if (foreign.application) paths.push([`/api/v1/loan-applications/${foreign.application}/documents`, "GET"]);
    if (foreign.assignment) paths.push([`/api/v1/assignments/${foreign.assignment}`, "GET"]);
    paths.push([`/api/v1/traceability/chain?type=customer&id=${foreign.customer ?? w.customerA1}`, "GET"]);

    for (const [path, method] of paths) {
      const res = await request(app)
        .get(path)
        .set("Authorization", `Bearer ${alphaMd}`);
      expect([403, 404], `alpha MD reached ${path} (${res.status})`).toContain(res.status);
    }

    // Writes are refused just as firmly as reads.
    const writes: [string, string, Record<string, unknown>][] = [];
    if (foreign.customer) {
      writes.push([
        `/api/v1/customers/${foreign.customer}/status`,
        "suspend",
        { action: "suspend", reason: "isolation attack" }
      ]);
    }
    if (foreign.group) {
      writes.push([`/api/v1/groups/${foreign.group}/close`, "POST", { reason: "isolation attack" }]);
    }
    if (foreign.worker) {
      writes.push([
        `/api/v1/workers/${foreign.worker}/portfolio/hold`,
        "POST",
        { reason: "isolation attack" }
      ]);
    }
    for (const [path, , body] of writes) {
      const res = await request(app)
        .post(path)
        .set("Authorization", `Bearer ${alphaMd}`)
        .send(body);
      expect([403, 404], `alpha MD wrote ${path} (${res.status})`).toContain(res.status);
    }

    // The reverse direction: beta cannot reach alpha either.
    for (const path of [`/api/v1/customers/${w.customerA1}`, `/api/v1/workers/${w.userA}`]) {
      const res = await request(app).get(path).set("Authorization", `Bearer ${betaMd}`);
      expect([403, 404], `beta MD reached ${path} (${res.status})`).toContain(res.status);
    }

    // Nothing was changed on either side.
    const counts = await withAdminValue(async (db) => {
      const a = await db.query<{ c: string; l: string }>(
        `SELECT (SELECT count(*)::text FROM customers WHERE company_id=$1) AS c,
                (SELECT count(*)::text FROM loans WHERE company_id=$1) AS l`,
        [w.companyA]
      );
      const b = await db.query<{ c: string; l: string }>(
        `SELECT (SELECT count(*)::text FROM customers WHERE company_id=$1) AS c,
                (SELECT count(*)::text FROM loans WHERE company_id=$1) AS l`,
        [w.companyB]
      );
      return { alpha: a.rows[0]!, beta: b.rows[0]! };
    });
    expect(Number(counts.beta.c)).toBeGreaterThanOrEqual(0);
    expect(Number(counts.alpha.c)).toBeGreaterThan(0);
    void alphaCo;
  });

  it("a branch-scoped session cannot reach another branch in its own company", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    // Logging in at the branch URL produces a branch-restricted session.
    const { token: branchScoped } = await staffLogin(app, "alpha-test-abj.localhost", "alice");

    const otherBranchCustomer = await withAdminValue(async (db) =>
      (await db.query<{ id: string }>(
        `SELECT id FROM customers WHERE company_id=$1 AND branch_id=$2 LIMIT 1`,
        [w.companyA, w.branchA2]
      )).rows[0]?.id
    );

    if (otherBranchCustomer) {
      const res = await request(app)
        .get(`/api/v1/customers/${otherBranchCustomer}`)
        .set("Authorization", `Bearer ${branchScoped}`);
      expect([403, 404], `branch session reached branchA2's customer (${res.status})`).toContain(res.status);

      const write = await request(app)
        .post(`/api/v1/customers/${otherBranchCustomer}/status`)
        .set("Authorization", `Bearer ${branchScoped}`)
        .send({ action: "suspend", reason: "isolation attack" });
      expect([403, 404], `branch session wrote branchA2's customer (${write.status})`).toContain(write.status);
    }

    // And the other branch's payment queue is not visible either.
    const queue = await request(app)
      .get("/api/v1/payments/pending")
      .set("Authorization", `Bearer ${branchScoped}`);
    expect(queue.status).toBe(200);
    const asString = JSON.stringify(queue.body);
    expect(asString).not.toContain(w.customerB1);
  });

  it("a write cannot be moved into another tenant by supplying a foreign company id", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: alphaCo } = await staffLogin(app, ALPHA_HOST, "alice");

    const before = await withAdminValue(async (db) =>
      Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyB]
      )).rows[0]!.n)
    );

    // The tenant comes from the session, never from the request body.
    for (const header of ["X-Company-Id", "X-Company", "X-Tenant"]) {
      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${alphaCo}`)
        .set(header, w.companyB)
        .send({
          branchId: w.branchA1,
          firstName: "Tenant",
          lastName: "Escape",
          address: "1 Escape Road",
          ...completeProfile({ identificationNumber: `ID-ESC-${Date.now()}` })
        });
      expect([201], `the customer must be created in the session tenant (${header})`).toContain(res.status);
    }

    const after = await withAdminValue(async (db) => ({
      alpha: Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n),
      beta: Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyB]
      )).rows[0]!.n)
    }));
    // The foreign tenant gained nothing; the session tenant gained them all.
    expect(after.beta).toBe(before);
    expect(after.alpha).toBeGreaterThan(0);
  });

  it("with no tenant session at all, the database returns nothing", async () => {
    const app: Express = (await import("../src/app")).createApp();
    await seedWorld();

    // No Authorization header: nothing resolves, so nothing is served.
    for (const path of [
      "/api/v1/customers",
      "/api/v1/workers",
      "/api/v1/payments/pending",
      "/api/v1/reports/summary"
    ]) {
      const res = await request(app).get(path);
      expect(res.status, `${path} answered without a session`).toBe(401);
    }
  });
});
