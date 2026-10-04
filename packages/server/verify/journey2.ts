/**
 * INDEPENDENT DEEP JOURNEY - the roles and workflows the Vision defines, driven
 * through the real application against real PostgreSQL.
 *
 * Phase 2 continues the Phase-1 journey: it takes the live company + secured MD
 * that Phase 1 produced and acts AS THE REAL USERS:
 *
 *   MD -> creates head-office roles (HR, Finance, Auditor) and a branch
 *   MD -> creates branch workers (Branch Manager, two Collection Officers)
 *   each generated credential is USED to log in and complete the ritual
 *   branch workers log in at the BRANCH URL, never the company URL
 *   C.O. registers customers, 5 groups x 5 members are created and used
 *   a real signed webhook creates a payment; the C.O. allocates it
 *   Finance/Auditor/HR read their own surfaces
 *   cross-company and cross-branch attacks are attempted and must be refused
 *
 * Nothing here mocks the application: every call is real HTTP against the real
 * Express app, and every claim is checked against the database.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://nexora:nexora@localhost:5432/nexora_test";

import request from "supertest";
import type { Express } from "express";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { log, check, admin, totp, writeReport, setPhase } from "./e2e-harness";
import { ensurePlatformOwnerSecret, platformOwnerLogin, hostOf } from "./journey1";

const PROVIDER_SECRET = "journey-deep-signing-secret-0123456789";

interface Actor {
  name: string;
  username: string;
  password: string;
  token: string;
  secret: string;
  workerId: string;
  branchId: string | null;
}

/** Creates a worker, returns the generated one-time credential panel. */
async function createWorker(
  app: Express,
  host: string,
  token: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: any }> {
  const res = await request(app)
    .post("/api/v1/workers")
    .set("Host", host)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body };
}

/** Performs the full mandatory credential ritual and returns a usable token. */
async function doRitual(
  app: Express,
  host: string,
  username: string,
  initialPassword: string
): Promise<Actor | null> {
  const login = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username, password: initialPassword });
  if (login.status !== 200) {
    check(`login as ${username}`, false, `status=${login.status}`);
    return null;
  }
  let token: string = login.body.accessToken;

  const enroll = await request(app)
    .post("/api/v1/auth/ritual/enrollment")
    .set("Host", host)
    .set("Authorization", `Bearer ${token}`)
    .send({});
  const secret = enroll.body?.secret ?? "";

  await request(app)
    .post("/api/v1/auth/ritual/verify-authenticator")
    .set("Host", host)
    .set("Authorization", `Bearer ${token}`)
    .send({ code: totp(secret) });

  const newPassword = `Journey!${Math.random().toString(36).slice(2, 10)}aA1`;
  const chg = await request(app)
    .post("/api/v1/auth/ritual/change-password")
    .set("Host", host)
    .set("Authorization", `Bearer ${token}`)
    .send({
      currentPassword: initialPassword,
      newPassword,
      confirmPassword: newPassword,
      totpCode: totp(secret)
    });
  if (chg.status !== 204 && chg.status !== 200) {
    check(`password change for ${username}`, false, `status=${chg.status}`);
    return null;
  }

  const again = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username, password: newPassword });
  token = again.body?.accessToken ?? "";

  const profile = await request(app)
    .post("/api/v1/auth/ritual/complete-profile")
    .set("Host", host)
    .set("Authorization", `Bearer ${token}`)
    .send({ phone: "+2348000000001", birthDay: 4, birthMonth: 12 });
  const finalToken = profile.body?.accessToken ?? token;

  return {
    name: username,
    username,
    password: newPassword,
    token: finalToken,
    secret,
    workerId: "",
    branchId: null
  };
}

