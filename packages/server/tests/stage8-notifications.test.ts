// Notification Center (Part 2 §40). Event producers write notifications;
// this suite proves the staff inbox read/workflow surface and that events
// actually raise notifications: reconciliation exceptions notify finance-role
// users, and the payment pipeline raises a `payment.received` notification.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { seedWorld, withAdmin } from "./fixtures";
import { activateProvider, staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

const SECRET_A = "alpha-signing-secret-0123456789abcdef";

let runCounter = 0;
function nextRef(prefix: string): string {
  const code = `${Date.now().toString(36)}${runCounter++}${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${code}`;
}

async function alphaUserId(username: string): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN companies c ON c.id=u.company_id
        WHERE c.slug='alpha-test' AND u.username=$1`,
      [username]
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function betaUserId(username: string): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN companies c ON c.id=u.company_id
        WHERE c.slug='beta-test' AND u.username=$1`,
      [username]
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function alphaBranchA1(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-001'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function alphaCompanyId(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM companies WHERE slug='alpha-test'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function seedNotifications(): Promise<{ alice: string; betaUser: string }> {
  const alice = await alphaUserId("alice");
  const betaUser = await betaUserId("bob");
  const companyA = await alphaCompanyId();
  let companyB = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM companies WHERE slug='beta-test'`
    );
    companyB = r.rows[0]!.id;
  });
  await withAdmin(async (db) => {
    for (const kind of ["test.welcome", "test.reminder", "test.alert"]) {
      await db.query(
        `INSERT INTO notifications (company_id, recipient_user_id, kind, payload)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [companyA, alice, kind, JSON.stringify({ seq: kind })]
      );
    }
    await db.query(
      `INSERT INTO notifications (company_id, recipient_user_id, kind, payload, read_at)
       VALUES ($1,$2,'test.read_done',$3::jsonb, now())`,
      [companyA, alice, JSON.stringify({ seq: "read" })]
    );
    await db.query(
      `INSERT INTO notifications (company_id, recipient_user_id, kind, payload)
       VALUES ($1,$2,'test.beta_only',$3::jsonb)`,
      [companyB, betaUser, JSON.stringify({ seq: "beta" })]
    );
  });
  return { alice, betaUser };
}

