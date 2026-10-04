/**
 * PHASE 2 / ISS-004 probe - RULE 3.3.3 draft-company obligation.
 *
 * RULE 3.3.3 (verbatim, authority line 408):
 *   "The wizard may be saved as a draft before creation is completed; a draft
 *    company sits in 'In setup' status and cannot be logged into. Once the
 *    Platform Owner completes Create Company successfully, the company is
 *    provisioned and becomes live immediately..."
 *
 * Two obligations. The second is F-02 (already resolved). This probe drives the
 * FIRST through real HTTP against real PostgreSQL and records what actually
 * happens. It does not assert a verdict - it records evidence.
 *
 * Product code is NOT modified. This is verification only.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://nexora:nexora@localhost:5432/nexora_test";

import request from "supertest";
import pg from "pg";
import { createApp } from "../src/app";
import { ensurePlatformOwnerSecret, platformOwnerLogin, hostOf } from "./journey1";
import { log, check, writeReport } from "./e2e-harness";

const stamp = Date.now().toString(36).replace(/[^a-z]/g, "").slice(-5).toUpperCase();
const PREFIX = `D${stamp}`.slice(0, 6);

// Candidate routes a draft-save could plausibly live at. RULE 3.3.3 says the
// wizard "may be saved as a draft", so a real implementation must expose some
// way to persist a partial company.
const DRAFT_ROUTES: [string, string][] = [
  ["POST", "/platform/v1/companies/draft"],
  ["POST", "/platform/v1/companies/drafts"],
  ["POST", "/platform/v1/companies?draft=true"],
  ["POST", "/platform/v1/companies/save-draft"],
  ["PUT", "/platform/v1/companies/draft"]
];

async function main(): Promise<void> {
  const app = createApp();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const secret = await ensurePlatformOwnerSecret(db);
  const poToken = await platformOwnerLogin(app, secret);
  log(`Platform Owner authenticated for the draft probe`);

  // ---- 1. Can the wizard be saved as a draft at all? -----------------------
  for (const [method, path] of DRAFT_ROUTES) {
    const res = await (request(app) as any)
      [method.toLowerCase()](path)
      .set("Authorization", `Bearer ${poToken}`)
      .send({
        name: `Draft Probe MFI ${stamp}`,
        codePrefix: PREFIX,
        mdFullName: `Draft MD ${stamp}`,
        mdPhone: "+2348009900001"
      });
    check(
      `Draft-save route is absent: ${method} ${path}`,
      res.status === 404 || res.status === 405,
      `status=${res.status} body=${JSON.stringify(res.body).slice(0, 120)}`
    );
  }

  // ---- 2. Does a company actually reach "in_setup" by any route? -----------
  // Each company needs its OWN unique prefix: RULE 3.3.1 prefixes are unique
  // platform-wide, so reusing one yields 409 and cascades into undefined ids.
  // NOTE: PREFIX is already 6 chars, so appending then slicing would reproduce
  // the same prefix. The last character is REPLACED instead.
  const livePrefix = PREFIX.slice(0, 5) + "L";
  const created = await request(app)
    .post("/platform/v1/companies")
    .set("Authorization", `Bearer ${poToken}`)
    .send({
      name: `Draft Probe Live ${stamp}`,
      codePrefix: livePrefix,
      mdFullName: `Live MD ${stamp}`,
      mdPhone: "+2348009900002"
    });
  check("Probe company created over real HTTP", created.status === 201, `status=${created.status} body=${JSON.stringify(created.body).slice(0, 140)}`);

  const companyId = created.body?.id ?? "";
  if (!companyId) {
    await db.end();
    throw new Error("probe company was not created; remaining steps cannot be driven");
  }

  const dbStatus = await db.query<{ status: string }>(
    "SELECT status FROM companies WHERE id=$1",
    [created.body?.id]
  );
  const persisted = dbStatus.rows[0]?.status ?? "(none)";
  check(
    "A completed company is NOT in_setup (RULE 3.3.3 second half = F-02)",
    persisted === "active",
    `persisted status=${persisted}`
  );

  const inSetupCount = await db.query<{ n: number }>(
    "SELECT count(*)::int n FROM companies WHERE status='in_setup'"
  );
  log(`companies currently in 'in_setup' across the whole database: ${inSetupCount.rows[0]?.n}`);

  // ---- 3. Is the login gate real for a NON-active company? -----------------
  // A draft company cannot be produced (step 1), so the reachable proxy for
  // "must not be loggable into" is suspension, which uses the same gate.
  const host = hostOf(created.body?.company_url ?? "");
  const mdUsername = created.body?.md?.username ?? "";

  const beforeSuspend = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username: mdUsername, password: created.body?.md?.initialPassword ?? "" });
  check(
    "MD login works while the company is live",
    beforeSuspend.status === 200,
    `status=${beforeSuspend.status}`
  );

  const susp = await request(app)
    .post(`/platform/v1/companies/${companyId}/status`)
    .set("Authorization", `Bearer ${poToken}`)
    .send({ action: "suspend", reason: "ISS-004 probe: verify the non-live login gate" });
  check("Company suspended over real HTTP", susp.status === 200 || susp.status === 204, `status=${susp.status} body=${JSON.stringify(susp.body).slice(0, 140)}`);

  const afterSuspend = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username: mdUsername, password: created.body?.md?.initialPassword ?? "" });
  check(
    "Login into a NON-live company is refused",
    afterSuspend.status !== 200,
    `status=${afterSuspend.status} body=${JSON.stringify(afterSuspend.body).slice(0, 140)}`
  );
  log(`login into suspended company returned: ${afterSuspend.status}`);

  // ---- 4. Can a non-active company still be driven to 'in_setup'? ----------
  const toSetup = await request(app)
    .post(`/platform/v1/companies/${companyId}/status`)
    .set("Authorization", `Bearer ${poToken}`)
    .send({ action: "activate" });
  check(
    "Company can be reactivated (state machine supports active<->suspended)",
    toSetup.status === 200 || toSetup.status === 204,
    `status=${toSetup.status} body=${JSON.stringify(toSetup.body).slice(0, 140)}`
  );

  await db.end();
}

void (async () => {
  try {
    await main();
  } catch (e) {
    console.error("PROBE ERROR:", e);
  }
  writeReport("../../_probe_out/p2-draft-probe.txt");
  process.exit(0);
})();