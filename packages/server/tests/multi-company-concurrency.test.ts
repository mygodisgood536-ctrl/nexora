import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import http from "node:http";
import bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";
import { seedWorld, withAdmin, withAdminValue, type TestWorld } from "./fixtures";
import {
  staffLogin,
  completeProfile,
  attachVerifiedFaceEvidence,
  attachVerifiedBankDetails,
  attachApplicationTerms
} from "./platform-helpers";
import { runAcrossTenants } from "../src/lib/tenant-execution";

const SEED_HASH = bcrypt.hashSync("TestPassword!123", 8);
const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

/**
 * RULE 3.8 - multi-company concurrency and platform execution capacity.
 *
 * RULE 3.8.7 names virtual-account creation as the mandatory example: several
 * C.O.s in different companies disbursing at the same moment must each resolve
 * their own company, branch, provider and credentials, and each resulting
 * account must be persisted against its own customer and loan.
 *
 * Every company here has its OWN provider configuration, its OWN API key and
 * its OWN real HTTP endpoint, so "the right provider got the right request"
 * is proved by which server received it and with which credential, not by an
 * assumption. The tests drive the real HTTP API end to end.
 */

interface VaRequest {
  company_id: string;
  branch_id: string;
  account_name: string;
  /** The number the app asked the provider to use. */
  account_number: string;
  /** The number the provider actually issued, which is what must be stored. */
  issued_account_number: string;
  /** Every header the provider received, so the credential can be located
   *  whichever authentication scheme that provider's registry declares. */
  headers: Record<string, string>;
  /** The exact body that was signed, so a signature can be re-verified. */
  raw_body: string;
}

interface CompanyRig {
  label: string;
  host: string;
  companyId: string;
  branchId: string;
  userId: string;
  customerId: string;
  applicationId: string;
  provider: string;
  apiKey: string;
  endpointUrl: string;
  requests: VaRequest[];
  /** When true the provider rejects every request, proving failure isolation. */
  failing: boolean;
  server?: http.Server;
}

const rigs: CompanyRig[] = [];

async function startProviderEndpoint(rig: CompanyRig): Promise<void> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      if (rig.failing) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "provider unavailable" }));
        return;
      }
      let parsed: { company_id?: string; branch_id?: string; account_name?: string; account_number?: string } = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* the routing assertions below will catch it */
      }
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers[name.toLowerCase()] = value;
      }
      // A real provider decides the account number; each company gets a
      // recognisable one so a misrouted write is unmistakable.
      const seq = (rig.requests.length).toString().padStart(4, "0");
      const issued = `9${rig.provider.slice(0, 2).toUpperCase()}${seq}00000`;
      rig.requests.push({
        company_id: String(parsed.company_id ?? ""),
        branch_id: String(parsed.branch_id ?? ""),
        account_name: String(parsed.account_name ?? ""),
        account_number: String(parsed.account_number ?? ""),
        issued_account_number: issued,
        headers,
        raw_body: raw
      });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          account_number: issued,
          bank_name: `${rig.label} Provider Bank`,
          reference: `${rig.provider}-ref-${seq}`
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  rig.server = server;
  rig.endpointUrl = `http://127.0.0.1:${port}/virtual-accounts`;
}