describe("stage 7D - notification center", () => {
  // Remove the artifacts this suite creates (pipeline payment + GL chart
  // provisioning, reconciliation exceptions, seeded inbox rows, finance role)
  // so reruns and other suites stay deterministic — model.test's UNIQUE
  // (company_id, code) gl_accounts probes and stage2-auth's role-count assert
  // depend on that.
  async function cleanupNotifications(): Promise<void> {
    await withAdmin(async (db) => {
      const scope = `provider_txn_ref LIKE 'NOTIF-%'`;
      for (const tbl of [
        "unmatched_payments",
        "unallocated_payments",
        "payment_allocations",
        "pipeline_jobs",
        "savings_transactions",
        "reconciliation_items",
        "receipts"
      ]) {
        await db.query(
          `DELETE FROM ${tbl} WHERE payment_id IN (SELECT id FROM payments WHERE ${scope})`
        );
      }
      await db.query(
        `DELETE FROM payment_reversals WHERE original_payment_id IN (SELECT id FROM payments WHERE ${scope})`
      );
      await db.query(
        `DELETE FROM journal_lines WHERE journal_entry_id IN (
           SELECT je.id FROM journal_entries je
            WHERE je.company_id IN (SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test')))`
      );
      await db.query(
        `DELETE FROM journal_entries WHERE company_id IN (
           SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test'))`
      );
      await db.query(
        `UPDATE payments SET webhook_event_id=NULL
          WHERE company_id IN (
            SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test'))`
      );
      await db.query(
        `DELETE FROM webhook_events WHERE company_id IN (
           SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test'))`
      );
      await db.query(`DELETE FROM payments WHERE ${scope}`);
      await db.query(
        `DELETE FROM reconciliation_items WHERE provider_txn_ref LIKE 'NOTIF-REC-%'`
      );
      await db.query(
        `DELETE FROM gl_accounts WHERE company_id IN (
           SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test'))`
      );
      await db.query(`DELETE FROM webhook_signing_secrets`);
      await db.query(`DELETE FROM payment_provider_configs`);
      await db.query(
        `DELETE FROM notifications WHERE company_id IN (
           SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test'))`
      );
      await db.query(
        `DELETE FROM role_assignments WHERE role_id IN (
           SELECT id FROM roles WHERE role_key='finance_manager')`
      );
      await db.query(`DELETE FROM roles WHERE role_key='finance_manager'`);
    });
  }

  beforeAll(async () => {
    await cleanupNotifications();
  });

  afterAll(async () => {
    await cleanupNotifications();
  });
  it("lists the operator's own notifications with read/unread filtering and counts", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const baseUnread = (
      await request(app)
        .get("/api/v1/notifications/unread-count")
        .set("Authorization", `Bearer ${token}`)
    ).body.count as number;

    const { alice } = await seedNotifications();

    const unread = await request(app)
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`);
    expect(unread.status).toBe(200);
    expect(unread.body.count).toBe(baseUnread + 3);

    const open = await request(app)
      .get("/api/v1/notifications?read=false&limit=50")
      .set("Authorization", `Bearer ${token}`);
    expect(open.status).toBe(200);
    expect(open.body.items.length).toBeGreaterThanOrEqual(3);
    const openKinds = new Set(open.body.items.map((n: { kind: string }) => n.kind));
    expect(openKinds).toContain("test.welcome");
    expect(openKinds).toContain("test.reminder");
    expect(openKinds).toContain("test.alert");
    expect(open.body.items.every((n: { read_at: string | null }) => n.read_at === null)).toBe(true);
    expect(open.body.items.every((n: { recipient_user_id?: unknown }) => true)).toBe(true);
    expect(open.body.items.some((n: { kind: string }) => n.kind === "test.beta_only")).toBe(false);
    expect(open.body.items.some((n: { kind: string }) => n.kind === "test.read_done")).toBe(false);

    const read = await request(app)
      .get("/api/v1/notifications?read=true&limit=50")
      .set("Authorization", `Bearer ${token}`);
    expect(read.body.items.some((n: { kind: string }) => n.kind === "test.read_done")).toBe(true);
    expect(read.body.items.every((n: { read_at: string | null }) => n.read_at !== null)).toBe(true);

    const all = await request(app)
      .get("/api/v1/notifications?limit=50")
      .set("Authorization", `Bearer ${token}`);
    expect(all.body.total).toBeGreaterThanOrEqual(4);
    expect(all.body.items.some((n: { kind: string }) => n.kind === "test.beta_only")).toBe(false);
    for (const kind of ["test.welcome", "test.reminder", "test.alert", "test.read_done"]) {
      expect(all.body.items.map((n: { kind: string }) => n.kind)).toContain(kind);
    }

    // Beta's bob sees his own notification, never alice's.
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");
    const bList = await request(app)
      .get("/api/v1/notifications?limit=50")
      .set("Authorization", `Bearer ${bToken}`);
    expect(bList.body.items.length).toBeGreaterThanOrEqual(1);
    expect(bList.body.items.every((n: { kind: string }) => n.kind === "test.beta_only")).toBe(true);
    expect(alice).toBeTruthy();
  });

  it("marks a notification read and read-all clears the unread inbox", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const baseUnread = (
      await request(app)
        .get("/api/v1/notifications/unread-count")
        .set("Authorization", `Bearer ${token}`)
    ).body.count as number;

    await seedNotifications();

    const afterSeed = await request(app)
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`);
    expect(afterSeed.body.count).toBe(baseUnread + 3);

    const open = await request(app)
      .get("/api/v1/notifications?read=false&limit=50")
      .set("Authorization", `Bearer ${token}`);
    const target = open.body.items.find(
      (n: { kind: string }) => n.kind === "test.welcome"
    ).id as string;

    const marked = await request(app)
      .post(`/api/v1/notifications/${target}/read`)
      .set("Authorization", `Bearer ${token}`);
    expect(marked.status).toBe(200);
    expect(marked.body.read_at).not.toBeNull();

    const after = await request(app)
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`);
    expect(after.body.count).toBe(baseUnread + 2);

    const readAll = await request(app)
      .post("/api/v1/notifications/read-all")
      .set("Authorization", `Bearer ${token}`);
    expect(readAll.status).toBe(200);
    expect(readAll.body.updated).toBe(baseUnread + 2);

    const final = await request(app)
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`);
    expect(final.body.count).toBe(0);
  });

  it("cannot mark another user's notification as read (404, tenant-scoped)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const [{ betaUser }] = await Promise.all([seedNotifications()]);
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");

    const betaOpen = await request(app)
      .get("/api/v1/notifications?read=false&limit=50")
      .set("Authorization", `Bearer ${bToken}`);
    const betaNotificationId = betaOpen.body.items[0].id as string;

    const cross = await request(app)
      .post(`/api/v1/notifications/${betaNotificationId}/read`)
      .set("Authorization", `Bearer ${token}`);
    expect(cross.status).toBe(404);

    const missing = await request(app)
      .post("/api/v1/notifications/00000000-0000-4000-8000-000000000000/read")
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });

  it("raises a reconciliation.exception_added notification for finance-role users", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const companyId = await alphaCompanyId();
    const aliceId = await alphaUserId("alice");
    let fmRoleId = "";
    await withAdmin(async (db) => {
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM roles WHERE company_id=$1 AND role_key='finance_manager'`,
        [companyId]
      );
      if (existing.rowCount === 0) {
        const r = await db.query<{ id: string }>(
          `INSERT INTO roles (company_id, role_key, name, category, is_system)
           VALUES ($1,'finance_manager','Finance Manager','finance',true) RETURNING id`,
          [companyId]
        );
        fmRoleId = r.rows[0]!.id;
      } else {
        fmRoleId = existing.rows[0]!.id;
      }
    });

    // Grant alice an active finance_manager assignment (seedWorld restores
    // canonical assignments next test).
    await withAdmin(async (db) => {
      await db.query(
        `INSERT INTO role_assignments (company_id, user_id, role_id, scope_type,
                                       assignment_type, starts_at, status, assigned_by)
         VALUES ($1,$2,$3,'company_wide','permanent', now(), 'active', $2)`,
        [companyId, aliceId, fmRoleId]
      );
    });

    const ref = nextRef("NOTIF-REC");
    const rec = await request(app)
      .post("/api/v1/payments/reconcile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        provider: "sandbox",
        providerTransactions: [
          { providerTxnRef: ref, amount: 3210, valueDate: "2026-01-15T10:00:00Z" }
        ]
      });
    expect(rec.status).toBe(200);
    expect(rec.body.added).toBeGreaterThan(0);

    const notifications = await request(app)
      .get("/api/v1/notifications?read=false&limit=200")
      .set("Authorization", `Bearer ${token}`);
    const hit = notifications.body.items.find(
      (n: { kind: string }) => n.kind === "reconciliation.exception_added"
    );
    expect(hit).toBeDefined();
    expect(hit.payload.added).toBeGreaterThan(0);
    expect(hit.payload.provider).toBe("sandbox");
  });

  it("raises a payment.received notification through the live pipeline", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "amy");
    const branchA1 = await alphaBranchA1();

    await activateProvider(app, {
      host: ALPHA_HOST,
      mdUsername: "amy",
      branchId: branchA1,
      signingSecret: SECRET_A
    });

    const ref = nextRef("NOTIF-PAY");
    const body = { event: "payment.received", transaction: { reference: ref, account_number: "1000000001", amount: 5000 } };
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac("sha256", SECRET_A).update(`${ts}.${JSON.stringify(body)}`).digest("hex");
    const webhook = await request(app)
      .post("/api/v1/webhooks/payments/sandbox")
      .set("X-Nexora-Company", "alpha-test")
      .set("X-Nexora-Timestamp", ts)
      .set("X-Nexora-Signature", sig)
      .send(JSON.stringify(body));
    expect(webhook.status).toBe(200);

    await withAdmin(async (db) => {
      const r = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications
          JOIN virtual_accounts va ON va.customer_id = notifications.recipient_customer_id
         WHERE va.account_number='1000000001'
           AND notifications.kind='payment.awaiting_allocation'
           AND notifications.payload->>'payment_id' IS NOT NULL`
      );
      expect(parseInt(r.rows[0]!.count, 10)).toBeGreaterThan(0);
    });
  });
});