// Tenant Audit Trail explorer (Part 1 §25). The trail is append-only; this
// suite proves the read surface: full field set with actor identity, the
// filtering surface, and the transaction-reference link that traces a payment
// back to its source webhook (v2.1 change list item 6 — reachable by FK/ref,
// not report-time string-guessing).
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { seedWorld, withAdmin, type TestWorld } from "./fixtures";
import { activateProvider, staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";
const SECRET_A = "alpha-signing-secret-0123456789abcdef";

// The webhook-driven traceability test provisions provider config + GL chart
// and moves money through the pipeline; that residue must not leak into other
// suites (model.test's UNIQUE (company_id, code) gl_accounts probes).
async function cleanupAuditArtifacts(): Promise<void> {
  await withAdmin(async (db) => {
    const scope = `provider_txn_ref LIKE 'AUDIT-%'`;
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
          WHERE je.company_id IN (
            SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test')))`
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
      `DELETE FROM gl_accounts WHERE company_id IN (
         SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test'))`
    );
    await db.query(`DELETE FROM webhook_signing_secrets`);
    await db.query(`DELETE FROM payment_provider_configs`);
    await db.query(
      `DELETE FROM notifications WHERE recipient_customer_id IN (
         SELECT id FROM customers WHERE company_id IN (
           SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test')))
         AND kind='payment.received'`
    );
  });
}

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

describe("stage 7E - audit trail explorer", () => {
  afterAll(async () => {
    await cleanupAuditArtifacts();
  });
  it("lists audit entries with the full Part 1 §25 field set and actor identity", async () => {
    const app = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const aliceId = await alphaUserId("alice");

    const created = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .set("User-Agent", "audit-test/1.0")
      .send({
        branchId: w.branchA1,
        firstName: "Trailhead",
        lastName: "Walker",
        address: "1 Audit Avenue"
      });
    expect(created.status).toBe(201);
    const customerId = created.body.id as string;

    const found = await request(app)
      .get(`/api/v1/audit?action=customer.created&limit=50`)
      .set("Authorization", `Bearer ${token}`);
    expect(found.status).toBe(200);
    const entry = (found.body.items as Array<Record<string, unknown>>).find(
      (e) => e.entityId === customerId
    );
    expect(entry).toBeDefined();
    expect(entry!.entityType).toBe("customers");
    expect(entry!.actorUserId).toBe(aliceId);
    expect(entry!.actorUsername).toBe("alice");
    expect(entry!.action).toBe("customer.created");
    expect(entry!.branchId).toBe(w.branchA1);
    expect(entry!.createdAt).toBeTruthy();
    expect(entry!.previousValue).toBeNull();
    expect(entry!.newValue).toHaveProperty("customer_code");
    expect(entry!.userAgent).toBe("audit-test/1.0");
    expect(Number(found.body.total)).toBeGreaterThan(0);
  });

  it("filters by actor, branch, entity id, and entity type", async () => {
    const app = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const aliceId = await alphaUserId("alice");

    const c1 = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: w.branchA1, firstName: "Filter", lastName: "One", address: "2 Audit Avenue" });
    const c2 = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: w.branchA1, firstName: "Filter", lastName: "Two", address: "3 Audit Avenue" });
    expect(c1.status).toBe(201);
    expect(c2.status).toBe(201);

    const byActor = await request(app)
      .get(`/api/v1/audit?actorUserId=${aliceId}&action=customer.created`)
      .set("Authorization", `Bearer ${token}`);
    const idsActor = byActor.body.items.map((e: { entityId: string }) => e.entityId);
    expect(idsActor).toContain(c1.body.id);
    expect(idsActor).toContain(c2.body.id);

    // Customer creation writes one audit entry against the entity id
    // (customer.created); VA issuance is now an event at loan disbursement.
    const byEntity = await request(app)
      .get(`/api/v1/audit?entityId=${c2.body.id}&action=customer.created`)
      .set("Authorization", `Bearer ${token}`);
    expect(byEntity.body.items).toHaveLength(1);
    expect(byEntity.body.items[0].entityId).toBe(c2.body.id);
    expect(byEntity.body.items[0].entityType).toBe("customers");
    expect(byEntity.body.items[0].action).toBe("customer.created");

    const byEntityAll = await request(app)
      .get(`/api/v1/audit?entityId=${c2.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    const actions = byEntityAll.body.items.map((e: { action: string }) => e.action).sort();
    expect(actions).toEqual(["customer.created"]);

    const byBranch = await request(app)
      .get(`/api/v1/audit?branchId=${w.branchA1}`)
      .set("Authorization", `Bearer ${token}`);
    expect(byBranch.status).toBe(200);
    expect(
      byBranch.body.items.every((e: { branchId: string }) => e.branchId === w.branchA1)
    ).toBe(true);
  });

  it("returns a single entry and 404/400 on unknown or malformed ids", async () => {
    const app = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const created = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: w.branchA1, firstName: "Detail", lastName: "Check", address: "4 Audit Avenue" });
    expect(created.status).toBe(201);

    const list = await request(app)
      .get(`/api/v1/audit?entityId=${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    const entryId = list.body.items[0].id as string;

    const detail = await request(app)
      .get(`/api/v1/audit/${entryId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(entryId);
    expect(detail.body.entityType).toBe("customers");
    expect(detail.body.actorUsername).toBe("alice");

    const missing = await request(app)
      .get("/api/v1/audit/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(404);

    const malformed = await request(app)
      .get("/api/v1/audit/not-a-uuid")
      .set("Authorization", `Bearer ${token}`);
    expect(malformed.status).toBe(400);
  });

  it("links a payment to its webhook via transaction_ref (Part 1 §25 traceability)", async () => {
    const app = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "amy");

    await activateProvider(app, {
      host: ALPHA_HOST,
      mdUsername: "amy",
      branchId: w.branchA1,
      signingSecret: SECRET_A
    });

    const ref = nextRef("AUDIT-PAY");
    const body = { event: "payment.received", transaction: { reference: ref, account_number: "1000000001", amount: 4500 } };
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac("sha256", SECRET_A).update(`${ts}.${JSON.stringify(body)}`).digest("hex");
    const webhook = await request(app)
      .post("/api/v1/webhooks/payments/sandbox")
      .set("X-Nexora-Company", "alpha-test")
      .set("X-Nexora-Timestamp", ts)
      .set("X-Nexora-Signature", sig)
      .send(JSON.stringify(body));
    expect(webhook.status).toBe(200);

    const byRef = await request(app)
      .get(`/api/v1/audit?transactionRef=${ref}`)
      .set("Authorization", `Bearer ${token}`);
    expect(byRef.status).toBe(200);
    expect(
      byRef.body.items.every((e: { transactionRef: string | null }) => e.transactionRef === ref)
    ).toBe(true);
    const received = byRef.body.items.find(
      (e: { action: string }) => e.action === "payment.awaiting_allocation"
    );
    expect(received).toBeDefined();
    expect(received.action).toBe("payment.awaiting_allocation");
    expect(received.entityType).toBe("payments");
    expect(received.entityId).toBeTruthy();
    expect(received.transactionRef).toBe(ref);
    // The §25 traceability contract: the audit row's entityId is the actual
    // payment row created for this reference (independent of whether the
    // pipeline allocated to a loan or fell through to pure savings).
    let paymentId: string | undefined;
    await withAdmin(async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT id FROM payments WHERE company_id=$1 AND provider_txn_ref=$2`,
        [(await seedWorld()).companyA, ref]
      );
      paymentId = r.rows[0]?.id;
    });
    expect(paymentId).toBeTruthy();
    expect(received.entityId).toBe(paymentId);
    expect(received.branchId).toBe(w.branchA1);
  });

  it("enforces tenant isolation: a company never sees another's entries", async () => {
    const app = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");

    const created = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: w.branchA1, firstName: "Isolated", lastName: "Audit", address: "5 Audit Avenue" });
    expect(created.status).toBe(201);

    let betaEntryId = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ id: string }>(
        `INSERT INTO audit_logs (company_id, action, entity_type, transaction_ref)
         VALUES ((SELECT id FROM companies WHERE slug='beta-test'),
                 'beta.entry', 'customers', 'BETA-REF-0001') RETURNING id`
      );
      betaEntryId = r.rows[0]!.id;
    });

    // Bob's own list contains beta's entry (it accumulates one row per run).
    const bList = await request(app)
      .get("/api/v1/audit?limit=200&transactionRef=BETA-REF-0001")
      .set("Authorization", `Bearer ${bToken}`);
    expect(bList.status).toBe(200);
    expect(bList.body.items.length).toBeGreaterThanOrEqual(1);
    expect(bList.body.items.every((e: { action: string }) => e.action === "beta.entry")).toBe(true);
    expect(bList.body.items.every((e: { transactionRef: string }) => e.transactionRef === "BETA-REF-0001")).toBe(true);

    // Alice's list never shows beta's entry, nor can she read it by id.
    const aList = await request(app)
      .get("/api/v1/audit?limit=200&transactionRef=BETA-REF-0001")
      .set("Authorization", `Bearer ${token}`);
    expect(aList.body.items).toHaveLength(0);

    const cross = await request(app)
      .get(`/api/v1/audit/${betaEntryId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(cross.status).toBe(404);
  });
});