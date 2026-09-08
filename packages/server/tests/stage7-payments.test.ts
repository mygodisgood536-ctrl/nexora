// Stage 7D - Payment pipeline tests (Part 1 Section 21).
// Exercises provider config CRUD, signed webhook ingestion, idempotency,
// the 13-step pipeline progression, allocation engine, reconciliation,
// exception handling, and tenant/branch isolation against live PostgreSQL.
import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { Express } from "express";
import { seedWorld, withAdmin } from "./fixtures";
import { staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

const SECRET_A = "alpha-signing-secret-0123456789abcdef";
const SECRET_B = "beta-signing-secret-0123456789abcdef";

let providerA: string;
let providerB: string;
let secretA = SECRET_A;
let secretB = SECRET_B;

// Per-run unique refs so reruns against the same DB do not trip idempotency.
let runCounter = 0;
function nextRef(prefix: string): string {
  const code = `${Date.now().toString(36)}${runCounter++}${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${code}`;
}

async function hmacSig(secret: string, ts: string, bodyString: string): Promise<string> {
  return crypto.createHmac("sha256", secret).update(`${ts}.${bodyString}`).digest("hex");
}

function signBody(body: object, secret: string, ts: string): { ts: string; body: string; sig: string } {
  const bodyString = JSON.stringify(body);
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${bodyString}`).digest("hex");
  return { ts, body: bodyString, sig };
}

async function postWebhook(
  app: Express,
  opts: {
    provider: string;
    companySlug: string;
    body: object;
    secret?: string | null;
    signature?: string | null;
    timestamp?: string | null;
  }
): Promise<request.Response> {
  const req = request(app)
    .post(`/api/v1/webhooks/payments/${opts.provider}`)
    .set("X-Nexora-Company", opts.companySlug)
    .set("Content-Type", "application/json");
  if (opts.timestamp !== null && opts.timestamp !== undefined) {
    req.set("X-Nexora-Timestamp", opts.timestamp);
  }
  if (opts.secret) {
    const ts = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
    req.set("X-Nexora-Timestamp", ts);
    req.set("X-Nexora-Signature", await hmacSig(opts.secret, ts, JSON.stringify(opts.body)));
  } else if (opts.signature !== null && opts.signature !== undefined) {
    req.set("X-Nexora-Signature", opts.signature);
  }
  req.send(JSON.stringify(opts.body));
  return req;
}

async function getAlphaBranchA1(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-001'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function getAlphaBranchA2(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-002'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function getBetaBranchB1(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='beta-test') AND code='BTA-001'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function getCompanyId(slug: string): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(`SELECT id FROM companies WHERE slug=$1`, [slug]);
    id = r.rows[0]!.id;
  });
  return id;
}

async function saveOutstanding(loanCode: string): Promise<string> {
  let op = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ outstanding_principal: string }>(
      `SELECT l.outstanding_principal FROM loans l
        JOIN companies c ON c.id=l.company_id
       WHERE c.slug='alpha-test' AND l.principal_amount='30000'
       LIMIT 1`
    );
    op = r.rows[0]!.outstanding_principal;
  });
  return op;
}

// Remove test-created artifacts before the suite so reruns stay deterministic.
async function cleanupPayments(): Promise<void> {
  await withAdmin(async (db) => {
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test'),
           beta  AS (SELECT id AS company_id FROM companies WHERE slug='beta-test')
      DELETE FROM unmatched_payments WHERE payment_id IN (
        SELECT id FROM payments p WHERE (p.company_id IN (SELECT company_id FROM alpha))
      )
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test'),
           beta  AS (SELECT id AS company_id FROM companies WHERE slug='beta-test')
      DELETE FROM unallocated_payments WHERE payment_id IN (
        SELECT id FROM payments p WHERE (p.company_id IN (SELECT company_id FROM alpha))
      )
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test'),
           beta  AS (SELECT id AS company_id FROM companies WHERE slug='beta-test')
      DELETE FROM payment_allocations WHERE payment_id IN (
        SELECT id FROM payments p WHERE (p.company_id IN (SELECT company_id FROM alpha))
      )
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test'),
           beta  AS (SELECT id AS company_id FROM companies WHERE slug='beta-test')
      DELETE FROM payment_reversals WHERE original_payment_id IN (
        SELECT id FROM payments p WHERE (p.company_id IN (SELECT company_id FROM alpha))
      )
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test'),
           beta  AS (SELECT id AS company_id FROM companies WHERE slug='beta-test')
      DELETE FROM pipeline_jobs WHERE payment_id IN (
        SELECT id FROM payments p WHERE (p.company_id IN (SELECT company_id FROM alpha))
      )
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test'),
           beta  AS (SELECT id AS company_id FROM companies WHERE slug='beta-test')
      DELETE FROM savings_transactions WHERE payment_id IN (
        SELECT id FROM payments p WHERE (p.company_id IN (SELECT company_id FROM alpha))
      )
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test'),
           beta  AS (SELECT id AS company_id FROM companies WHERE slug='beta-test')
      DELETE FROM reconciliation_items WHERE payment_id IN (
        SELECT id FROM payments p WHERE (p.company_id IN (SELECT company_id FROM alpha))
      )
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test'),
           beta  AS (SELECT id AS company_id FROM companies WHERE slug='beta-test')
      DELETE FROM receipts WHERE payment_id IN (
        SELECT id FROM payments p WHERE (p.company_id IN (SELECT company_id FROM alpha))
      )
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test'),
           beta  AS (SELECT id AS company_id FROM companies WHERE slug='beta-test')
      DELETE FROM webhook_exceptions WHERE company_id IN (SELECT company_id FROM alpha)
    `);
    await db.query(`DELETE FROM payments WHERE provider_txn_ref LIKE 'PAY-T-%'`);
    await db.query(`DELETE FROM payments WHERE provider_txn_ref LIKE 'REV-T-%'`);
    await db.query(`DELETE FROM payments WHERE provider_txn_ref LIKE 'UNMATCH-%'`);
    // Reset loan outstanding + schedule rows that the pipeline mutated.
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test')
      UPDATE repayment_schedule_rows rsr
         SET actual_repayment=0, actual_savings=0, paid_at=NULL
        FROM loans l, alpha
       WHERE l.id=rsr.loan_id AND l.company_id=alpha.company_id
         AND l.principal_amount='30000'
    `);
    await db.query(`
      WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test')
      UPDATE loans l
         SET outstanding_principal='30000', status='active', completed_at=NULL
        FROM alpha
       WHERE l.company_id=alpha.company_id AND l.principal_amount='30000'
    `);
    // Remove VAs/test customers created by this suite only.
    await db.query(`DELETE FROM virtual_accounts WHERE account_number LIKE '555000000%'`);
    await db.query(`DELETE FROM customers WHERE customer_code='PAY-TEST'`);
    // Reconfigure provider secrets.
    await db.query(`DELETE FROM webhook_signing_secrets`);
    await db.query(`DELETE FROM payment_provider_configs`);
    secretA = SECRET_A;
    secretB = SECRET_B;
  });
}

async function configureProvider(
  app: Express,
  host: string,
  username: string,
  branchId: string,
  provider: string,
  secret: string
): Promise<request.Response> {
  const { token } = await staffLogin(app, host, username);
  return request(app)
    .post("/api/v1/payment-providers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      branchId,
      provider,
      apiBaseUrl: "https://payments.example.test/v1",
      apiKey: "api-key-00000000",
      signingSecret: secret
    });
}

beforeAll(async () => {
  const app = (await import("../src/app")).createApp();
  await seedWorld();
  await cleanupPayments();
  const bA1 = await getAlphaBranchA1();
  const bB1 = await getBetaBranchB1();
  await configureProvider(app, ALPHA_HOST, "alice", bA1, "sandbox", secretA);
  await configureProvider(app, BETA_HOST, "bob", bB1, "sandbox", secretB);
  providerA = bA1;
  providerB = bB1;
});

describe("stage 7D - provider configuration", () => {
  it("creates an active provider config and stores the signing secret", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .get("/api/v1/payment-providers")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.provider).not.toBeNull();
    expect(res.body.provider.provider).toBe("sandbox");
    expect(res.body.provider.isActive).toBe(true);
  });

  it("validates malformed provider config input", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .post("/api/v1/payment-providers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId: providerA,
        provider: "x",
        apiBaseUrl: "not-a-url",
        apiKey: "short",
        signingSecret: "short"
      });
    expect(res.status).toBe(422);
  });

  it("rejects configuring a provider for another branch from a branch-scoped session", async () => {
    const app = (await import("../src/app")).createApp();
    const branchA2 = await getAlphaBranchA2();
    const { token } = await staffLogin(app, "alpha-test-abj.localhost", "alice");
    const res = await request(app)
      .post("/api/v1/payment-providers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId: branchA2,
        provider: "sandbox",
        apiBaseUrl: "https://payments.example.test/v1",
        apiKey: "api-key-00000000",
        signingSecret: "secret-with-16-chars!"
      });
    // Branch A1 session cannot configure provider on branch A2.
    expect(res.status).toBe(403);
  });

  it("keeps each company's provider config isolated", async () => {
    const app = (await import("../src/app")).createApp();
    const { token: aToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");
    const a = await request(app)
      .get("/api/v1/payment-providers")
      .set("Authorization", `Bearer ${aToken}`);
    const b = await request(app)
      .get("/api/v1/payment-providers")
      .set("Authorization", `Bearer ${bToken}`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Company A config should not surface company B's branch/provider the same way.
    expect(a.body.provider.branchId).toBe(providerA);
    expect(b.body.provider.branchId).toBe(providerB);
    expect(a.body.provider.branchId).not.toBe(b.body.provider.branchId);
  });
});

describe("stage 7D - webhook authentication", () => {
  it("rejects a webhook with a missing signature", async () => {
    const app = (await import("../src/app")).createApp();
    const res = await postWebhook(app, {
      provider: "sandbox",
      companySlug: "alpha-test",
      body: { event: "payment.received", transaction: { reference: nextRef("PAY-T"), account_number: "1000000001", amount: 5000 } },
      signature: null
    });
    expect(res.status).toBe(401);
  });

  it("rejects a webhook with an invalid signature", async () => {
    const app = (await import("../src/app")).createApp();
    const res = await postWebhook(app, {
      provider: "sandbox",
      companySlug: "alpha-test",
      body: { event: "payment.received", transaction: { reference: nextRef("PAY-T"), account_number: "1000000001", amount: 5000 } },
      signature: "0".repeat(64)
    });
    expect(res.status).toBe(401);
    // An exception is recorded for the signature mismatch.
    let count = -1;
    await withAdmin(async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text n FROM webhook_exceptions WHERE exception_type='invalid_signature'`
      );
      count = parseInt(r.rows[0]!.n, 10);
    });
    expect(count).toBeGreaterThan(0);
  });

  it("rejects a webhook for an unknown company", async () => {
    const app = (await import("../src/app")).createApp();
    const res = await postWebhook(app, {
      provider: "sandbox",
      companySlug: "no-such-company",
      body: { event: "payment.received", transaction: { reference: nextRef("PAY-T"), account_number: "1000000001", amount: 5000 } },
      secret: secretA
    });
    expect(res.status).toBe(400);
  });

  it("rejects a webhook for a provider with no configured secret", async () => {
    const app = (await import("../src/app")).createApp();
    const res = await postWebhook(app, {
      provider: "unconfigured-provider",
      companySlug: "alpha-test",
      body: { event: "payment.received", transaction: { reference: nextRef("PAY-T"), account_number: "1000000001", amount: 5000 } },
      secret: secretA
    });
    expect(res.status).toBe(401);
  });
});

