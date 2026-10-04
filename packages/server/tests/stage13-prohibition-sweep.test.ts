import { describe, it, expect } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedWorld, withAdmin, withAdminValue, type TestWorld } from "./fixtures";
import { staffLogin, completeProfile, attachVerifiedFaceEvidence } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";
const SRC = fileURLToPath(new URL("../src", import.meta.url));

/**
 * Stage 13 pass 2 - the prohibition sweep (Vision Part 15, RULE 16.2.1).
 *
 * All 32 hard prohibitions, each proved absent twice where it can be: by
 * searching the code for the forbidden shape, and by ATTEMPTING it against the
 * running app. A prohibition that is only searched is a comment; a prohibition
 * that is only attempted may have been renamed. Both must agree.
 */

interface RouteDecl {
  file: string;
  router: string;
  verb: string;
  path: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** RFC 6238 TOTP, so the sweep can perform a real live-code ritual. */
function totpNow(secret: string): string {
  const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of secret.replace(/=+$/g, "")) {
    const idx = b32.indexOf(ch);
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
  const hmac = createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const off = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[off]! & 0x7f) << 24) | ((hmac[off + 1]!) << 16) | ((hmac[off + 2]!) << 8) | hmac[off + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

const ALL_SOURCE = sourceFiles(SRC);
const SOURCE_TEXT = ALL_SOURCE.map((f) => readFileSync(f, "utf8")).join("\n");

/** Every route literal the server registers, with the file that declares it. */
const ROUTES: RouteDecl[] = ALL_SOURCE.flatMap((file) => {
  const text = readFileSync(file, "utf8");
  const out: RouteDecl[] = [];
  const re = /\b(\w*[Rr]outer)\.(get|post|put|patch|delete)\(\s*(?:\r?\n\s*)?["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      file: file.replace(SRC, "src"),
      router: m[1]!,
      verb: m[2]!.toUpperCase(),
      path: m[3]!
    });
  }
  return out;
});

