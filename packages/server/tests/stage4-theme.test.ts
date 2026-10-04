import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { seedWorld, withAdmin } from "./fixtures";
import { initPlatformOwner, poLogin, randomPrefix } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

async function alphaCompanyId(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(`SELECT id FROM companies WHERE slug='alpha-test'`);
    id = r.rows[0]!.id;
  });
  return id;
}

describe("stage 4 — company branding & theme variables", () => {
  it("updates brand tokens as an audited before/after edit", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    await initPlatformOwner();
    const token = await poLogin(app);
    const companyId = await alphaCompanyId();

    // Pin a known previous state first: the dev database persists across runs,
    // so without this the audit's before-value could legitimately already be
    // #123456 from an earlier run (non-idempotent flake).
    const reset = await request(app)
      .put(`/platform/v1/companies/${companyId}/theme`)
      .set("Authorization", `Bearer ${token}`)
      .send({ primaryColor: "#0000ff" });
    expect(reset.status).toBe(200);

    const put = await request(app)
      .put(`/platform/v1/companies/${companyId}/theme`)
      .set("Authorization", `Bearer ${token}`)
      .send({ primaryColor: "#123456", fontFamily: "Poppins" });
    expect(put.status).toBe(200);
    expect(put.body.primary_color).toBe("#123456");

    // Audit entry carries previous vs new values (PO Spec §26 Activity Log).
    await withAdmin(async (db) => {
      const row = await db.query(
        `SELECT action, previous_value, new_value FROM platform_audit_logs
          WHERE company_id=$1 AND action='themes.updated'
          ORDER BY created_at DESC LIMIT 1`,
        [companyId]
      );
      expect(row.rowCount).toBe(1);
      expect(row.rows[0].previous_value.primary_color).toBe("#0000ff");
      expect(row.rows[0].new_value.primary_color).toBe("#123456");
    });

    const bad = await request(app)
      .put(`/platform/v1/companies/${companyId}/theme`)
      .set("Authorization", `Bearer ${token}`)
      .send({ primaryColor: "#12345" }); // wrong length
    expect(bad.status).toBe(422);

    const unknownKey = await request(app)
      .put(`/platform/v1/companies/${companyId}/theme`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notAToken: true });
    expect(unknownKey.status).toBe(422); // strict schema rejects extras
  });

  it("configures the enabled role catalogue per company", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    await initPlatformOwner();
    const token = await poLogin(app);
    const companyId = await alphaCompanyId();

    const subset = ["head_office_administrator", "branch_manager", "collection_officer"];
    const put = await request(app)
      .put(`/platform/v1/companies/${companyId}/enabled-roles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabledRoleKeys: subset });
    expect(put.status).toBe(200);
    expect(put.body.enabled).toEqual([...subset].sort());

    const get = await request(app)
      .get(`/platform/v1/companies/${companyId}/enabled-roles`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body).toEqual([...subset].sort());

    const empty = await request(app)
      .put(`/platform/v1/companies/${companyId}/enabled-roles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabledRoleKeys: [] });
    expect(empty.status).toBe(422);

    const bogus = await request(app)
      .put(`/platform/v1/companies/${companyId}/enabled-roles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabledRoleKeys: ["space_marine"] });
    expect(bogus.status).toBe(422);
  });

  it("applies wizard branding + enabled roles at company creation time", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    await initPlatformOwner();
    const token = await poLogin(app);

    const created = await request(app)
      .post("/platform/v1/companies")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: `Brand Co ${Date.now()}`,
        codePrefix: randomPrefix(),
        mdFullName: "Brand Managing",
        mdPhone: "+2348000000004",
        branding: { primaryColor: "#00aa77", accentColor: "#ff8800" },
        enabledRoleKeys: ["md", "accountant"]
      });
    expect(created.status).toBe(201);

    const theme = await request(app)
      .get(`/platform/v1/companies/${created.body.id}/theme`)
      .set("Authorization", `Bearer ${token}`);
    expect(theme.status).toBe(200);
    expect(theme.body.primary_color).toBe("#00aa77");
    expect(theme.body.accent_color).toBe("#ff8800");
    expect(theme.body.secondary_color).toBe("#ffffff"); // Nexora default fallback

    const roles = await request(app)
      .get(`/platform/v1/companies/${created.body.id}/enabled-roles`)
      .set("Authorization", `Bearer ${token}`);
    expect(roles.body).toEqual(["accountant", "md"]);
  });

  it("serves each tenant its own stored tokens pre-auth by host — two-brand proof", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    await initPlatformOwner();
    const token = await poLogin(app);
    const companyId = await alphaCompanyId();

    await request(app)
      .put(`/platform/v1/companies/${companyId}/theme`)
      .set("Authorization", `Bearer ${token}`)
      .send({ primaryColor: "#123456" });

    const alpha = await request(app).get("/api/v1/theme").set("Host", ALPHA_HOST);
    expect(alpha.status).toBe(200);
    expect(alpha.body.company.slug).toBe("alpha-test");
    expect(alpha.body.tokens["--nx-color-primary"]).toBe("#123456");

    const beta = await request(app).get("/api/v1/theme").set("Host", BETA_HOST);
    expect(beta.status).toBe(200);
    expect(beta.body.company.slug).toBe("beta-test");
    // Same component tree, different identity — Part 1 §26's core requirement.
    expect(beta.body.tokens["--nx-color-primary"]).not.toBe("#123456");

    const unknown = await request(app).get("/api/v1/theme").set("Host", "nosuch.localhost");
    expect(unknown.status).toBe(404);
  });

  it("keeps components free of hard-coded hex colors (structural guard)", async () => {
    const webSrc = path.resolve(process.cwd(), "..", "web", "src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?)$/.test(e.name)) {
          const content = fs.readFileSync(p, "utf8");
          if (/#[0-9a-fA-F]{3,8}\b/.test(content)) offenders.push(path.relative(webSrc, p));
        }
      }
    };
    walk(webSrc);
    expect(offenders).toEqual([]); // theming is exclusively via --nx-* tokens
  });
});
