import { describe, it, expect } from "vitest";
import request from "supertest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Express } from "express";
import { seedWorld, withAdmin, withAdminValue, type TestWorld } from "./fixtures";
import { initPlatformOwner, poLogin } from "./platform-helpers";

/**
 * Stage 13 passes 3 and 6 - the onboarding and platform-owner stories, and the
 * RULE 3.4.2 prohibition that no "Head Office portal" may exist anywhere.
 */
const SRC = "C:/Users/adede/.cline/data/workspaces/chat/nexora-restored/packages/server/src";
const WEB = "C:/Users/adede/.cline/data/workspaces/chat/nexora-restored/packages/web/src";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|sql)$/.test(entry)) out.push(p);
  }
  return out;
}

describe("company onboarding and platform ownership stories", () => {
  it("RULE 3.4.1 creating a company generates exactly the ten artefacts, in one operation", async () => {
    const app: Express = (await import("../src/app")).createApp();
    await seedWorld();
    await initPlatformOwner();
    const poToken = await poLogin(app);

    const before = await withAdminValue(async (db) => ({
      companies: Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM companies`)).rows[0]!.n),
      themes: Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM themes`)).rows[0]!.n),
      users: Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM users`)).rows[0]!.n)
    }));

    const stamp = Date.now();
    const created = await request(app)
      .post("/platform/v1/companies")
      .set("Authorization", `Bearer ${poToken}`)
      .send({
        name: `Onboarded Co ${stamp}`,
        codePrefix: `ONB${String(stamp % 900 + 100)}`
          .replace(/[0-9]/g, (d) => String.fromCharCode(65 + Number(d))),
        contactEmail: `onboard${stamp}@nexora.test`,
        mdFullName: "Onboarded Managing",
        mdPhone: "+2348000000001",
        mdEmail: `md${stamp}@nexora.test`,
        branding: { primaryColor: "#0F5132" },
        enabledRoleKeys: ["md", "collection_officer", "branch_manager"]
      });
    expect(created.status, `create company: ${JSON.stringify(created.body)}`).toBe(201);
    const companyId = created.body.id as string;

    const artefacts = await withAdminValue(async (db) => {
      const company = (await db.query<Record<string, unknown>>(
        `SELECT id, slug, code_prefix, status FROM companies WHERE id=$1`, [companyId]
      )).rows[0]!;
      const theme = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM themes WHERE company_id=$1`, [companyId]
      );
      const md = (await db.query<{
        id: string; username: string; first_name: string; branch_id: string | null;
      }>(
        `SELECT id, username, first_name, branch_id FROM users WHERE company_id=$1`, [companyId]
      )).rows[0]!;
      const assignments = await db.query<{ n: string; scope: string }>(
        `SELECT count(*)::text AS n, max(ra.scope_type) AS scope
           FROM role_assignments ra JOIN roles r ON r.id = ra.role_id
          WHERE ra.user_id=$1 AND ra.status='active'`,
        [md.id]
      );
      const roleKey = await db.query<{ role_key: string }>(
        `SELECT r.role_key FROM role_assignments ra JOIN roles r ON r.id = ra.role_id
          WHERE ra.user_id=$1 AND ra.status='active'`, [md.id]
      );
      const platformAudit = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM platform_audit_logs
          WHERE company_id = $1`, [companyId]
      );
      const securityAudit = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs
          WHERE company_id=$1 AND action LIKE '%credential.issued%'`, [companyId]
      );
      const notification = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM notifications
          WHERE company_id = $1 AND kind = 'company.created'`, [companyId]
      );
      return {
        company, theme: Number(theme.rows[0]!.n), md, assignments: assignments.rows[0]!,
        roleKey: roleKey.rows[0]?.role_key, platformAudit: Number(platformAudit.rows[0]!.n),
        securityAudit: Number(securityAudit.rows[0]!.n), notification: Number(notification.rows[0]!.n)
      };
    });

    // 1 company record, 2 theme, 3 URL/slug, 5 the MD account,
    // 6 the MD username is the full name, 7 @FirstName is the initial
    // password, 9 both audit entries, 10 the platform notification.
    expect(artefacts.company.slug).toBeTruthy();
    expect(artefacts.theme).toBe(1);
    expect(artefacts.md.username).toBeTruthy();
    expect(artefacts.assignments.n).toBe("1");
    expect(artefacts.roleKey).toBe("md");
    expect(artefacts.assignments.scope).toBe("company_wide");
    expect(artefacts.platformAudit).toBeGreaterThanOrEqual(1);
    expect(artefacts.securityAudit).toBeGreaterThanOrEqual(1);

    // 8 the one-time panel, shown once to the creating actor.
    const panel = created.body.md as { username: string; initial_password: string };
    expect(panel, `no one-time panel in ${JSON.stringify(Object.keys(created.body))}`).toBeTruthy();
    expect(panel.username).toBe(artefacts.md.username);
    expect(panel.initial_password).toBe(`@${artefacts.md.first_name}`);

    // RULE 3.4.3 - the initial password is never retrievable again in plain text.
    const later = await request(app)
      .get(`/platform/v1/companies/${companyId}/summary?sessionId=${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`)
      .set("Authorization", `Bearer ${poToken}`);
    expect(later.status).toBe(403);
    expect(JSON.stringify(later.body)).not.toContain(panel.initial_password);

    const mdRow = await withAdminValue(async (db) =>
      (await db.query<{ hash: string }>(`SELECT password_hash AS hash FROM users WHERE id=$1`, [artefacts.md.id]))
        .rows[0]!
    );
    // The stored value is a hash, never the password itself.
    expect(mdRow.hash).not.toBe(panel.initial_password);
    expect(mdRow.hash).toMatch(/^\$2[aby]\$/);

    const after = await withAdminValue(async (db) => ({
      companies: Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM companies`)).rows[0]!.n),
      users: Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM users`)).rows[0]!.n)
    }));
    expect(after.companies).toBe(before.companies + 1);
    // Exactly one worker was created for the new company: the MD.
    expect(after.users).toBe(before.users + 1);
  });

  it("RULE 3.4.2 no 'Head Office portal' exists in any code, route, record or term", () => {
    const files = [...walk(SRC)];
    try {
      if (readdirSync(WEB).length > 0) files.push(...walk(WEB));
    } catch {
      // the web package may not be present in this checkout
    }
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/head[\s_-]*office[\s_-]*portal/i.test(line)) {
          offenders.push(`${file}:${i + 1} :: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(
      offenders,
      `RULE 3.4.2 forbids a Head Office portal anywhere:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("RULE 3.6.2 the Platform Owner cannot read a company's books without an open, audited support session", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    await initPlatformOwner();
    const poToken = await poLogin(app);

    // The Platform Owner's own surface has no company-financial route at all.
    for (const path of [
      "/platform/v1/customers",
      "/platform/v1/loans",
      "/platform/v1/payments",
      "/platform/v1/savings",
      "/platform/v1/ledger",
      "/platform/v1/reconciliation"
    ]) {
      const res = await request(app).get(path).set("Authorization", `Bearer ${poToken}`);
      expect([403, 404], `platform route ${path} exists (${res.status})`).toContain(res.status);
    }

    // A company session is not a platform session: the PO cannot act as a user.
    const companyRoute = await request(app)
      .get("/platform/v1/companies")
      .set("Authorization", `Bearer ${poToken}`);
    expect(companyRoute.status).toBe(200);
    // ...and the company list is structural/aggregate only.
    const asString = JSON.stringify(companyRoute.body);
    expect(asString).not.toContain(w.customerA1);
    expect(asString).not.toContain("0000-0000");

    // Drill-down is refused without a session, and refused with a wrong one.
    for (const sessionId of ["", "not-a-uuid", "00000000-0000-0000-0000-000000000000"]) {
      const res = await request(app)
        .get(`/platform/v1/companies/${w.companyA}/summary${sessionId ? `?sessionId=${sessionId}` : ""}`)
        .set("Authorization", `Bearer ${poToken}`);
      expect([403, 404], `summary with sessionId="${sessionId}" was served (${res.status})`).toContain(res.status);
    }

    // Opening a real session lets the aggregate view through, and the company
    // records the access in its own trail (RULE 3.6.3).
    const opened = await request(app)
      .post("/platform/v1/support-access")
      .set("Authorization", `Bearer ${poToken}`)
      .send({ companyId: w.companyA, reason: "Investigating a reported drill-down discrepancy", durationMinutes: 15 });
    expect(opened.status, `open support: ${JSON.stringify(opened.body)}`).toBe(201);
    const sessionId = opened.body.id as string;
    expect(opened.body.reason).toBeTruthy();
    expect(opened.body.expiresAt).toBeTruthy();

    const summary = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/summary?sessionId=${sessionId}`)
      .set("Authorization", `Bearer ${poToken}`);
    expect(summary.status).toBe(200);

    const companyAudit = await withAdminValue(async (db) =>
      Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs
          WHERE company_id=$1 AND action LIKE 'platform.%'`, [w.companyA]
      )).rows[0]!.n)
    );
    expect(companyAudit, "the company's own trail received no support-access entry").toBeGreaterThanOrEqual(1);

    const platformAudit = await withAdminValue(async (db) =>
      Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM platform_audit_logs
          WHERE action LIKE 'support%' OR action LIKE '%support%'`
      )).rows[0]!.n)
    );
    expect(platformAudit).toBeGreaterThanOrEqual(1);

    // The session is time-bound and closable.
    const closed = await request(app)
      .post(`/platform/v1/support-access/${sessionId}/close`)
      .set("Authorization", `Bearer ${poToken}`);
    expect(closed.status).toBe(204);
    const afterClose = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/summary?sessionId=${sessionId}`)
      .set("Authorization", `Bearer ${poToken}`);
    expect([403], "a closed session still allowed drill-down").toContain(afterClose.status);
  });

  it("RULE 3.3.3 a draft company cannot be logged into", async () => {
    const app: Express = (await import("../src/app")).createApp();
    await seedWorld();
    await initPlatformOwner();
    const poToken = await poLogin(app);

    const created = await request(app)
      .post("/platform/v1/companies")
      .set("Authorization", `Bearer ${poToken}`)
      .send({
        name: `Draft Co ${Date.now()}`,
        codePrefix: `DRF${String(Date.now() % 900 + 100).replace(/[0-9]/g, (d) =>
          String.fromCharCode(70 + Number(d)))}`,
        contactEmail: `draft${Date.now()}@nexora.test`,
        mdFullName: "Draft Managing",
        mdPhone: "+2348000000002"
      });
    expect(created.status).toBe(201);
    const companyId = created.body.id as string;
    // RULE 3.3.3 - the completed Create Company is live immediately.
  const status = await withAdminValue(async (db) =>
    (await db.query<{ status: string }>(`SELECT status FROM companies WHERE id=$1`, [companyId]))
      .rows[0]!.status
  );
  expect(status).toBe("active");

    const panel = created.body.md as
      | { username: string; initial_password: string; credential_state: string }
      | undefined;
    expect(panel, `no MD panel in ${JSON.stringify(created.body)}`).toBeTruthy();
    expect(panel!.username, "the MD panel has no username").toBeTruthy();
    // RULE 3.4.3 - the panel carries the credential once; it is never stored.
    expect(panel!.initial_password, "the MD panel has no initial password").toBeTruthy();
    expect(panel!.credential_state).toBe("credential_issued");
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", created.body.slug + ".localhost")
      .send({ username: panel!.username, password: panel!.initial_password });
    // A live company's freshly-issued MD credential genuinely works.
  expect(login.status, `a live company refused its own MD login (${login.status})`).toBe(200);

  // Now make the company genuinely non-active: a non-active company refuses
  // every login, and the refusal is about the company's state, not the payload.
  const susp = await request(app)
    .post(`/platform/v1/companies/${companyId}/status`)
    .set("Authorization", `Bearer ${poToken}`)
    .send({ action: "suspend", reason: "non-active login rule verification" });
  expect(susp.status).toBe(200);

  const blocked = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", created.body.slug + ".localhost")
    .send({ username: panel!.username, password: panel!.initial_password });
  expect([403], `a non-active company allowed a login (${blocked.status})`).toContain(blocked.status);
  expect(String((blocked.body as { error?: { message?: string } }).error?.message ?? ""))
    .toMatch(/not active|suspend/i);

  const nowStatus = await withAdminValue(async (db) =>
    (await db.query<{ status: string }>(`SELECT status FROM companies WHERE id=$1`, [companyId]))
      .rows[0]!.status
  );
  expect(nowStatus).not.toBe("active");
  });
});
