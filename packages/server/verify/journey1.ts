/**
 * INDEPENDENT end-to-end verification, phase 1: Platform Owner -> company ->
 * fresh MD -> the blocking credential ritual.
 *
 * Deliberately does not reuse the project's own journey assertions. It drives
 * the real app over real HTTP against real PostgreSQL and checks DATABASE state
 * as well as the HTTP response.
 *
 * Run: npx tsx verify/journey1.ts
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://nexora:nexora@localhost:5432/nexora_test";

import request from "supertest";
import type { Express } from "express";
import { log, check, admin, totp, writeReport, setPhase } from "./e2e-harness";

const PO_EMAIL = "owner.journey@nexora.test";
const PO_PASSWORD = "OwnerJourney!123";

const stamp = Date.now().toString(36).replace(/[^a-z]/g, "").slice(-5).toUpperCase();
export const COMPANY_NAME = `Journey MFI ${stamp}`;
/** RULE 3.3.1: the prefix is 3-6 uppercase LETTERS, unique platform-wide. */
export const PREFIX = `J${stamp}`.slice(0, 6);
export const MD_NAME = `Journey Managing Director ${stamp}`;
export const MD_FIRST = "Journey";
export const NEW_MD_PASSWORD = "MdJourney!2026secure";

export interface JourneyCtx {
  app: Express;
  poToken: string;
  companyId: string;
  companyUrl: string;
  companyHost: string;
  mdUsername: string;
  mdToken: string;
  mdTotpSecret: string;
}

export function hostOf(url: string): string {
  const m = /^https?:\/\/([^/]+)/.exec(url ?? "");
  return m ? m[1]! : (url || "");
}

/**
 * Ensures the fixed Platform Owner exists and returns its base32 TOTP secret.
 * Deliberately duplicated here (rather than imported from tests/platform-helpers)
 * so this harness stays runnable outside the vitest runner: the shared helper
 * imports `expect`, which throws outside vitest.
 */
export async function ensurePlatformOwnerSecret(db: import("pg").Client): Promise<string> {
  let secret = "";
  const existing = await db.query<{ totp_secret_encrypted: string | null }>(
    `SELECT totp_secret_encrypted FROM platform_owners WHERE email=$1`,
    [PO_EMAIL]
  );
  if ((existing.rowCount ?? 0) > 0) {
    secret = Buffer.from(
      existing.rows[0]!.totp_secret_encrypted!.split(".")[0]!,
      "base64"
    ).toString("utf8");
    return secret;
  }
  secret = "JBSWY3DPEHPK3PXP";
  const { default: bcrypt } = await import("bcryptjs");
  await db.query(
    `INSERT INTO platform_owners (email, password_hash, totp_enabled, totp_secret_encrypted)
     VALUES ($1,$2,true,$3)`,
    [PO_EMAIL, bcrypt.hashSync(PO_PASSWORD, 8), `${Buffer.from(secret).toString("base64")}.testtag`]
  );
  return secret;
}