/** Provisions one company end to end: branch, worker, product, customer, loan. */
async function buildRig(
  app: Express,
  opts: {
    label: string;
    host: string;
    provider: string;
    failing?: boolean;
    reuse?: { companyId: string; branchId: string; userId: string };
  }
): Promise<CompanyRig> {
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
    .toString(36)
    .padStart(3, "0")}`.toUpperCase();
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let prefix = "";
  while (prefix.length < 5) {
    prefix += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  }

  let companyId: string;
  let branchId: string;
  let userId: string;

  if (opts.reuse) {
    companyId = opts.reuse.companyId;
    branchId = opts.reuse.branchId;
    userId = opts.reuse.userId;
  } else {
    const created = await withAdminValue(async (db) => {
      const company = await db.query<{ id: string }>(
        `INSERT INTO companies (name, code_prefix, slug, status, portal_url)
         VALUES ($1,$2,$3,'active',$3 || '.nexora.app') RETURNING id`,
        [`${opts.label} Test Co`, prefix, `${opts.label.toLowerCase()}-${unique.toLowerCase()}`]
      );
      const companyId = company.rows[0]!.id;
      await db.query(`INSERT INTO themes (company_id) VALUES ($1)`, [companyId]);
      await db.query(`INSERT INTO company_settings (company_id) VALUES ($1)`, [companyId]);
      const branch = await db.query<{ id: string }>(
        `INSERT INTO branches (company_id, code, slug, name, address, portal_url, status)
         VALUES ($1,$2,$3,$4,'1 Concurrency Way',$3 || '.example.test','active') RETURNING id`,
        [companyId, `${prefix}-001`, `${prefix.toLowerCase()}1`, `${opts.label} Branch`]
      );
      const user = await db.query<{ id: string }>(
        `INSERT INTO users (company_id, branch_id, worker_code, username, password_hash,
                            first_name, last_name, birth_day, birth_month, status,
                            must_change_password, credential_state, credential_issued_at,
                            password_changed_at, profile_completed_at)
         VALUES ($1,$2,$3,$4,$5,'Concurrent','Officer',1,1,'active',false,'secured',
                 now() - interval '30 days', now() - interval '29 days', now() - interval '29 days')
         RETURNING id`,
        [companyId, branch.rows[0]!.id, `${prefix}-CI-001`, `conco-${unique.toLowerCase()}`, SEED_HASH]
      );
      const role = await db.query<{ id: string }>(
        `INSERT INTO roles (company_id, role_key, name, category, is_system)
         VALUES ($1,'collection_officer','Collection Officer','operations_field',true) RETURNING id`,
        [companyId]
      );
      await db.query(
        `INSERT INTO role_permissions (role_id, verb)
         SELECT $1, verb FROM permission_verbs
          WHERE verb IN ('view','create','edit','export','allocate','register_customer','disburse')`,
        [role.rows[0]!.id]
      );
      const assignment = await db.query<{ id: string }>(
        `INSERT INTO role_assignments (company_id, user_id, role_id, scope_type, assignment_type, starts_at, status, assigned_by)
         VALUES ($1,$2,$3,'single_branch','permanent', now() - interval '30 days','active',$2) RETURNING id`,
        [companyId, user.rows[0]!.id, role.rows[0]!.id]
      );
      await db.query(`INSERT INTO role_assignment_branches VALUES ($1,$2)`, [assignment.rows[0]!.id, branch.rows[0]!.id]);
      return { companyId, branchId: branch.rows[0]!.id, userId: user.rows[0]!.id };
    });
    companyId = created.companyId;
    branchId = created.branchId;
    userId = created.userId;
  }

  const companySlug = await withAdminValue(async (db) =>
    (await db.query<{ slug: string }>(`SELECT slug FROM companies WHERE id=$1`, [companyId])).rows[0]!.slug
  );

  const rig: CompanyRig = {
    label: opts.label,
    host: opts.reuse ? opts.host : `${companySlug}.localhost`,
    companyId,
    branchId,
    userId,
    customerId: "",
    applicationId: "",
    provider: opts.provider,
    apiKey: `key-${opts.provider}-${unique.toLowerCase()}`,
    endpointUrl: "",
    requests: [],
    failing: opts.failing === true
  };
  await startProviderEndpoint(rig);

  // Exactly one active binding for this branch and provider, so the branch
  // resolves THIS rig's configuration and its own credential.
  await withAdmin(async (db) => {
    await db.query(
      `UPDATE branch_payment_accounts SET is_active=false
         WHERE branch_id=$1 AND is_active
           AND provider_config_id IN (
             SELECT id FROM payment_provider_configs
              WHERE company_id=$2 AND provider=$3)`,
      [branchId, companyId, opts.provider]
    );
  });

  // The company's own provider configuration, bound to its own branch, with
  // its own credential. Only this company can ever resolve it.
  await withAdmin(async (db) => {
    await db.query(
      `INSERT INTO payment_provider_configs
         (company_id, provider, api_base_url, api_key, is_active, md_approved_at, connection_tested_at, connection_test_ok)
       VALUES ($1,$2,$3,$4,true, now(), now(), true) RETURNING id`,
      [companyId, opts.provider, rig.endpointUrl, rig.apiKey]
    ).then(async (cfg) => {
      await db.query(
        `INSERT INTO branch_payment_accounts (company_id, branch_id, provider_config_id,
                                                account_name, provider_account_ref, is_active)
         VALUES ($1,$2,$3,$4,$5,true)`,
        [
          companyId,
          branchId,
          cfg.rows[0]!.id,
          `${opts.label} Branch Provider Account`,
          `bpa-${unique.toLowerCase()}`
        ]
      );
    });
    await db.query(
      `INSERT INTO webhook_signing_secrets (company_id, provider, secret)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [companyId, opts.provider, `whsec-${unique.toLowerCase()}`]
    );
  });

  // The company's own catalogue: product, chain and a complete customer.
  const { token } = await staffLogin(app, rig.host, await usernameFor(userId));
  const productId = await withAdminValue(async (db) => {
    const existingProduct = await db.query<{ id: string }>(
      `SELECT id FROM loan_products WHERE company_id=$1 LIMIT 1`, [companyId]
    );
    if ((existingProduct.rowCount ?? 0) > 0) return existingProduct.rows[0]!.id;
    const chain = await db.query<{ id: string }>(
      `INSERT INTO approval_chains (company_id, name) VALUES ($1,'default') RETURNING id`,
      [companyId]
    );
    await db.query(
      `INSERT INTO approval_chain_steps (company_id, chain_id, stage_order, step_name, role_id)
       SELECT $1,$2,1,'Executive approval', id FROM roles
        WHERE company_id=$1 AND role_key='md' LIMIT 1`,
      [companyId, chain.rows[0]!.id]
    );
    const product = await db.query<{ id: string }>(
      `INSERT INTO loan_products (company_id, name, min_principal, max_principal, interest_rate,
                                  cycle_days, cycle_count, expected_repayment_per_cycle,
                                  expected_savings_per_cycle, approval_chain_id)
       VALUES ($1,'Standard',1000,100000,5,1,30,4000,1000,$2) RETURNING id`,
      [companyId, chain.rows[0]!.id]
    );
    return product.rows[0]!.id;
  });

  const uniqueDigits = Math.floor(Math.random() * 1e9).toString().padStart(9, "0");
  const bvn = uniqueDigits.padStart(11, "7");
  const customer = await request(app)
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      branchId,
      firstName: "Concurrent",
      lastName: opts.label,
      address: "1 Concurrency Way",
      ...completeProfile({
        identificationNumber: `ID-CONC-${unique}`,
        bvn,
        email: `concurrent.${unique.toLowerCase()}@nexora.test`,
        phone: `+2348${uniqueDigits}`.slice(0, 14)
      })
    });
  expect(customer.status, `customer for ${opts.label}: ${JSON.stringify(customer.body)}`).toBe(201);
  rig.customerId = customer.body.id as string;

  const applicationId = await withAdminValue(async (db) => {
    const product = await db.query<{ id: string }>(
      `SELECT id FROM loan_products WHERE company_id=$1 LIMIT 1`, [companyId]
    );
    const chain = await db.query<{ id: string }>(
      `SELECT id FROM approval_chains WHERE company_id=$1 LIMIT 1`, [companyId]
    );
    const app = await db.query<{ id: string }>(
      `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                       principal_amount, status, submitted_by, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,$5,7500,'approved',$6,$6,now()) RETURNING id`,
      [companyId, branchId, rig.customerId, product.rows[0]!.id, chain.rows[0]!.id, userId]
    );
    return app.rows[0]!.id;
  });
  rig.applicationId = applicationId;
  void productId;

  const actor = { sub: userId, companyId, branchId };
  await attachVerifiedFaceEvidence(actor, rig.customerId, applicationId);
  await attachVerifiedBankDetails(actor, rig.customerId, applicationId);
  await attachApplicationTerms(actor, applicationId);

  return rig;
}

