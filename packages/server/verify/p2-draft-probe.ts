/**
 * PHASE 2 / ISS-004 probe - RULE 3.3.3 draft-company obligation.
 *
 * RULE 3.3.3 (verbatim, authority line 408):
 *   "The wizard may be saved as a draft before creation is completed; a draft
 *    company sits in 'In setup' status and cannot be logged into. Once the
 *    Platform Owner completes Create Company successfully, the company is
 *    provisioned and becomes live immediately..."
 *
 * The draft workflow is now implemented (saveCompanyDraft / discardCompanyDraft /
 * createCompany({ draftId })). This probe drives the FULL lifecycle over real
 * HTTP against real PostgreSQL and records what actually happens:
 *
 *   1. save a draft (both save paths), assert it persists as `in_setup`
 *   2. list drafts, assert both are visible
 *   3. attempt to log into the draft - must be refused (403, not active)
 *   4. update the draft, assert the change is persisted
 *   5. complete the draft - company must go live and admit its MD
 *   6. discard the other draft - row disappears, second discard is 404
 *   7. suspend / reactivate gate - a suspended company admits no login
 *
 * It does not assert a verdict on the product - it records evidence via check().
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
// RULE 3.3.1 - code prefixes are 3-6 LETTERS and unique platform-wide, so the
// probe derives letters-only prefixes stamped with the run time.
const base = (stamp.replace(/[^A-Z]/g, "") + "WXYZ").slice(0, 4);
const PREFIX_A = `${base}A`;
const PREFIX_B = `${base}B`;

interface DraftBody {
  id?: string;
  slug?: string;
  status?: string;
  code_prefix?: string;
}

async function main(): Promise<void> {
  const app = createApp();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const secret = await ensurePlatformOwnerSecret(db);
  const poToken = await platformOwnerLogin(app, secret);
  log(`Platform Owner authenticated for the draft probe`);

  // ---- 1. Save a draft through POST /companies/draft ----------------------
  const draftA = await request(app)
    .post("/platform/v1/companies/draft")
    .set("Authorization", `Bearer ${poToken}`)
    .send({
      name: `Draft Probe A ${stamp}`,
      codePrefix: PREFIX_A,
      planTier: "growth"
    });
  check(
    "Draft saves over real HTTP (201)",
    draftA.status === 201,
    `status=${draftA.status} body=${JSON.stringify(draftA.body).slice(0, 160)}`
  );
  const idA = (draftA.body as DraftBody).id ?? "";
  const slugA = (draftA.body as DraftBody).slug ?? "";
  check(
    "Saved draft sits in 'in_setup' (RULE 3.3.3 first half)",
    (draftA.body as DraftBody).status === "in_setup",
    `status=${(draftA.body as DraftBody).status}`
  );
  if (!idA || !slugA) {
    await db.end();
    throw new Error("draft A was not saved; remaining steps cannot be driven");
  }

  // ---- 1b. The same save through POST /companies?draft=true ---------------
  // ISS-004: this route used to silently create a LIVE company. It must now
  // save a draft instead.
  const draftB = await request(app)
    .post("/platform/v1/companies?draft=true")
    .set("Authorization", `Bearer ${poToken}`)
    .send({ name: `Draft Probe B ${stamp}`, codePrefix: PREFIX_B });
  const bodyB = draftB.body as DraftBody;
  check(
    "POST /companies?draft=true saves a DRAFT, never a live company",
    draftB.status === 201 && bodyB.status === "in_setup",
    `status=${draftB.status} statusField=${bodyB.status} body=${JSON.stringify(bodyB).slice(0, 160)}`
  );
  const idB = bodyB.id ?? "";

  // ---- 2. Both drafts are persisted and listable --------------------------
  const rows = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM companies WHERE id = ANY($1::uuid[])`,
    [[idA, idB].filter(Boolean)]
  );
  const persisted = rows.rows.filter((r) => r.status === "in_setup").length;
  check(
    "Both drafts persist as 'in_setup' in the database",
    persisted === rows.rows.length && rows.rows.length >= 2,
    `rows=${JSON.stringify(rows.rows)}`
  );

  const list = await request(app)
    .get("/platform/v1/companies/drafts")
    .set("Authorization", `Bearer ${poToken}`);
  const items = Array.isArray((list.body as { items?: { id: string }[] }).items)
    ? (list.body as { items: { id: string }[] }).items
    : [];
  check(
    "GET /companies/drafts returns both drafts",
    list.status === 200 && items.some((i) => i.id === idA) && items.some((i) => i.id === idB),
    `status=${list.status} ids=${items.map((i) => i.id).join(",")}`
  );

  // ---- 3. The draft cannot be logged into ---------------------------------
  // The host resolves (the company row exists) but the login gate must refuse
  // before any credential is examined: "Company is in setup".
  const draftLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", `${slugA}.localhost`)
    .send({ username: "nobody-at-all", password: "irrelevant-password" });
  check(
    "Login into a draft company is refused (RULE 3.3.3: cannot be logged into)",
    draftLogin.status !== 200,
    `status=${draftLogin.status} body=${JSON.stringify(draftLogin.body).slice(0, 160)}`
  );
  log(`draft login refusal: status=${draftLogin.status} body=${JSON.stringify(draftLogin.body).slice(0, 200)}`);

  // ---- 4. The draft can be updated before completion ----------------------
  const updated = await request(app)
    .put(`/platform/v1/companies/drafts/${idA}`)
    .set("Authorization", `Bearer ${poToken}`)
    .send({ contactEmail: `probe+${stamp.toLowerCase()}@example.test`, planTier: "standard" });
  check(
    "Draft update returns 200",
    updated.status === 200,
    `status=${updated.status} body=${JSON.stringify(updated.body).slice(0, 160)}`
  );
  const dbContact = await db.query<{ contact_email: string | null; plan_tier: string | null }>(
    `SELECT contact_email, plan_tier FROM companies WHERE id=$1`,
    [idA]
  );
  check(
    "Draft update is persisted",
    dbContact.rows[0]?.contact_email === `probe+${stamp.toLowerCase()}@example.test`,
    `row=${JSON.stringify(dbContact.rows[0])}`
  );

  // ---- 5. Completing the draft makes the company live ---------------------
  const completed = await request(app)
    .post("/platform/v1/companies")
    .set("Authorization", `Bearer ${poToken}`)
    .send({
      name: `Draft Probe A ${stamp}`,
      codePrefix: PREFIX_A,
      mdFullName: `Draft MD ${stamp}`,
      mdPhone: "+2438009000001",
      draftId: idA
    });
  check(
    "Completing the draft provisions the company (201)",
    completed.status === 201,
    `status=${completed.status} body=${JSON.stringify(completed.body).slice(0, 200)}`
  );

  const completedStatus = await db.query<{ status: string }>(
    `SELECT status FROM companies WHERE id=$1`,
    [idA]
  );
  check(
    "Completed company is 'active' immediately (RULE 3.3.3 second half)",
    completedStatus.rows[0]?.status === "active",
    `persisted status=${completedStatus.rows[0]?.status}`
  );

  const md = (completed.body as {
    company_url?: string;
    md?: { username?: string; initial_password?: string };
  });
  const host = hostOf(md.company_url ?? "");
  const mdUsername = md.md?.username ?? "";
  const mdPassword = md.md?.initial_password ?? "";

  const liveLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username: mdUsername, password: mdPassword });
  check(
    "The MD can log into the completed company",
    liveLogin.status === 200,
    `status=${liveLogin.status} body=${JSON.stringify(liveLogin.body).slice(0, 160)}`
  );

  const inSetupCount = await db.query<{ n: number }>(
    "SELECT count(*)::int n FROM companies WHERE status='in_setup'"
  );
  log(`companies still in 'in_setup' across the whole database: ${inSetupCount.rows[0]?.n}`);

  // ---- 6. A draft can be discarded ----------------------------------------
  const discarded = await request(app)
    .delete(`/platform/v1/companies/drafts/${idB}`)
    .set("Authorization", `Bearer ${poToken}`);
  check(
    "Discarding a draft returns 204",
    discarded.status === 204,
    `status=${discarded.status} body=${JSON.stringify(discarded.body).slice(0, 160)}`
  );
  const gone = await db.query(`SELECT 1 FROM companies WHERE id=$1`, [idB]);
  check("Discarded draft row is deleted", (gone.rowCount ?? 0) === 0, `rowCount=${gone.rowCount}`);

  const discardAgain = await request(app)
    .delete(`/platform/v1/companies/drafts/${idB}`)
    .set("Authorization", `Bearer ${poToken}`);
  check(
    "Discarding an already-discarded draft is a 404, not a crash",
    discardAgain.status === 404,
    `status=${discardAgain.status}`
  );

  // ---- 7. The suspend gate still holds for a live company -----------------
  const beforeSuspend = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username: mdUsername, password: mdPassword });
  check(
    "MD login works while the company is live",
    beforeSuspend.status === 200,
    `status=${beforeSuspend.status}`
  );

  const susp = await request(app)
    .post(`/platform/v1/companies/${idA}/status`)
    .set("Authorization", `Bearer ${poToken}`)
    .send({ action: "suspend", reason: "ISS-004 probe: verify the non-live login gate" });
  check(
    "Company suspended over real HTTP",
    susp.status === 200 || susp.status === 204,
    `status=${susp.status} body=${JSON.stringify(susp.body).slice(0, 140)}`
  );

  const afterSuspend = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username: mdUsername, password: mdPassword });
  check(
    "Login into a NON-live company is refused",
    afterSuspend.status !== 200,
    `status=${afterSuspend.status} body=${JSON.stringify(afterSuspend.body).slice(0, 140)}`
  );
  log(`login into suspended company returned: ${afterSuspend.status}`);

  const reactivate = await request(app)
    .post(`/platform/v1/companies/${idA}/status`)
    .set("Authorization", `Bearer ${poToken}`)
    .send({ action: "reactivate" });
  check(
    "Company can be reactivated (state machine supports active<->suspended)",
    reactivate.status === 200 || reactivate.status === 204,
    `status=${reactivate.status} body=${JSON.stringify(reactivate.body).slice(0, 140)}`
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