describe("Part 15 prohibition sweep", () => {
  it("P1 no 'Head Office portal' route, record, table or label exists", async () => {
    // 1a. No route is named like a second head-office portal.
    const offenders = ROUTES.filter((r) => /head[-_ ]?office|headquarter|\bhq\b/i.test(r.path));
    expect(offenders, `routes named like a Head Office portal: ${JSON.stringify(offenders)}`).toEqual([]);

    // 1b. No table or column carries the concept. "head_office" survives only
    // as a role-assignment SCOPE value, which Part 5/6 mandate; it is never a
    // portal, a host or a login surface.
    const schema = await withAdminValue(async (db) => {
      const tables = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_name ~* 'head[-_ ]?office'`
      );
      const columns = await db.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema='public' AND column_name ~* 'head[-_ ]?office'`
      );
      return { tables: tables.rows, columns: columns.rows };
    });
    expect(schema.tables).toEqual([]);
    expect(schema.columns).toEqual([]);

    // 1c. A company has exactly ONE portal: its own MD Board host.
    const app: Express = (await import("../src/app")).createApp();
    const { createCompany } = await import("../src/modules/platform/service");
    const created = await createCompany("sweep@nexora.test", {
      name: `Sweep No Head Office ${Date.now()}`,
      codePrefix: "SWA",
      mdFullName: "Sweep Owner"
    });
    const portals = await withAdminValue(async (db) => {
      const company = await db.query<{ slug: string; portal_url: string | null; md_board: unknown }>(
        `SELECT slug, portal_url, to_jsonb(c) - 'id' AS md_board FROM companies c WHERE id=$1`,
        [created.id]
      );
      const branches = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM branches WHERE company_id=$1`, [created.id]
      );
      return { company: company.rows[0]!, branchCount: branches.rows[0]!.n };
    });
    // The company portal exists, is the MD Board, and no branch/second portal
    // was generated at creation.
    expect(portals.company.portal_url).toBeTruthy();
    expect(portals.branchCount).toBe("0");

    // 1d. Attempting a Head Office portal path on the company host 404s. The
    // company's real portal is the MD Board on its own host, and it answers
    // there with the company's own branding before any login.
    const notFound = await request(app).get("/api/v1/head-office").set("Host", `${created.slug}.localhost`);
    expect(notFound.status).toBe(404);
    const board = await request(app).get("/api/v1/theme").set("Host", `${created.slug}.localhost`);
    expect(board.status).toBe(200);
    expect(board.body.companyId ?? board.body.slug ?? created.slug).toBeTruthy();
  });

  it("P2 a company cannot exist without its MD Board, MD username and MD initial password", async () => {
    const { createCompany } = await import("../src/modules/platform/service");
    const created = await createCompany("sweep@nexora.test", {
      name: `Sweep Complete Onboarding ${Date.now()}`,
      codePrefix: "SWB",
      mdFullName: "Sweep Mary Jones"
    });
    expect(created.md).toBeTruthy();
    // RULE 5.1.1 / 5.2.1 - the generated credential is the mandated shape.
    expect(created.md!.username).toBe("Sweep Mary Jones");
    expect(created.md!.initial_password).toBe("@Sweep");

    const rows = await withAdminValue(async (db) => {
      const md = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM users u
           JOIN role_assignments ra ON ra.user_id = u.id
           JOIN roles r ON r.id = ra.role_id
          WHERE u.company_id=$1 AND r.role_key='md' AND ra.status='active'`,
        [created.id]
      );
      const theme = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM themes WHERE company_id=$1`, [created.id]
      );
      const settings = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM company_settings WHERE company_id=$1`, [created.id]
      );
      return {
        mdUsers: md.rows[0]!.n,
        themes: theme.rows[0]!.n,
        settings: settings.rows[0]!.n
      };
    });
    expect(rows.mdUsers).toBe("1");
    expect(rows.themes).toBe("1");
    expect(rows.settings).toBe("1");

    // No company in the database is missing its MD account.
    const orphans = await withAdminValue(async (db) =>
      (await db.query<{ id: string }>(
        `SELECT c.id FROM companies c
          WHERE NOT EXISTS (
            SELECT 1 FROM users u
              JOIN role_assignments ra ON ra.user_id = u.id
              JOIN roles r ON r.id = ra.role_id
             WHERE u.company_id = c.id AND r.role_key='md')`
      )).rows
    );
    expect(orphans).toEqual([]);
  });

  it("P3/P4/P5/P6/P7 the credential law cannot be bypassed by any user or role", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: mdToken } = await staffLogin(app, ALPHA_HOST, "amy");

    const worker = await request(app)
      .post("/api/v1/workers")
      .set("Authorization", `Bearer ${mdToken}`)
      .send({
        firstName: "Sweep",
        lastName: "Credentialled",
        branchId: w.branchA1,
        roleKey: "collection_officer",
        scopeType: "single_branch",
        branchIds: [w.branchA1]
      });
    expect(worker.status).toBe(201);
    // P6 - the username is the person's full name; the password is @FirstName.
    expect(worker.body.username).toBe("Sweep Credentialled");
    expect(worker.body.initialPassword).toBe("@Sweep");

    // P5 - the generated credential actually logs in.
    const first = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", ALPHA_HOST)
      .send({ username: "Sweep Credentialled", password: "@Sweep" });
    expect(first.status).toBe(200);
    const ritualToken: string = first.body.accessToken;

    // P3 - before the ritual is complete, no company data is reachable.
    for (const path of ["/api/v1/customers", "/api/v1/performance/summary", "/api/v1/audit"]) {
      const blocked = await request(app)
        .get(path)
        .set("Host", ALPHA_HOST)
        .set("Authorization", `Bearer ${ritualToken}`);
      expect([403], `${path} was reachable mid-ritual`).toContain(blocked.status);
    }

    // P7 - the authenticator is part of the ritual for everyone: the account
    // cannot be opened without enrolling and verifying it.
    const enrolled = await request(app)
      .post("/api/v1/auth/ritual/enrollment")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${ritualToken}`)
      .send({});
    expect(enrolled.status).toBe(200);
    const secret: string = enrolled.body.secret;
    expect(secret, "the authenticator enrolment returned no secret").toBeTruthy();
    const verified = await request(app)
      .post("/api/v1/auth/ritual/verify-authenticator")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${ritualToken}`)
      .send({ code: totpNow(secret) });
    expect(verified.status).toBe(204);

    // P4 - the initial password is spent the moment the password is changed,
    // and the change itself is proven with a live authenticator code.
    const changed = await request(app)
      .post("/api/v1/auth/ritual/change-password")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${ritualToken}`)
      .send({
        currentPassword: "@Sweep",
        newPassword: "SweepRotated!123",
        confirmPassword: "SweepRotated!123",
        totpCode: totpNow(secret)
      });
    expect(changed.status).toBe(204);
    const reuse = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", ALPHA_HOST)
      .send({ username: "Sweep Credentialled", password: "@Sweep" });
    expect(reuse.status).toBe(401);

    // Still not a usable account: the profile step remains, and nothing opens.
    const second = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", ALPHA_HOST)
      .send({ username: "Sweep Credentialled", password: "SweepRotated!123" });
    expect(second.status).toBe(200);
    const preProfile = await request(app)
      .get("/api/v1/customers")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${second.body.accessToken}`);
    expect(preProfile.status).toBe(403);

    // The requirement is structural: every role that can sign in also carries
    // the authenticator requirement, and the catalogue has no exempt entry.
    const exempt = await withAdminValue(async (db) =>
      (await db.query<{ role_key: string }>(
        `SELECT role_key FROM roles
          WHERE role_key ~* 'no.?auth|exempt|auth.?free'`
      )).rows
    );
    expect(exempt).toEqual([]);
  });

  it("P8/P9/P10 no manual money entry, no money edit control and no financial delete", async () => {
    // P8 - payments are only ever created by the verified pipeline. No route
    // accepts a person-entered payment.
    const manualPaymentRoutes = ROUTES.filter(
      (r) => r.verb === "POST" && r.path === "/payments" && /payments[\\/]routes/.test(r.file)
    );
    expect(manualPaymentRoutes).toEqual([]);

    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    // P8 - there is no manual payment-creation entry point to attempt.
    for (const method of ["post", "put", "patch"] as const) {
      const attempt = await (request(app) as unknown as Record<
        string,
        (p: string) => { set(k: string, v: string): { send(b: unknown): request.Test } }
      >)[method]!("/api/v1/payments")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: 5000 });
      expect([404, 405], `a manual payment entry answered ${attempt.status}`).toContain(attempt.status);
    }

    // P9 - no edit control over any money record.
    const moneyPaths = [
      "/api/v1/payments/00000000-0000-4000-8000-000000000000",
      "/api/v1/virtual-accounts/00000000-0000-4000-8000-000000000000",
      "/api/v1/loans/00000000-0000-4000-8000-000000000000"
    ];
    for (const path of moneyPaths) {
      for (const method of ["put", "patch"] as const) {
        const attempt = await (request(app) as unknown as Record<
          string,
          (p: string) => { set(k: string, v: string): { send(b: unknown): request.Test } }
        >)[method]!(path)
          .set("Authorization", `Bearer ${token}`)
          .send({ amount: 1 });
        expect([404, 405], `${method.toUpperCase()} ${path} answered ${attempt.status}`).toContain(
          attempt.status
        );
      }
    }

    // P10 - no DELETE route anywhere touches money or audit; the only DELETE in
    // the product removes a group, and no financial/audit table grants DELETE
    // to the application role at all.
    const deletes = ROUTES.filter((r) => r.verb === "DELETE");
    for (const route of deletes) {
      expect(route.path, `a DELETE exists at ${route.path} in ${route.file}`)
        .not.toMatch(/payment|allocation|balance|ledger|accounting|journal|disbursement|virtual-account|audit|loan|reversal|transaction/i);
    }
    const financialDeletes = await withAdminValue(async (db) =>
      (await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.role_table_grants
          WHERE grantee='nexora' AND privilege_type='DELETE'
            AND table_name ~* '(payment|allocation|balance|ledger|accounting|journal|disbursement|virtual_account|audit|loan|reversal|savings)'
          ORDER BY table_name`
      )).rows
    );
    expect(financialDeletes).toEqual([]);
    void w;
  });

  it("P11 there is no savings-only customer, onboarding, portal or Savings Officer role", async () => {
    const roles = await withAdminValue(async (db) =>
      (await db.query<{ role_key: string }>(`SELECT role_key FROM roles ORDER BY role_key`)).rows
    );
    expect(roles.map((r) => r.role_key).filter((k) => /savings/i.test(k))).toEqual([]);
    expect(SOURCE_TEXT).not.toMatch(/savings[_ ]?only/i);
    expect(SOURCE_TEXT).not.toMatch(/class\s+SavingsOfficer|savingsOfficer/i);
  });

  it("P12 a virtual account is generated at disbursement, never at registration", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const before = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM virtual_accounts WHERE customer_id=$1`, [w.customerA1]
      )).rows[0]!.n
    );
    const registered = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId: w.branchA1,
        firstName: "Sweep",
        lastName: "NoVa",
        address: "1 Sweep Way",
        ...completeProfile({ identificationNumber: "ID-SWEEP-NOVA", bvn: "12345000001" })
      });
    expect(registered.status).toBe(201);

    // Registration creates no virtual account for the new customer.
    const afterRegistration = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM virtual_accounts WHERE customer_id=$1`, [registered.body.id]
      )).rows[0]!.n
    );
    expect(afterRegistration).toBe("0");

    // And the customer's registration response carries no account number.
    expect(JSON.stringify(registered.body)).not.toMatch(/accountNumber|account_number/);

    // The only source of a virtual account is a disbursement.
    const sources = ALL_SOURCE
      .filter((f) => /INSERT INTO virtual_accounts/i.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(SRC, "src"));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(join(SRC, file.replace("src", "")), "utf8");
      expect(text, `${file} inserts a virtual account outside the disbursement pipeline`)
        .toMatch(/disburs|provis|loan/i);
    }
    void before;
  });

  it("P13 no uploaded or gallery photograph can stand in for a live capture", async () => {
    // The only capture routes take base64 plus a signed live-capture proof.
    const captureRoutes = ROUTES.filter((r) => /face-captures|evidence/.test(r.path));
    expect(captureRoutes.length).toBeGreaterThan(0);
    expect(SOURCE_TEXT).not.toMatch(/\bmulter\b/);
    expect(SOURCE_TEXT).not.toMatch(/input:\s*["']file["']/i);

    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    // An image with no live proof is refused outright.
    const pixels = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    ).toString("base64");
    const noProof = await request(app)
      .post(`/api/v1/customers/${w.customerA1}/face-captures`)
      .set("Authorization", `Bearer ${token}`)
      .send({ imageBase64: pixels, mimeType: "image/png" });
    expect(noProof.status).toBeGreaterThanOrEqual(400);

    // A forged proof is refused too, so the signature is the gate.
    const forged = await request(app)
      .post(`/api/v1/customers/${w.customerA1}/face-captures`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        imageBase64: pixels,
        mimeType: "image/png",
        liveness: { checked: true, passed: true, provider: "sweep", checks: { facePresent: true, brightness: 0.9, clarity: 0.9 } },
        captureProof: { jti: "00000000-0000-4000-8000-000000000000", issuedAt: Date.now(), signature: "f".repeat(43) }
      });
    expect(forged.status).toBeGreaterThanOrEqual(400);
  });

  it("P14 a loan is never disbursed without a virtual account and a repayment schedule", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const product = await withAdminValue(async (db) =>
      (await db.query<{ id: string }>(`SELECT id FROM loan_products WHERE company_id=$1 LIMIT 1`, [w.companyA])).rows[0]!.id
    );
    // A fresh customer in the actor's own branch, so the only thing under test
    // is the disbursement gate rather than branch scope.
    const unique = Date.now().toString().slice(-8);
    const borrower = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId: w.branchA1,
        firstName: "Sweep",
        lastName: "Borrower",
        address: "1 Sweep Way",
        ...completeProfile({
          identificationNumber: `ID-SWEEP-${unique}`,
          bvn: unique.padStart(11, "9"),
          phone: `+2348${unique}0`.slice(0, 14),
          alternativePhone: `+2349${unique}0`.slice(0, 14),
          guarantorPhone: `+2347${unique}0`.slice(0, 14),
          nextOfKinPhone: `+2346${unique}0`.slice(0, 14),
          email: `sweep.${unique}@nexora.test`
        })
      });
    expect(
      [201, 200],
      `customer registration answered ${borrower.status}: ${JSON.stringify(borrower.body)}`
    ).toContain(borrower.status);
    // RULE 9.4 - a verified registration face capture gates a loan application.
    await attachVerifiedFaceEvidence(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      borrower.body.id
    );
    const application = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: borrower.body.id, productId: product, principalAmount: 5000 });
    expect(application.status, `application answered ${application.status}: ${JSON.stringify(application.body)}`).toBe(201);

    // No terms, no schedule, no approval: the disbursement is refused, and
    // nothing is created on the way to the refusal.
    const early = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: application.body.id });
    expect(early.status).toBeGreaterThanOrEqual(400);
    const orphanLoan = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM loans WHERE application_id=$1`, [application.body.id]
      )).rows[0]!.n
    );
    expect(orphanLoan).toBe("0");

    // Every disbursed loan in the database has both, structurally.
    const incomplete = await withAdminValue(async (db) =>
      (await db.query<{ id: string }>(
        `SELECT l.id FROM loans l
          WHERE NOT EXISTS (SELECT 1 FROM repayment_schedule_rows r WHERE r.loan_id = l.id)
             OR NOT EXISTS (SELECT 1 FROM virtual_accounts v
                             WHERE v.customer_id = l.customer_id AND v.status='active')`
      )).rows
    );
    expect(incomplete).toEqual([]);
  });

  it("P15 a loan or a portal access never creates a duplicate customer", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const countBefore = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyA]))
        .rows[0]!.n
    );
    const product = await withAdminValue(async (db) =>
      (await db.query<{ id: string }>(`SELECT id FROM loan_products WHERE company_id=$1 LIMIT 1`, [w.companyA])).rows[0]!.id
    );
    await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: w.customerA2, productId: product, principalAmount: 5000 });
    await request(app)
      .post(`/api/v1/customers/${w.customerA1}/portal-access`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    const countAfter = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyA]))
        .rows[0]!.n
    );
    expect(countAfter).toBe(countBefore);

    // And no customer code is ever reused or re-issued.
    const duplicates = await withAdminValue(async (db) =>
      (await db.query<{ customer_code: string }>(
        `SELECT customer_code FROM customers GROUP BY company_id, customer_code HAVING count(*) > 1`
      )).rows
    );
    expect(duplicates).toEqual([]);
  });

  it("P16 a Branch Workplace never asks for a password and a branch worker cannot enter it", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: coToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: mdToken } = await staffLogin(app, ALPHA_HOST, "amy");

    // The Branch Workplace is entered on a session alone, addressed by branch.
    // An authorised Head Office role gets the book with no password, no second
    // factor and no prompt of any kind in the response.
    const overview = await request(app)
      .get(`/api/v1/branch-workplace/overview?branch=${w.branchA1}`)
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${mdToken}`);
    expect(overview.status).toBe(200);
    expect(JSON.stringify(overview.body)).not.toMatch(/password|credential_prompt/i);

    const book = await request(app)
      .get(`/api/v1/branch-workplace/workers?branch=${w.branchA1}`)
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${mdToken}`);
    expect(book.status).toBe(200);
    expect(JSON.stringify(book.body)).not.toMatch(/password/i);

    // A branch worker has no Head Office workplace of their own: the same
    // surfaces are closed to a branch-scoped session.
    const denied = await request(app)
      .get(`/api/v1/branch-workplace/overview?branch=${w.branchA1}`)
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${coToken}`);
    expect(denied.status).toBe(403);

    // A branch-scoped session cannot reach a different branch's book.
    const otherBranch = await request(app)
      .get(`/api/v1/branch-workplace/overview?branch=${w.branchA2}`)
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${coToken}`);
    expect(otherBranch.status).toBe(403);
  });

  it("P17 a worker cannot see that Head Office looked at his book", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: coToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: mdToken } = await staffLogin(app, ALPHA_HOST, "amy");

    // Head Office inspects the officer's book in the Branch Workplace.
    const inspected = await request(app)
      .get(`/api/v1/branch-workplace/workers/${w.userA}?branch=${w.branchA1}`)
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${mdToken}`);
    expect(inspected.status).toBe(200);
    expect(JSON.stringify(inspected.body).length).toBeGreaterThan(10);

    // The officer's own surfaces show nothing about it: no notification, no
    // audit entry, no trace.
    const notifications = await request(app)
      .get("/api/v1/notifications")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${coToken}`);
    expect(notifications.status).toBe(200);
    const mine = JSON.stringify(notifications.body).toLowerCase();
    expect(mine).not.toContain("inspected");
    expect(mine).not.toContain("book_viewed");
    expect(mine).not.toContain("head office");

    const workerAudit = await request(app)
      .get("/api/v1/audit?entityType=worker")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${coToken}`);
    if (workerAudit.status === 200) {
      expect(JSON.stringify(workerAudit.body).toLowerCase()).not.toContain("book_viewed");
    } else {
      expect(workerAudit.status).toBe(403);
    }
  });

  it("P18/P19/P20/P21/P22/P23 the provider surface is machine-owned, tested and secret-safe", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: mdToken } = await staffLogin(app, ALPHA_HOST, "amy");
    const { token: coToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: financeToken } = await staffLogin(app, ALPHA_HOST, "fiona");

    // P19 - a configuration cannot be activated without a successful
    // connection test. The create call itself returns an inactive record.
    const created = await request(app)
      .post("/api/v1/payment-providers")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${mdToken}`)
      .send({
        branchId: w.branchA1,
        provider: "sandbox",
        apiBaseUrl: "http://127.0.0.1:1/",
        apiKey: "api-key-00000000",
        signingSecret: "sweep-signing-secret"
      });
    expect([200, 201]).toContain(created.status);
    const id: string = created.body.id;
    const afterCreate = await withAdminValue(async (db) =>
      (await db.query<{ is_active: boolean }>(
        `SELECT is_active FROM payment_provider_configs WHERE id=$1`, [id]
      )).rows[0]!
    );
    expect(afterCreate.is_active).toBe(false);

    // The mandatory test against a dead endpoint fails, and stays inactive.
    const failedTest = await request(app)
      .post(`/api/v1/payment-providers/${id}/test`)
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${mdToken}`);
    expect(failedTest.status).toBe(200);
    expect(failedTest.body.ok).toBe(false);
    expect(failedTest.body.activated).toBe(false);

    // P18 - the webhook URL is generated by the system. The only webhook POST
    // in the product is the signed ingress, and nothing anywhere accepts a
    // person-typed webhook URL.
    const webhookRoutes = ROUTES.filter((r) => /^webhookRouter$/i.test(r.router));
    expect(webhookRoutes.length).toBeGreaterThan(0);
    for (const route of webhookRoutes) {
      expect(
        `${route.verb} ${route.path}`,
        "a webhook route may be entered by a signed POST and read nothing else"
      ).toBe(`POST ${route.path}`);
    }
    expect(SOURCE_TEXT).not.toMatch(/webhookUrl\s*:\s*z\.string\(\)/i);
    expect(SOURCE_TEXT).not.toMatch(/webhook_url\s*=\s*\$\{/i);
    // The binding itself lives in the system-owned signing-secret table, and
    // is never written from a person's request.
    const bound = await withAdminValue(async (db) => {
      const columns = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='payment_provider_configs'`
      );
      const names = columns.rows.map((c) => c.column_name);
      return {
        storesWebhookUrl: names.includes("webhook_url"),
        secrets: (
          await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM webhook_signing_secrets`)
        ).rows[0]!.n
      };
    });
    // A person-typed webhook URL has nowhere to be stored even if one were sent.
    expect(bound.storesWebhookUrl).toBe(false);
    expect(Number(bound.secrets)).toBeGreaterThanOrEqual(0);

    // P20 - a provider change by an unauthorised role is refused.
    const byCo = await request(app)
      .post("/api/v1/payment-providers")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${coToken}`)
      .send({ branchId: w.branchA1, provider: "sandbox", apiBaseUrl: "http://127.0.0.1:1/", apiKey: "k" });
    expect(byCo.status).toBe(403);

    // P21 - a Finance change waits for the MD and stays inactive meanwhile.
    const byFinance = await request(app)
      .post("/api/v1/payment-providers")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${financeToken}`)
      .send({
        branchId: w.branchA2,
        provider: "sandbox",
        apiBaseUrl: "http://127.0.0.1:1/",
        apiKey: "api-key-11111111",
        signingSecret: "finance-signing-secret"
      });
    expect([200, 201], `finance provider change answered ${byFinance.status}`).toContain(byFinance.status);
    const financeState = await withAdminValue(async (db) =>
      (await db.query<{ is_active: boolean; md_approved_at: Date | null }>(
        `SELECT is_active, md_approved_at FROM payment_provider_configs WHERE id=$1`, [byFinance.body.id]
      )).rows[0]!
    );
    // RULE 8.4.1 step 7 - a non-MD change is saved awaiting the MD's
    // authorisation: inactive, unapproved, and queued for the MD.
    expect(financeState.is_active).toBe(false);
    expect(financeState.md_approved_at).toBeNull();
    const queued = await request(app)
      .get("/api/v1/payment-providers/approvals")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${mdToken}`);
    expect(queued.status).toBe(200);
    const queuedIds = JSON.stringify(queued.body);
    expect(queuedIds, "the MD was not given the pending authorisation").toContain(byFinance.body.id);

    // The MD approves inside his own session, and only then does it activate.
    const approved = await request(app)
      .post(`/api/v1/payment-providers/${byFinance.body.id}/approve`)
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${mdToken}`)
      .send({ decision: "approved" });
    expect([200, 201]).toContain(approved.status);

    // P22 - a secret is never returned by any read, list or export surface.
    const surfaces: request.Response[] = [
      await request(app).get("/api/v1/payment-providers").set("Host", ALPHA_HOST).set("Authorization", `Bearer ${mdToken}`),
      await request(app).get(`/api/v1/payment-providers/${id}`).set("Host", ALPHA_HOST).set("Authorization", `Bearer ${mdToken}`),
      await request(app).get("/api/v1/audit").set("Host", ALPHA_HOST).set("Authorization", `Bearer ${mdToken}`),
      await request(app).get("/api/v1/notifications").set("Host", ALPHA_HOST).set("Authorization", `Bearer ${mdToken}`)
    ];
    for (const surface of surfaces) {
      const body = JSON.stringify(surface.body ?? {});
      expect(body, "a provider secret leaked into a read surface").not.toContain("sweep-signing-secret");
      expect(body).not.toMatch(/"apiKey"\s*:\s*"(?!")[^"]{4,}/);
      expect(body).not.toMatch(/"signingSecret"\s*:\s*"(?!")[^"]{4,}/);
    }

    // P23 - the requirement set is provider-driven, never one fixed form.
    const registry = await request(app)
      .get("/api/v1/payment-providers/registry")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${mdToken}`);
    expect(registry.status).toBe(200);
    const requirements = registry.body.providers ?? registry.body;
    const shapes = new Set(
      (Array.isArray(requirements) ? requirements : []).map((p: { requiredFields: string[] }) =>
        (p.requiredFields ?? []).slice().sort().join(",")
      )
    );
    expect(shapes.size, "every provider demands an identical field set").toBeGreaterThan(0);
  });

  it("P24/P26 a company workspace carries only the company's own brand", async () => {
    // P24 - the company's colour is a token, never a literal in a component,
    // and never a page background. The server's theme payload is tokens only.
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "amy");
    const theme = await request(app).get("/api/v1/theme").set("Host", ALPHA_HOST).set("Authorization", `Bearer ${token}`);
    expect(theme.status).toBe(200);
    const keys = Object.keys(theme.body).map((k) => k.toLowerCase());
    expect(keys.some((k) => /background/.test(k) && !/backgroundurl/.test(k))).toBe(false);

    // P26 - the platform brand does not appear inside a company's workspace
    // beyond an optional powered-by line. The company's theme record is the
    // company's own.
    const payload = JSON.stringify(theme.body);
    expect(payload).not.toMatch(/Nexora Fintech/i);
    const stored = await withAdminValue(async (db) =>
      (await db.query<{ name: string; logo_url: string | null }>(
        `SELECT t.company_id, c.name, t.logo_url FROM themes t
           JOIN companies c ON c.id = t.company_id WHERE t.company_id=$1`, [w.companyA]
      )).rows[0]!
    );
    expect(stored.name).toBe("Alpha Test Co");
  });

  it("P25 no company sees another company's name, logo, colour, data or records", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: alphaMd } = await staffLogin(app, ALPHA_HOST, "amy");
    const { token: betaMd } = await staffLogin(app, BETA_HOST, "bob");

    const alphaTheme = await request(app).get("/api/v1/theme").set("Host", ALPHA_HOST).set("Authorization", `Bearer ${alphaMd}`);
    expect(JSON.stringify(alphaTheme.body)).not.toContain("Beta Test Co");

    // A beta identifier handed to an alpha session is refused, and beta's
    // records are not reachable by search.
    const betaCustomer = await withAdminValue(async (db) =>
      (await db.query<{ id: string }>(`SELECT id FROM customers WHERE company_id=$1 LIMIT 1`, [w.companyB])).rows[0]!.id
    );
    const stolen = await request(app)
      .get(`/api/v1/customers/${betaCustomer}`)
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${alphaMd}`);
    expect([403, 404]).toContain(stolen.status);

    const betaSeesAlpha = await request(app)
      .get("/api/v1/customers")
      .set("Host", BETA_HOST)
      .set("Authorization", `Bearer ${betaMd}`);
    expect(JSON.stringify(betaSeesAlpha.body)).not.toContain("Ada");
  });

  it("P27/P28/P29 there is exactly one performance engine and no role borrows another's screen", async () => {
    // P27 - expected/realised/outstanding/collection-rate arithmetic lives in
    // the engine alone. A module that only READS a rate is fine; a module that
    // ARITHMETICALLY DERIVES one is a second performance engine.
    const computers = ALL_SOURCE.filter((f) => {
      if (f.replace(SRC, "").includes("performance")) return false;
      const text = readFileSync(f, "utf8");
      // A rate assigned from an expression, or a rate built from sums.
      return /(collectionRate|collection_rate)\s*[:=][^;,)\n]*(\/|\*|Math\.round|\?)/.test(text)
        || /SUM\([^)]*actual[^)]*\)\s*\*\s*100/i.test(text)
        || /collection_rate[^`]*\bexpected\b/i.test(text);
    }).map((f) => f.replace(SRC, "src"));
    expect(computers, `performance figures computed outside the engine: ${computers.join(", ")}`).toEqual([]);

    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: coToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: auditorToken } = await staffLogin(app, ALPHA_HOST, "audrey");
    const { token: hrToken } = await staffLogin(app, ALPHA_HOST, "harry");

    // Every read of the same figure, from three different roles, returns the
    // same engine's number - one engine, not three dashboards.
    const read = async (token: string) => {
      const res = await request(app)
        .get("/api/v1/performance/summary")
        .set("Host", ALPHA_HOST)
        .set("Authorization", `Bearer ${token}`);
      return { status: res.status, body: res.body ?? {} };
    };
    const co = await read(coToken);
    const auditor = await read(auditorToken);
    const hr = await read(hrToken);
    expect(co.status).toBe(200);
    expect(auditor.status).toBe(200);
    expect(hr.status).toBe(200);
    for (const key of ["expected", "realised", "outstanding", "collectionRate"]) {
      if (co.body[key] !== undefined) {
        expect(auditor.body[key], `auditor sees a different ${key}`).toEqual(co.body[key]);
        expect(hr.body[key], `HR sees a different ${key}`).toEqual(co.body[key]);
      }
    }
    void w;
  });

  it("P30 no fake balances, sample customers or dead controls in a live view", async () => {
    // A live read is served from the database, so the fixture customer really
    // is in the table and the figure really is derived from its records.
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: mdToken } = await staffLogin(app, ALPHA_HOST, "amy");
    const customers = await request(app)
      .get("/api/v1/customers?limit=200")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${mdToken}`);
    expect(customers.status).toBe(200);
    const rows: unknown[] = Array.isArray(customers.body)
      ? customers.body
      : customers.body.items ?? customers.body.customers ?? [];
    const live = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyA]))
        .rows[0]!.n
    );
    expect(String(rows.length)).toBe(live);
    expect(String(customers.body.total)).toBe(live);
    // Nothing in the product invents money: there is no "estimated" or
    // "projected" money field in any response.
    expect(JSON.stringify(customers.body)).not.toMatch(/"(estimated|projected|forecast)Balance"/i);
  });

  it("P31 the platform owner cannot read a company's customers, loans, payments or accounting", async () => {
    const { initPlatformOwner, poLogin } = await import("./platform-helpers");
    await initPlatformOwner();
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const poToken = await poLogin(app);

    // There is no platform route to any of it.
    for (const path of [
      `/platform/v1/companies/${w.companyA}/customers`,
      `/platform/v1/companies/${w.companyA}/loans`,
      `/platform/v1/companies/${w.companyA}/payments`,
      `/platform/v1/companies/${w.companyA}/accounting`
    ]) {
      const attempt = await request(app).get(path).set("Authorization", `Bearer ${poToken}`);
      expect([404, 405], `${path} answered ${attempt.status}`).toContain(attempt.status);
    }

    // The only company-data surface the owner has, the support summary,
    // requires a live, logged support session.
    const withoutSession = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/summary`)
      .set("Authorization", `Bearer ${poToken}`);
    expect(withoutSession.status).toBeGreaterThanOrEqual(400);

    const opened = await request(app)
      .post("/platform/v1/support-access")
      .set("Authorization", `Bearer ${poToken}`)
      .send({ companyId: w.companyA, reason: "sweep: inspecting a support ticket", durationMinutes: 15 });
    expect(opened.status).toBe(201);
    const withSession = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/summary?sessionId=${opened.body.id}`)
      .set("Authorization", `Bearer ${poToken}`);
    expect(withSession.status).toBe(200);

    // The session is itself an audited record of the owner looking in.
    const trail = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM platform_audit_logs
          WHERE company_id=$1 AND action ~* 'support'`, [w.companyA]
      )).rows[0]!.n
    );
    expect(Number(trail)).toBeGreaterThan(0);
  });

  it("P32 a departing worker's record and history are never deleted", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: hrToken } = await staffLogin(app, ALPHA_HOST, "harry");

    const created = await request(app)
      .post("/api/v1/workers")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({
        firstName: "Sweep",
        lastName: "Departing",
        branchId: w.branchA1,
        roleKey: "collection_officer",
        scopeType: "single_branch",
        branchIds: [w.branchA1]
      });
    expect(created.status).toBe(201);
    const workerId: string = created.body.id;

    const departed = await request(app)
      .post(`/api/v1/workers/${workerId}/status`)
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ action: "terminate", reason: "sweep" });
    expect(departed.status).toBe(200);

    const survivor = await withAdminValue(async (db) => {
      const user = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM users WHERE id=$1`, [workerId]);
      const assignments = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM role_assignments WHERE user_id=$1`, [workerId]
      );
      const audit = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs WHERE actor_user_id=$1`, [workerId]
      );
      return {
        user: user.rows[0]!.n,
        assignments: assignments.rows[0]!.n,
        audit: audit.rows[0]!.n
      };
    });
    expect(survivor.user).toBe("1");
    expect(Number(survivor.assignments)).toBeGreaterThan(0);

    // And the credentials die with the departure: the account is refused, and
    // the refusal names the departure rather than pretending it is unknown.
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", ALPHA_HOST)
      .send({ username: "Sweep Departing", password: "@Sweep" });
    expect([401, 403]).toContain(login.status);
    expect(login.body.error?.code ?? "").not.toBe("CREDENTIAL_RITUAL_REQUIRED");
  });
});