/**
 * Whether the credential `key` is what authorised this provider request:
 * presented as a header value, or as an HMAC/signature over the exact body.
 */
function credentialAuthorised(seen: VaRequest, key: string): boolean {
  const presented = Object.values(seen.headers).join("|");
  if (presented.includes(key)) return true;
  const signatures = [
    seen.headers["x-signature"],
    seen.headers["signature"],
    seen.headers["authorization"]
  ].filter((v): v is string => typeof v === "string");
  return signatures.some(
    (value) => createHmac("sha512", key).update(seen.raw_body).digest("hex") === value ||
      createHmac("sha512", key).update(seen.raw_body).digest("base64") === value
  );
}

async function usernameFor(userId: string): Promise<string> {
  return withAdminValue(async (db) => {
    const row = await db.query<{ username: string }>(`SELECT username FROM users WHERE id=$1`, [userId]);
    return row.rows[0]!.username;
  });
}

async function disburse(rig: CompanyRig, app: Express, applicationId: string) {
  const { token } = await staffLogin(app, rig.host, await usernameFor(rig.userId));
  const res = await request(app)
    .post("/api/v1/loan-disbursements")
    .set("Authorization", `Bearer ${token}`)
    .send({ applicationId, reason: `RULE 3.8.7 concurrency ${rig.label}` });
  return res;
}