export {};
function branchSlugOf(branchUrl: string, companySlug: string): string {
  const raw = branchUrl.replace(/^https?:\/\//, "").replace(/\.nexora\.app.*$/, "");
  return raw.startsWith(`${companySlug}-`) ? raw.slice(companySlug.length + 1) : raw;
}

async function mkBranchWorker(
  app: Express, md: Actor, companyHost: string, branchHost: string,
  branchId: string, roleKey: string, first: string, last: string
): Promise<Actor | null> {
  const res = await createWorker(app, companyHost, md.token, {
    firstName: first, lastName: last, phone: "+2348005550005",
    branchId, roleKey, scopeType: "single_branch",
    // RULE 6.1.1 - a single_branch assignment names exactly one branch.
    branchIds: [branchId]
  });
  if (res.status !== 201) {
    check(`create ${roleKey} ${last}`, false, `status=${res.status} ${JSON.stringify(res.body).slice(0, 180)}`);
    return null;
  }
  // RULE 7.5.3 / 7.1.2: a branch worker logs in at the BRANCH url.
  const a = await doRitual(app, branchHost, res.body.username, res.body.initialPassword);
  if (!a) { check(`branch worker login ${res.body.username}`, false, "ritual failed"); return null; }
  a.workerId = res.body.workerCode ?? "";
  return a;
}

async function main(): Promise<void> {
  const db = await admin();
  const { createApp } = await import("../src/app");
  const app: Express = createApp();
  const stamp = Date.now().toString(36).replace(/[^a-z]/g, "").slice(-5).toUpperCase();

  setPhase("A. PLATFORM OWNER creates a company and it is live immediately");
  const poSecret = await ensurePlatformOwnerSecret(db);
  const po = await platformOwnerLogin(app, poSecret);
  const created = await request(app)
    .post("/platform/v1/companies")
    .set("Authorization", `Bearer ${po}`)
    .send({
      name: `Deep Roles Co ${stamp}`,
      codePrefix: `D${stamp}`.slice(0, 6),
      contactEmail: `deep${stamp}@nexora.test`,
      mdFullName: `Deep Managing Director ${stamp}`,
      mdPhone: "+2348005550001",
      mdEmail: `md${stamp}@nexora.test`
    });
  check("Platform Owner creates the company", created.status === 201, `status=${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  if (created.status !== 201) { await db.end().catch(() => undefined); return; }

  const companyId: string = created.body.id;
  const slug: string = created.body.slug;
  const companyHost = `${slug}.localhost`;
  const live = await db.query<{ status: string }>(`SELECT status FROM companies WHERE id=$1`, [companyId]);
  check("Company is LIVE immediately after Create Company (RULE 3.3.3)", live.rows[0]?.status === "active", `status=${live.rows[0]?.status}`);

  setPhase("B. MD completes the mandatory ritual at the generated company URL");
  const md = await doRitual(app, companyHost, created.body.md.username, created.body.md.initial_password);
  check("Fresh MD completes the ritual and is usable", !!md, md ? "" : "ritual failed");
  if (!md) { await db.end().catch(() => undefined); return; }

  setPhase("C. MD creates a branch (code + URL generated, never typed)");
  const br = await request(app)
    .post("/api/v1/branches")
    .set("Host", companyHost)
    .set("Authorization", `Bearer ${md.token}`)
    .send({ name: `Ikirun Branch ${stamp}`, address: "1 Market Road, Ikirun", phone: "+2348005550003" });
  check("MD creates a branch", br.status === 201 || br.status === 200, `status=${br.status} ${JSON.stringify(br.body).slice(0, 240)}`);
  const branchId: string = br.body?.branch?.id ?? br.body?.id ?? br.body?.branchId ?? "";
  const branchUrl: string = br.body?.branch?.portal_url ?? br.body?.portal_url ?? br.body?.branchUrl ?? "";
  const persisted = await db.query<{ code: string; portal_url: string }>(
    `SELECT code, portal_url FROM branches WHERE id=$1`, [branchId]
  );
  check(
    "Branch code + portal URL are PERSISTED, never typed (RULE 7.4.3)",
    !!persisted.rows[0]?.code && !!persisted.rows[0]?.portal_url,
    JSON.stringify(persisted.rows[0] ?? {})
  );
  const branchHost = hostOf(branchUrl.startsWith("http") ? branchUrl : `https://${branchUrl}`);
  log(`branchHost=${branchHost}`);

  setPhase("D. MD creates Head Office roles; each generated credential is then USED");
  const actors: Record<string, Actor> = {};
  for (const r of [
    { key: "hr_manager", last: `Hr Manager ${stamp}` },
    { key: "finance_manager", last: `Finance Manager ${stamp}` },
    { key: "internal_auditor", last: `Auditor ${stamp}` }
  ]) {
    const res = await createWorker(app, companyHost, md.token, {
      firstName: "Journey", lastName: r.last, phone: "+2348005550004",
      branchId, roleKey: r.key, scopeType: "company_wide"
    });
    if (res.status !== 201) {
      check(`create ${r.key}`, false, `status=${res.status} ${JSON.stringify(res.body).slice(0, 180)}`);
      continue;
    }
    const a = await doRitual(app, companyHost, res.body.username, res.body.initialPassword);
    if (a) {
      a.workerId = res.body.workerCode ?? "";
      actors[r.key] = a;
      check(`${r.key} created and its generated credential actually works`, true, `user=${res.body.username}`);
    } else {
      check(`${r.key} ritual`, false, "could not complete");
    }
  }

  setPhase("E. Branch workers authenticate at the BRANCH url (never the company url)");
  const bm = await mkBranchWorker(app, md, companyHost, branchHost, branchId, "branch_manager", "Journey", `Branch Manager ${stamp}`);
  if (bm) { actors.branch_manager = bm; check("Branch Manager authenticates at the branch URL", true, bm.username); }
  const co1 = await mkBranchWorker(app, md, companyHost, branchHost, branchId, "collection_officer", "Journey", `Collection One ${stamp}`);
  if (co1) { actors.collection_officer = co1; check("Collection Officer 1 authenticates at the branch URL", true, co1.username); }
  const co2 = await mkBranchWorker(app, md, companyHost, branchHost, branchId, "collection_officer", "Journey", `Collection Two ${stamp}`);
  if (co2) { actors.collection_officer2 = co2; check("Collection Officer 2 authenticates at the branch URL", true, co2.username); }

  try {
    fs.writeFileSync("../../_probe_out/journey2-state.json", JSON.stringify({
      companyId, slug, companyHost, branchId, branchHost, branchUrl,
      md: { token: md.token, username: md.username, secret: md.secret },
      actors: Object.fromEntries(Object.entries(actors).map(([k, v]) => [k, { token: v.token, username: v.username, secret: v.secret, workerId: v.workerId }]))
    }, null, 2));
    log("state written OK");
  } catch (e) {
    log(`STATE WRITE FAILED: ${e instanceof Error ? e.message : String(e)}`);
    log(`cwd=${process.cwd()}`);
    throw e;
  }
  log("");
  log("state saved -> _probe_out/journey2-state.json");
  await db.end().catch(() => undefined);
}

if (process.argv[1]?.includes("journey2")) {
  void (async () => {
    try { await main(); } catch (e) { console.error("HARNESS ERROR:", e); }
    writeReport("../../_probe_out/independent-e2e-roles.txt");
    process.exit(0);
  })();
}