describe("stage 7D - payment pipeline", () => {
  it("completes the 13-step pipeline for a valid active-loan payment", async () => {
    const app = (await import("../src/app")).createApp();
    const ref = nextRef("PAY-T");
    const outstandingBefore = await saveOutstanding("PAY-T");

    const res = await postWebhook(app, {
      provider: "sandbox",
      companySlug: "alpha-test",
      body: {
        event: "payment.received",
        transaction: { reference: ref, account_number: "1000000001", amount: 5000 }
      },
      secret: secretA
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.outcome.kind).toBe("received");
    expect(res.body.outcome.status).toBe("completed");

    const paymentId: string = res.body.outcome.paymentId;

    let row: { status: string; customer_id: string | null; branch_id: string | null } | null = null;
    await withAdmin(async (db) => {
      const r = await db.query<{ status: string; customer_id: string | null; branch_id: string | null }>(
        `SELECT status, customer_id, branch_id FROM payments WHERE id=$1`,
        [paymentId]
      );
      row = r.rows[0] ?? null;
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("completed");
    expect(row!.customer_id).not.toBeNull();
    expect(row!.branch_id).toBe(providerA);

    // Outstanding principal reduced by 4000 (repayment of exactly one cycle).
    const outstandingAfter = await saveOutstanding("PAY-T");
    expect(Number(outstandingAfter)).toBe(Number(outstandingBefore) - 4000);

    // Schedule cycle 1 fully satisfied.
    let scheduleOk = false;
    await withAdmin(async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text n FROM repayment_schedule_rows rsr
          JOIN loans l ON l.id=rsr.loan_id
         WHERE l.principal_amount='30000' AND rsr.cycle_number=1
           AND rsr.actual_repayment=4000 AND rsr.actual_savings=1000 AND rsr.paid_at IS NOT NULL`
      );
      scheduleOk = parseInt(r.rows[0]!.n, 10) > 0;
    });
    expect(scheduleOk).toBe(true);

    // Allocation recorded.
    let allocs = 0;
    await withAdmin(async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text n FROM payment_allocations WHERE payment_id=$1 AND repayment_amount=4000 AND savings_amount=1000`,
        [paymentId]
      );
      allocs = parseInt(r.rows[0]!.n, 10);
    });
    expect(allocs).toBe(1);

    // Receipt + notification recorded.
    let receipt = 0;
    let notification = 0;
    await withAdmin(async (db) => {
      const r1 = await db.query<{ n: string }>(`SELECT count(*)::text n FROM receipts WHERE payment_id=$1`, [paymentId]);
      const r2 = await db.query<{ n: string }>(`SELECT count(*)::text n FROM notifications WHERE payload->>'payment_id'=$1`, [paymentId]);
      receipt = parseInt(r1.rows[0]!.n, 10);
      notification = parseInt(r2.rows[0]!.n, 10);
    });
    expect(receipt).toBe(1);
    expect(notification).toBe(1);

    // Pipeline jobs recorded (13 steps).
    let steps = 0;
    await withAdmin(async (db) => {
      const r = await db.query<{ n: string }>(`SELECT count(*)::text n FROM pipeline_jobs WHERE payment_id=$1`, [paymentId]);
      steps = parseInt(r.rows[0]!.n, 10);
    });
    expect(steps).toBe(13);
  });

  it("suppresses duplicate events by provider_txn_ref (idempotency)", async () => {
    const app = (await import("../src/app")).createApp();
    const ref = nextRef("PAY-T");
    const body = {
      event: "payment.received",
      transaction: { reference: ref, account_number: "1000000001", amount: 5000 }
    };
    const first = await postWebhook(app, { provider: "sandbox", companySlug: "alpha-test", body, secret: secretA });
    expect(first.status).toBe(200);
    const second = await postWebhook(app, { provider: "sandbox", companySlug: "alpha-test", body, secret: secretA });
    expect(second.status).toBe(200);
    expect(second.body.outcome.kind).toBe("duplicate_suppressed");

    // Exactly one payment row exists for this ref.
    let count = -1;
    await withAdmin(async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text n FROM payments WHERE provider='sandbox' AND provider_txn_ref=$1`,
        [ref]
      );
      count = parseInt(r.rows[0]!.n, 10);
    });
    expect(count).toBe(1);
  });

  it("records an unmatched payment when the virtual account is unknown", async () => {
    const app = (await import("../src/app")).createApp();
    const ref = nextRef("UNMATCH-");
    const res = await postWebhook(app, {
      provider: "sandbox",
      companySlug: "alpha-test",
      body: {
        event: "payment.received",
        transaction: { reference: ref, account_number: "9999999999", amount: 2000 }
      },
      secret: secretA
    });
    expect(res.status).toBe(200);
    expect(res.body.outcome.kind).toBe("unmatched");
    const paymentId: string = res.body.outcome.paymentId;

    let status = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ status: string }>(`SELECT status FROM payments WHERE id=$1`, [paymentId]);
      status = r.rows[0]!.status;
    });
    expect(status).toBe("unmatched");

    // An unmatched_payments queue row exists.
    let q = 0;
    await withAdmin(async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text n FROM unmatched_payments WHERE payment_id=$1`,
        [paymentId]
      );
      q = parseInt(r.rows[0]!.n, 10);
    });
    expect(q).toBe(1);

    // Surface through the /payments/unmatched API.
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const list = await request(app)
      .get("/api/v1/payments/unmatched")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.items.some((i: { payment_id: string }) => i.payment_id === paymentId)).toBe(true);
  });

  it("forces unallocated when the resolved virtual account is not active", async () => {
    const app = (await import("../src/app")).createApp();
    // Temporarily deactivate the seed VA for company A.
    const companyId = await getCompanyId("alpha-test");
    await withAdmin(async (db) => {
      await db.query(
        `UPDATE virtual_accounts SET status='closed' WHERE company_id=$1 AND account_number='1000000001'`,
        [companyId]
      );
    });
    try {
      const ref = nextRef("PAY-T");
      const res = await postWebhook(app, {
        provider: "sandbox",
        companySlug: "alpha-test",
        body: {
          event: "payment.received",
          transaction: { reference: ref, account_number: "1000000001", amount: 3000 }
        },
        secret: secretA
      });
      expect(res.status).toBe(200);
      expect(res.body.outcome.kind).toBe("unallocated");
      const paymentId: string = res.body.outcome.paymentId;

      let status = "";
      await withAdmin(async (db) => {
        const r = await db.query<{ status: string }>(`SELECT status FROM payments WHERE id=$1`, [paymentId]);
        status = r.rows[0]!.status;
      });
      expect(status).toBe("unallocated");

      let q = 0;
      await withAdmin(async (db) => {
        const r = await db.query<{ n: string }>(
          `SELECT count(*)::text n FROM unallocated_payments WHERE payment_id=$1`,
          [paymentId]
        );
        q = parseInt(r.rows[0]!.n, 10);
      });
      expect(q).toBe(1);
    } finally {
      // Restore the seed VA.
      await withAdmin(async (db) => {
        await db.query(
          `UPDATE virtual_accounts SET status='active' WHERE company_id=$1 AND account_number='1000000001'`,
          [companyId]
        );
      });
    }
  });

  it("records a reversal of a known payment", async () => {
    const app = (await import("../src/app")).createApp();
    const ref = nextRef("PAY-T");
    await postWebhook(app, {
      provider: "sandbox",
      companySlug: "alpha-test",
      body: { event: "payment.received", transaction: { reference: ref, account_number: "1000000001", amount: 5000 } },
      secret: secretA
    });

    const revRef = nextRef("REV-T");
    const res = await postWebhook(app, {
      provider: "sandbox",
      companySlug: "alpha-test",
      body: {
        event: "payment.reversed",
        transaction: { reference: revRef, account_number: "1000000001", amount: 5000 },
        reversal: { original_reference: ref, reason: "customer dispute" }
      },
      secret: secretA
    });
    expect(res.status).toBe(200);
    expect(res.body.outcome.kind).toBe("reversed");

    let status = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ status: string }>(
        `SELECT status FROM payments WHERE provider='sandbox' AND provider_txn_ref=$1`,
        [ref]
      );
      status = r.rows[0]!.status;
    });
    expect(status).toBe("reversed");
  });
});