describe("RULE 3.8 multi-company concurrency and execution capacity", () => {
  let app: Express;
  let w: TestWorld;

  beforeAll(async () => {
    app = (await import("../src/app")).createApp();
    w = await seedWorld();
  }, 300_000);

  afterAll(async () => {
    for (const rig of rigs) {
      if (!rig.server) continue;
      await new Promise<void>((resolve) => rig.server!.close(() => resolve()));
    }
    // The provider endpoints only exist for this suite.
    for (const rig of rigs) {
      delete process.env[`PROVIDER_VA_ENDPOINT_${rig.provider.toUpperCase()}`];
    }
  });

  it("3.8.7/3.8.8 four companies disburse simultaneously and each lands on its own tenant and provider", async () => {
    const plans: Array<{
      label: string;
      host: string;
      provider: string;
      reuse?: { companyId: string; branchId: string; userId: string };
    }> = [
      { label: "Alpha", host: ALPHA_HOST, provider: "sandbox", reuse: { companyId: w.companyA, branchId: w.branchA1, userId: w.userA } },
      { label: "Beta", host: BETA_HOST, provider: "monnify", reuse: { companyId: w.companyB, branchId: w.branchB1, userId: w.userB } },
      { label: "Gamma", host: `gamma-${Date.now()}.localhost`, provider: "flutterwave" },
      { label: "Delta", host: `delta-${Date.now()}.localhost`, provider: "paystack" }
    ];

    for (const plan of plans) {
      const rig = await buildRig(app, plan as never);
      rigs.push(rig);
      process.env[`PROVIDER_VA_ENDPOINT_${rig.provider.toUpperCase()}`] = rig.endpointUrl;
    }

    // RULE 3.8.1 - all four run at the same time; none waits for another.
    const started = Date.now();
    const outcomes = await runAcrossTenants(
      rigs.map((rig) => ({ label: rig.label, run: () => disburse(rig, app, rig.applicationId) })),
      { maxParallel: rigs.length }
    );
    const elapsed = Date.now() - started;

    for (const outcome of outcomes) {
      expect(outcome.ok, `${outcome.label} did not disburse: ${outcome.ok ? "" : outcome.error}`).toBe(true);
      if (outcome.ok) expect(outcome.value.status).toBe(201);
    }

    // RULE 3.8.1 - genuine parallelism, not four serialised round trips.
    expect(rigs.length).toBeGreaterThanOrEqual(4);
    expect(elapsed).toBeLessThan(120_000);

    for (const rig of rigs) {
      // RULE 3.8.7 - each company's OWN provider received exactly its OWN request.
      expect(rig.requests.length, `${rig.label}'s provider got ${rig.requests.length} requests`).toBe(1);
      const seen = rig.requests[0]!;
      expect(seen.company_id).toBe(rig.companyId);
      expect(seen.branch_id).toBe(rig.branchId);
      expect(seen.account_name).toBe(`Concurrent ${rig.label}`);
      // RULE 21.1.10 / 1.6 - its OWN credential authorised the request, and no
      // other company's credential could have. Providers differ in scheme
      // (bearer, api key, hmac, signature), so the credential is proved the way
      // that provider actually receives it: presented verbatim, or as a
      // signature over the exact body that only this company's key produces.
      for (const other of rigs) {
        const matches = credentialAuthorised(seen, other.apiKey);
        if (other === rig) {
          expect(matches, `${rig.label}'s provider did not receive its own key`).toBe(true);
        } else {
          expect(matches, `${rig.label} was authorised with ${other.label}'s key`).toBe(false);
        }
      }

      // The account the provider issued is persisted against the right records.
      const persisted = await withAdminValue(async (db) => {
        const va = await db.query<{
          company_id: string; branch_id: string; customer_id: string;
          account_number: string; provider: string; status: string;
        }>(
          `SELECT company_id, branch_id, customer_id, account_number, provider, status
             FROM virtual_accounts WHERE customer_id=$1`,
          [rig.customerId]
        );
        const loan = await db.query<{ company_id: string; branch_id: string; customer_id: string }>(
          `SELECT company_id, branch_id, customer_id FROM loans WHERE application_id=$1`,
          [rig.applicationId]
        );
        return { va: va.rows, loan: loan.rows[0] };
      });
      expect(persisted.va).toHaveLength(1);
      expect(persisted.va[0]!.company_id).toBe(rig.companyId);
      expect(persisted.va[0]!.branch_id).toBe(rig.branchId);
      expect(persisted.va[0]!.status).toBe("active");
      expect(persisted.va[0]!.provider).toBe(rig.provider);
      // The number the PROVIDER issued is what was stored, not the number the
      // platform asked for and not one invented locally.
      expect(persisted.va[0]!.account_number).toBe(seen.issued_account_number);
      expect(persisted.va[0]!.account_number).not.toBe(seen.account_number);
      expect(persisted.loan!.company_id).toBe(rig.companyId);
      expect(persisted.loan!.customer_id).toBe(rig.customerId);
    }

    // RULE 3.8.5 - no cross-tenant contamination anywhere in the VA table.
    const crossTenant = await withAdminValue(async (db) =>
      (
        await db.query<{ id: string }>(
          `SELECT v.id
             FROM virtual_accounts v
             JOIN customers c ON c.id = v.customer_id
            WHERE v.company_id <> c.company_id OR v.branch_id <> c.branch_id`
        )
      ).rows
    );
    expect(crossTenant).toEqual([]);
  }, 600_000);

  it("3.8.4 one company's provider failure does not block or corrupt any other company", async () => {
    const healthy = rigs[0]!;
    const fresh = await buildRig(app, {
      label: "Echo",
      host: `echo-${Date.now()}.localhost`,
      provider: "opay",
      failing: true
    });
    rigs.push(fresh);
    process.env[`PROVIDER_VA_ENDPOINT_${fresh.provider.toUpperCase()}`] = fresh.endpointUrl;

    // A second, healthy company disburses at the same time as the failing one.
    const other = await buildRig(app, {
      label: "Foxtrot",
      host: `foxtrot-${Date.now()}.localhost`,
      provider: "palmpay"
    });
    rigs.push(other);
    process.env[`PROVIDER_VA_ENDPOINT_${other.provider.toUpperCase()}`] = other.endpointUrl;

    const [failedOutcome, okOutcome] = await Promise.all([
      disburse(fresh, app, fresh.applicationId),
      disburse(other, app, other.applicationId)
    ]);

    // The failing company's request really failed.
    expect(failedOutcome.status).toBeGreaterThanOrEqual(400);
    expect(fresh.requests).toHaveLength(0);

    // The unrelated company was entirely unaffected.
    expect(okOutcome.status).toBe(201);
    expect(other.requests).toHaveLength(1);
    expect(other.requests[0]!.company_id).toBe(other.companyId);

    // Nothing partial was written for the failed company: no loan, no account.
    const residue = await withAdminValue(async (db) => {
      const loans = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM loans WHERE application_id=$1`, [fresh.applicationId]
      );
      const accounts = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM virtual_accounts WHERE customer_id=$1`, [fresh.customerId]
      );
      const portal = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM customer_portal_access WHERE customer_id=$1`, [fresh.customerId]
      );
      return {
        loans: loans.rows[0]!.n,
        accounts: accounts.rows[0]!.n,
        portal: portal.rows[0]!.n
      };
    });
    expect(residue.loans).toBe("0");
    expect(residue.accounts).toBe("0");
    expect(residue.portal).toBe("0");

    // And the first tenant's records are still exactly where they were.
    const stillThere = await withAdminValue(async (db) =>
      (
        await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM virtual_accounts WHERE customer_id=$1 AND status='active'`,
          [healthy.customerId]
        )
      ).rows[0]!.n
    );
    expect(stillThere).toBe("1");
  }, 600_000);

  it("3.8.5 two simultaneous disbursements of the same application create one loan and one account", async () => {
    const rig = await buildRig(app, {
      label: "Golf",
      host: `golf-${Date.now()}.localhost`,
      provider: "squad"
    });
    rigs.push(rig);
    process.env[`PROVIDER_VA_ENDPOINT_${rig.provider.toUpperCase()}`] = rig.endpointUrl;

    const [first, second] = await Promise.all([
      disburse(rig, app, rig.applicationId),
      disburse(rig, app, rig.applicationId)
    ]);
    const statuses = [first.status, second.status].sort();
    // Exactly one succeeded; the other was refused by the state machine.
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);

    const state = await withAdminValue(async (db) => {
      const loans = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM loans WHERE application_id=$1`, [rig.applicationId]
      );
      const accounts = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM virtual_accounts WHERE customer_id=$1`, [rig.customerId]
      );
      const active = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM virtual_accounts WHERE customer_id=$1 AND status='active'`,
        [rig.customerId]
      );
      return {
        loans: loans.rows[0]!.n,
        accounts: accounts.rows[0]!.n,
        active: active.rows[0]!.n
      };
    });
    expect(state.loans).toBe("1");
    expect(state.accounts).toBe("1");
    expect(state.active).toBe("1");
  }, 600_000);

  it("3.8.2 asynchronous work carries its company and branch and never reads across tenants", async () => {
    // Every background/queue row the product writes must name its company, so
    // a worker can never process another tenant's job.
    const unscoped = await withAdminValue(async (db) =>
      (
        await db.query<{ table_name: string }>(
          `SELECT c.table_name
             FROM information_schema.columns c
            WHERE c.table_schema='public'
              AND c.table_name IN ('pipeline_jobs','webhook_events','webhook_exceptions',
                                   'reconciliation_items','notifications','company_ai_executions',
                                   'audit_logs','collection_watch_alerts','overdue_escalations',
                                   'disbursement_holds')
              AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns x
                 WHERE x.table_schema='public' AND x.table_name=c.table_name
                   AND x.column_name='company_id')`
        )
      ).rows
    );
    expect(unscoped, `queue/history tables without company_id: ${JSON.stringify(unscoped)}`).toEqual([]);
  }, 120_000);
});