/** Logs the Platform Owner in through the real HTTP endpoint with a live code. */
export async function platformOwnerLogin(
  app: unknown,
  secret: string
): Promise<string> {
  const req = (await import("supertest")).default(app);
  const res = await req
    .post("/platform/v1/auth/login")
    .send({ email: PO_EMAIL, password: PO_PASSWORD, totp: totp(secret) });
  if (res.status !== 200) {
    throw new Error(`Platform Owner login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

const PRE_RITUAL_PATHS: [string, string][] = [
  ["customers", "/api/v1/customers"],
  ["performance", "/api/v1/performance/summary"],
  ["workers", "/api/v1/workers"],
  ["branches", "/api/v1/branches"]
];

export async function runPhase1(): Promise<JourneyCtx | null> {
  const db = await admin();
  const { createApp } = await import("../src/app");
  const app: Express = createApp();

  setPhase("1. PLATFORM OWNER: login, Create Company, generated URL and MD credential");
  // NOTE: the Platform Owner bootstrap/login is implemented HERE rather than by
  // importing tests/platform-helpers, because that module imports `expect` from
  // vitest and therefore only runs inside the vitest runner. This keeps the
  // harness a genuine standalone driver of the real application, hitting the
  // real HTTP login endpoint with a real live authenticator code.
  const secret = await ensurePlatformOwnerSecret(db);
  const poToken = await platformOwnerLogin(app, secret);
  check("Platform Owner authenticates (password + live authenticator)", !!poToken);

  const me = await request(app).get("/platform/v1/me").set("Authorization", `Bearer ${poToken}`);
  check("Platform Owner /me resolves", me.status === 200, `status=${me.status}`);

  const created = await request(app)
    .post("/platform/v1/companies")
    .set("Authorization", `Bearer ${poToken}`)
    .send({
      name: COMPANY_NAME,
      codePrefix: PREFIX,
      contactEmail: `ops@${PREFIX.toLowerCase()}.test`,
      primaryColor: "#1d4ed8",
      mdFullName: MD_NAME,
      mdPhone: "+2348000000999",
      mdEmail: `md@${PREFIX.toLowerCase()}.test`
    });
  check("Create Company succeeds", created.status === 201, `status=${created.status} body=${JSON.stringify(created.body).slice(0, 300)}`);
  if (created.status !== 201) {
    await db.end().catch(() => undefined);
    return null;
  }

  const b = created.body;
  // The real response shape (verified from a live 201):
  //   { id, slug, code_prefix, company_url, md: { worker_code, username,
  //     initial_password, credential_state, expires_at } }
  const companyId: string = b.id ?? b.companyId ?? b.company?.id;
  const companyUrl: string = b.company_url ?? b.companyUrl ?? b.company?.url;
  const mdUsername: string = b.md?.username ?? b.mdUsername ?? b.credentials?.username;
  const mdPassword: string = b.md?.initial_password ?? b.mdPassword ?? b.credentials?.password;
  log(`companyId=${companyId}`);
  log(`companyUrl=${companyUrl}`);
  log(`mdUsername=${JSON.stringify(mdUsername)} mdPassword=${mdPassword}`);

  check("Company URL generated (RULE 2.3.1)", !!companyUrl);
  check("MD username is the full name (RULE 5.1.1)", mdUsername === MD_NAME, String(mdUsername));
  check("MD password is @FirstName (RULE 5.2.1)", mdPassword === `@${MD_FIRST}`, String(mdPassword));

  const hoTables = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name ~* 'head[-_ ]?office'`
  );

  check("No Head Office portal table (RULE 3.4.2)", hoTables.rows[0]!.n === "0");

  const theme = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM themes WHERE company_id=$1`,
    [companyId]
  );
  check("Company theme generated atomically (RULE 3.4.1.2)", theme.rows[0]!.n === "1");

  const users = await db.query<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE company_id=$1`,
    [companyId]
  );
  check("Exactly one MD worker account generated", users.rowCount === 1, `rows=${users.rowCount}`);
  check("Stored username equals the full name", users.rows[0]?.username === MD_NAME);

  const audit = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM platform_audit_logs WHERE company_id=$1`,
    [companyId]
  );
  check("Platform audit entry recorded for creation (RULE 3.4.1.9)", Number(audit.rows[0]!.n) > 0);

  const ritual = await runRitual(app, companyHost(companyUrl), mdUsername, mdPassword);
  if (!ritual) {
    await db.end().catch(() => undefined);
    return null;
  }
  return {
    app,
    poToken,
    companyId,
    companyUrl,
    companyHost: companyHost(companyUrl),
    mdUsername,
    mdToken: ritual.token,
    mdTotpSecret: ritual.secret
  };
}


/** The MD's blocking ritual, walked as the real MD (RULE 4.2.1 / 4.2.2). */
export async function runRitual(
  app: Express,
  host: string,
  mdUsername: string,
  mdPassword: string
): Promise<{ token: string; secret: string } | null> {
  setPhase("2. FRESH MD: the credential ritual is blocking, then opens the MD Board");
  log(`company host = ${host}`);

  const login1 = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username: mdUsername, password: mdPassword });
  check("MD logs in with the generated initial password", login1.status === 200, `status=${login1.status}`);
  let token: string = login1.body?.accessToken ?? "";
  check(
    "Login reports the ritual is required",
    login1.body?.mustChangePassword === true,
    JSON.stringify(login1.body).slice(0, 200)
  );

  for (const [label, path] of PRE_RITUAL_PATHS) {
    const r = await request(app).get(path).set("Host", host).set("Authorization", `Bearer ${token}`);
    check(
      `Company data refused before the ritual (${label}) (RULE 4.2.2)`,
      r.status === 401 || r.status === 403,
      `status=${r.status}`
    );
  }

  const enroll = await request(app)
    .post("/api/v1/auth/ritual/enrollment")
    .set("Host", host)
    .set("Authorization", `Bearer ${token}`)
    .send({});
  const secret: string = enroll.body?.secret ?? enroll.body?.totpSecret ?? "";
  check("Authenticator enrolment secret issued", enroll.status === 200 && !!secret, `status=${enroll.status} body=${JSON.stringify(enroll.body).slice(0, 200)}`);

  // RULE 5.3.1 / 14.1.1: the password change is authorised by a LIVE code, so the
  // authenticator is enrolled and verified before the password is changed.
  const verify = await request(app)
    .post("/api/v1/auth/ritual/verify-authenticator")
    .set("Host", host)
    .set("Authorization", `Bearer ${token}`)
    .send({ code: secret ? totp(secret) : "000000" });
  check(
    "Authenticator verified with a live code (RULE 4.2.1 step 3)",
    verify.status === 204 || verify.status === 200,
    `status=${verify.status} body=${JSON.stringify(verify.body).slice(0, 200)}`
  );

  const chg = await request(app)
    .post("/api/v1/auth/ritual/change-password")
    .set("Host", host)
    .set("Authorization", `Bearer ${token}`)
    .send({
      currentPassword: mdPassword,
      newPassword: NEW_MD_PASSWORD,
      confirmPassword: NEW_MD_PASSWORD,
      totpCode: secret ? totp(secret) : "000000"
    });
  check(
    "MD completes the password-change step (authorised by a live code)",
    chg.status === 204 || chg.status === 200,
    `status=${chg.status} body=${JSON.stringify(chg.body).slice(0, 200)}`
  );

  const oldPw = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username: mdUsername, password: mdPassword });
  check("Initial password is dead after the change (prohibition 4)", oldPw.status !== 200, `status=${oldPw.status}`);

  const login2 = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username: mdUsername, password: NEW_MD_PASSWORD });
  check("New password genuinely authenticates (RULE 5.2.2)", login2.status === 200, `status=${login2.status}`);
  token = login2.body?.accessToken ?? token;

  const profile = await request(app)
    .post("/api/v1/auth/ritual/complete-profile")
    .set("Host", host)
    .set("Authorization", `Bearer ${token}`)
    .send({ passportPhotoUrl: "/evidence/journey-passport.png", phone: "+2348000000999", birthDay: 4, birthMonth: 12 });
  check(
    "Profile completed (RULE 4.2.1 step 4)",
    profile.status === 200 || profile.status === 204,
    `status=${profile.status} body=${JSON.stringify(profile.body).slice(0, 200)}`
  );
  token = profile.body?.accessToken ?? token;

  const open = await request(app)
    .get("/api/v1/performance/summary")
    .set("Host", host)
    .set("Authorization", `Bearer ${token}`);
  check("MD Board opens only after the ritual is finished (RULE 4.2.2)", open.status === 200, `status=${open.status}`);

  return { token, secret };
}

if (process.argv[1]?.includes("journey1")) {
  void (async () => {
    try {
      const ctx = await runPhase1();
      // Always write the report, even on failure, so evidence is never lost.
      writeReport("../../_probe_out/independent-e2e.txt");
      process.exit(ctx ? 0 : 1);
    } catch (err) {
      console.error("HARNESS ERROR:", err);
      writeReport("../../_probe_out/independent-e2e.txt");
      process.exit(3);
    }
  })();
}

export function companyHost(u: string): string {
  return hostOf(u);
}
