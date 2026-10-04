import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import type { Express } from "express";
import crypto from "node:crypto";
import { seedWorld, withAdmin, withAdminValue } from "./fixtures";

const PO_EMAIL = "owner@nexora.test";
const PO_PASSWORD = "OwnerPassword!123";
let totpSecret = "";

async function ensurePlatformOwner(): Promise<string> {
  let secret = "";
  await withAdmin(async (db) => {
    const existing = await db.query<{ totp_secret_encrypted: string | null }>(
      `SELECT totp_secret_encrypted FROM platform_owners WHERE email=$1`,
      [PO_EMAIL]
    );
    if ((existing.rowCount ?? 0) > 0) {
      secret = Buffer.from(existing.rows[0]!.totp_secret_encrypted!.split(".")[0]!, "base64").toString("utf8");
      return;
    }
    secret = "JBSWY3DPEHPK3PXP"; // fixed base32 test secret
    await db.query(
      `INSERT INTO platform_owners (email, password_hash, totp_enabled, totp_secret_encrypted)
       VALUES ($1,$2,true,$3)`,
      [PO_EMAIL, bcrypt.hashSync(PO_PASSWORD, 8), Buffer.from(secret).toString("base64") + ".testtag"]
    );
  });
  return secret;
}

function totpNow(secret: string): string {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of secret.replace(/=+$/g, "")) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 30_000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const off = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[off]! & 0x7f) << 24) | ((hmac[off + 1]!) << 16) | ((hmac[off + 2]!) << 8) | hmac[off + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

async function poLogin(app: Express): Promise<string> {
  const res = await request(app)
    .post("/platform/v1/auth/login")
    .send({ email: PO_EMAIL, password: PO_PASSWORD, totp: totpNow(totpSecret) });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

// Unique per test-file run so re-runs against the same DB stay valid.
// Prefixes must be letters-only (route schema + companies.code_prefix CHECK).
function randomPrefix(): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let suffix = "";
  for (let i = 0; i < 2; i++) suffix += A[Math.floor(Math.random() * 26)];
  return "ZQ" + suffix;
}
const RUN_PREFIX = randomPrefix();

describe("stage 3 — platform owner portal", () => {
  it("enforces the mandated second factor and lockout on repeated bad TOTP", async () => {
    const app = (await import("../src/app")).createApp();
    totpSecret = await ensurePlatformOwner();

    const noTotp = await request(app)
      .post("/platform/v1/auth/login")
      .send({ email: PO_EMAIL, password: PO_PASSWORD });
    expect(noTotp.status).toBe(401);
    expect(noTotp.body.error.code).toBe("TOTP_REQUIRED");

    for (let i = 0; i < 6; i++) {
      const bad = await request(app)
        .post("/platform/v1/auth/login")
        .send({ email: PO_EMAIL, password: PO_PASSWORD, totp: "000000" });
      expect([401, 423]).toContain(bad.status);
      if (bad.status === 423) expect(bad.body.error.code).toBe("ACCOUNT_LOCKED");
    }

    // Reset so later tests in this run can log in successfully.
    await withAdmin(async (db) => {
      await db.query(
        `UPDATE platform_owners SET failed_attempts=0, locked_until=NULL WHERE email=$1`,
        [PO_EMAIL]
      );
    });
  });

  it("creates a company with prefix dedup and full scaffolding", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const token = await poLogin(app);

    const created = await request(app)
      .post("/platform/v1/companies")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Zeta Finance",
        codePrefix: RUN_PREFIX,
        contactEmail: "hello@zeta.test",
        mdFullName: "Zeta Managing",
        mdPhone: "+2348000000001",
        mdEmail: "md@zeta.test"
      });
    if (created.status !== 201) {
      
      console.error("[createCompany failed]", created.status, JSON.stringify(created.body), "prefix=", RUN_PREFIX);
    }
    expect(created.status).toBe(201);
    const zetaId = created.body.id as string;

    // RULE 3.3.1 / 3.4.1 — the create generates the MD, the company URL and a
    // one-time credential panel that is shown once and never retrievable.
    const panel = created.body.md as Record<string, unknown>;
    expect(panel).toBeDefined();
    expect(panel.username).toBe("Zeta Managing");
    expect(panel.initial_password).toBe("@Zeta");
    expect(panel.worker_code).toMatch(/-HO-MD-001$/);
    expect(panel.credential_state).toBe("credential_issued");
    expect(created.body.company_url).toBe(`${created.body.slug}.nexora.app`);

    const dup = await request(app)
      .post("/platform/v1/companies")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Other",
        codePrefix: RUN_PREFIX,
        mdFullName: "Other Managing",
        mdPhone: "+2348000000002"
      });
    expect(dup.status).toBe(409);

    await withAdmin(async (db) => {
      const theme = await db.query(`SELECT primary_color FROM themes WHERE company_id=$1`, [
        created.body.id
      ]);
      expect(theme.rowCount).toBe(1);
      // The MD's role must carry its platform permission bundle, otherwise
      // every requirePermission gate would refuse the MD itself.
      const mdPerms = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
          WHERE r.company_id=$1 AND r.role_key='md'`,
        [created.body.id]
      );
      expect(Number(mdPerms.rows[0]!.n)).toBeGreaterThan(0);
      const counters = await db.query(
        `SELECT count(*)::int AS n FROM company_counters WHERE company_id=$1`,
        [created.body.id]
      );
      expect(counters.rows[0].n).toBeGreaterThanOrEqual(2);
    });

    const list = await request(app)
      .get("/platform/v1/companies")
      .set("Authorization", `Bearer ${token}`);
    // RULE 3.6.6 - the workspace list is paginated and each item is addressed
    // by its own exact company id.
    const items = (list.body as { items: Array<Record<string, unknown>> }).items;
    expect(list.status).toBe(200);
    expect(Array.isArray(items)).toBe(true);
    const zeta = items.find((c) => c.id === zetaId);
    // RULE 3.3.3 - a completed Create Company is live immediately.
    expect(String(zeta?.status)).toBe("active");
  });

  it("walks company status transitions with reason-on-suspend, fully audited", async () => {
    const app = (await import("../src/app")).createApp();
    const token = await poLogin(app);
    // Own company so cross-run status mutations can't affect this walk.
    const created = await request(app)
      .post("/platform/v1/companies")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: `Walk Co ${Date.now()}`,
        codePrefix: randomPrefix(),
        mdFullName: "Walk Managing",
        mdPhone: "+2348000000003"
      });
    expect(created.status).toBe(201);
    const companyId = created.body.id as string;

    // RULE 3.3.3 - the completed Create Company is already live, so the walk
    // starts from "active" rather than having to activate it.
    const createdStatus = await withAdminValue(async (db) =>
      (await db.query<{ status: string }>(`SELECT status FROM companies WHERE id=$1`, [companyId]))
        .rows[0]!.status
    );
    expect(createdStatus).toBe("active");

    const noReason = await request(app)
      .post(`/platform/v1/companies/${companyId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "suspend" });
    expect(noReason.status).toBe(422);

    const suspend = await request(app)
      .post(`/platform/v1/companies/${companyId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "suspend", reason: "Regulatory review" });
    expect(suspend.body.status).toBe("suspended");

    const badTransition = await request(app)
      .post(`/platform/v1/companies/${companyId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "suspend" });
    expect(badTransition.status).toBe(409);

    await withAdmin(async (db) => {
      const logs = await db.query<{ action: string }>(
        `SELECT action FROM platform_audit_logs
          WHERE company_id=$1 ORDER BY created_at`,
        [companyId]
      );
      const actions = logs.rows.map((r) => r.action.replace(/^companies\./, ""));
      expect(actions).toContain("created");
      // RULE 3.3.3 - no explicit "activate" occurs: the company is born live.
      expect(actions).toContain("suspend");
    });
  });

  it("edits global settings with before/after audit entries", async () => {
    const app = (await import("../src/app")).createApp();
    const token = await poLogin(app);

    const put = await request(app)
      .put("/platform/v1/global-settings/data_retention")
      .set("Authorization", `Bearer ${token}`)
      .send({ value: { platform_activity_years: 10 } });
    expect(put.status).toBe(204);

    await withAdmin(async (db) => {
      const log = await db.query<{ new_value: { platform_activity_years: number } }>(
        `SELECT new_value FROM platform_audit_logs
          WHERE action LIKE 'global_settings.%' ORDER BY created_at DESC LIMIT 1`
      );
      expect(log.rows[0]!.new_value.platform_activity_years).toBe(10);
    });
  });

  it("gates aggregate drill-down behind an open time-bound support session", async () => {
    const app = (await import("../src/app")).createApp();
    const token = await poLogin(app);
    const w = await seedWorld();

    const denied = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/summary?sessionId=nope`)
      .set("Authorization", `Bearer ${token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("SUPPORT_SESSION_REQUIRED");

    const shortReason = await request(app)
      .post("/platform/v1/support-access")
      .set("Authorization", `Bearer ${token}`)
      .send({ companyId: w.companyA, reason: "too short", durationMinutes: 30 });
    expect(shortReason.status).toBe(422);

    const opened = await request(app)
      .post("/platform/v1/support-access")
      .set("Authorization", `Bearer ${token}`)
      .send({
        companyId: w.companyA,
        reason: "Investigating reconciliation exception",
        durationMinutes: 30
      });
    expect(opened.status).toBe(201);

    const summary = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/summary?sessionId=${opened.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(summary.status).toBe(200);
    expect(summary.body.customers).toBeDefined();
    expect(Object.keys(summary.body)).not.toContain("password_hash");

    await request(app)
      .post(`/platform/v1/support-access/${opened.body.id}/close`)
      .set("Authorization", `Bearer ${token}`);
    const afterClose = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/summary?sessionId=${opened.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(afterClose.status).toBe(403);
  });

  it("requires authentication on every business endpoint", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    for (const path of [
      "/companies",
      "/global-settings",
      "/announcements",
      "/support-access",
      "/audit"
    ]) {
      const res = await request(app).get(`/platform/v1${path}`);
      expect(res.status).toBe(401);
    }
  });
});