describe("stage 7D - read APIs and isolation", () => {
  it("lists payments scoped to the calling company", async () => {
    const app = (await import("../src/app")).createApp();
    const ref = nextRef("PAY-T");
    await postWebhook(app, {
      provider: "sandbox",
      companySlug: "alpha-test",
      body: { event: "payment.received", transaction: { reference: ref, account_number: "1000000001", amount: 5000 } },
      secret: secretA
    });

    const { token: aToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");

    const aList = await request(app).get("/api/v1/payments").set("Authorization", `Bearer ${aToken}`);
    const bList = await request(app).get("/api/v1/payments").set("Authorization", `Bearer ${bToken}`);
    expect(aList.status).toBe(200);
    expect(bList.status).toBe(200);

    const aRefs = aList.body.items.map((i: { providerTxnRef: string }) => i.providerTxnRef);
    const bRefs = bList.body.items.map((i: { providerTxnRef: string }) => i.providerTxnRef);
    expect(aRefs).toContain(ref);
    expect(bRefs).not.toContain(ref);
  });

  it("returns 404 for a payment that belongs to another company", async () => {
    const app = (await import("../src/app")).createApp();
    const ref = nextRef("PAY-T");
    const res = await postWebhook(app, {
      provider: "sandbox",
      companySlug: "alpha-test",
      body: { event: "payment.received", transaction: { reference: ref, account_number: "1000000001", amount: 5000 } },
      secret: secretA
    });
    const paymentId: string = res.body.outcome.paymentId;

    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");
    const bGet = await request(app)
      .get(`/api/v1/payments/${paymentId}`)
      .set("Authorization", `Bearer ${bToken}`);
    // RLS hides company A's payment from company B -> not found.
    expect(bGet.status).toBe(404);
  });

  it("returns payment detail with allocations and pipeline steps", async () => {
    const app = (await import("../src/app")).createApp();
    const ref = nextRef("PAY-T");
    const res = await postWebhook(app, {
      provider: "sandbox",
      companySlug: "alpha-test",
      body: { event: "payment.received", transaction: { reference: ref, account_number: "1000000001", amount: 5000 } },
      secret: secretA
    });
    const paymentId: string = res.body.outcome.paymentId;

    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const get = await request(app)
      .get(`/api/v1/payments/${paymentId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.status).toBe("completed");
    expect(get.body.allocations.length).toBeGreaterThan(0);
    expect(get.body.pipelineSteps.length).toBe(13);
  });

  it("lists reconciliation items after a reconciliation diff", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    // A provider-known txn that Nexora does not have -> a reconciliation item.
    const ghostRef = nextRef("GHOST");
    const rec = await request(app)
      .post("/api/v1/payments/reconcile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        provider: "sandbox",
        providerTransactions: [
          { providerTxnRef: ghostRef, amount: 12345, valueDate: "2026-01-15T10:00:00Z" }
        ]
      });
    expect(rec.status).toBe(200);
    expect(rec.body.added).toBeGreaterThan(0);

    const list = await request(app)
      .get("/api/v1/reconciliation-items")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.items.some((i: { provider_txn_ref: string }) => i.provider_txn_ref === ghostRef)).toBe(true);
  });
});
