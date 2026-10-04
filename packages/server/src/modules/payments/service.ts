// Stage 7D — Payment pipeline + webhooks (Part 1 Section 21).
//
// Implements the 13-step cashless payment pipeline:
//   [1] Signature verification (webhook.ts)
//   [2] Idempotency check (UNIQUE provider+provider_txn_ref)
//   [3] Transaction genuineness confirmed with provider (test stub trusts webhook)
//   [4] Resolve Virtual Account → Customer
//   [5] Resolve Customer's active Loan(s)
//   [6] Payment Allocation Engine (Part 1 §24)
//   [7] Loan Repayment recorded + Savings recorded
//   [8] Digital Collection Ledger updated
//   [9] Accounting entries posted (placeholder)
//  [10] Receipt generated (placeholder)
//  [11] Notifications sent
//  [12] Audit log entry recorded
//  [13] Dashboards updated (derived from payments table)
//
// Plus the 11 exception types from §21. All money handling uses PG
// `numeric` (never float) and every write is wrapped in a single
// transaction so a partial failure cannot leak inconsistent state.
import type pg from "pg";
import { withTenant, withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { postPaymentJournal, postReversalJournal } from "./accounting";
import {
  activeFinanceUserIds,
  insertUserNotifications,
  insertNotificationsToMds,
  notifyAuditors,
} from "../notifications/service";

export interface PaymentActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

// ===================== numeric helpers =====================
// All money flows as strings to avoid JS float precision loss. The
// allocation engine treats amounts as fixed-point decimal numbers
// at 2 decimal places (cents) and never uses `parseFloat`.
export function toCents(amount: string | number): bigint {
  const s = typeof amount === "number" ? amount.toString() : String(amount);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw AppError.unprocessable(`invalid numeric amount: ${s}`);
  }
  const [whole = "", frac = ""] = s.split(".");
  const padded = (frac + "00").slice(0, 2);
  return BigInt(whole) * 100n + BigInt(padded);
}

export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

export function addCents(a: bigint, b: bigint): bigint {
  return a + b;
}

export function subCents(a: bigint, b: bigint): bigint {
  return a - b;
}

// ===================== provider config =====================

export interface CreateProviderConfigInput {
  branchId: string;
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  signingSecret: string;
}

export interface ProviderConfigRow {
  id: string;
  companyId: string;
  branchId: string | null;
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  isActive: boolean;
  mdApproved: boolean;
  createdAt: string;
}

export interface BranchPaymentAccountRow {
  id: string;
  companyId: string;
  branchId: string;
  providerConfigId: string;
  provider: string;
  accountName: string;
  providerAccountRef: string;
  isActive: boolean;
}

const PROVIDER_ADMIN_ROLES = ["it_system_administrator"];

// Part 14.5 / prohibition #22 — a provider secret is never echoed back to any
// session. Read surfaces return a masked form; only the internal webhook
// verifier and EOD reconciliation ever hold the raw values.
function maskSecret(secret: string | undefined | null): string | null {
  if (!secret) return null;
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, 3)}••••${secret.slice(-3)}`;
}

function toProviderConfigRow(
  row: unknown
): ProviderConfigRow {
  return {
    id: (row as { id: string }).id,
    companyId: (row as { company_id: string }).company_id,
    branchId: (row as { branch_id: string | null }).branch_id,
    provider: (row as { provider: string }).provider,
    apiBaseUrl: (row as { api_base_url: string }).api_base_url,
    apiKey: maskSecret((row as { api_key: string | null }).api_key) ?? "",
    isActive: (row as { is_active: boolean }).is_active,
    mdApproved: (row as { md_approved_at: Date | null }).md_approved_at !== null,
    createdAt: (row as { created_at: Date }).created_at.toISOString(),
  };
}

// Vision V3.2 Part 8 — roles that may change a branch's provider: the MD's
// management group plus the Finance group. The IT/System Administrator only
// performs the technical credential ritual (RULE 8.8.1), never chooses the
// provider, so it is excluded from provider change authority.
const PROVIDER_CHANGE_ROLES = [
  "md",
  "deputy_md",
  "gm",
  "finance_manager",
  "accountant",
  "assistant_accountant",
  "cash_bank_reconciliation_officer",
];

// Roles that may configure provider credentials (Part 7: IT/System
// Administrator performs the technical credential flow; the MD authorises).
async function actorHoldsRole(
  db: pg.PoolClient,
  actor: PaymentActor,
  roleKeys: string[]
): Promise<boolean> {
  const r = await db.query<{ ok: number }>(
    `SELECT 1 AS ok FROM role_assignments ra
       JOIN roles r ON r.id = ra.role_id
      WHERE ra.user_id=$1 AND ra.status='active' AND r.role_key = ANY($2::text[])
      LIMIT 1`,
    [actor.sub, roleKeys]
  );
  return (r.rowCount ?? 0) > 0;
}

export interface ProviderRegistryRow {
  code: string;
  name: string;
  status: string;
  requirementSet: unknown;
  capabilityFlags: unknown;
  virtualAccountDescriptor: unknown;
  connectionDescriptor: unknown;
  webhookDescriptor: unknown;
}

/**
 * Part 8 read surface — the data-driven provider registry. The registry is
 * platform-owned read-mostly data (like permission_verbs), not company
 * scoped: any authenticated member may read which providers Nexora ships
 * with and what each expects. Writes are confined to the platform/owner
 * path (Part 3), so this is strictly a SELECT over the seeded table.
 */
export async function listProviderRegistry(_actor: PaymentActor): Promise<ProviderRegistryRow[]> {
  return withBypass(async (db) => {
    const r = await db.query(
      `SELECT code, name, status,
              requirement_set, capability_flags,
              virtual_account_descriptor, connection_descriptor, webhook_descriptor
         FROM payment_providers
        WHERE status='active'
        ORDER BY code ASC`
    );
    return (r.rows as Array<Record<string, unknown>>).map((row) => ({
      code: row.code as string,
      name: row.name as string,
      status: row.status as string,
      requirementSet: row.requirement_set,
      capabilityFlags: row.capability_flags,
      virtualAccountDescriptor: row.virtual_account_descriptor,
      connectionDescriptor: row.connection_descriptor,
      webhookDescriptor: row.webhook_descriptor
    }));
  });
}

export async function createProviderConfig(
  actor: PaymentActor,
  input: CreateProviderConfigInput,
  meta: ActorMeta = {}
): Promise<ProviderConfigRow> {
  if (!input.provider.trim()) throw AppError.unprocessable("provider is required");
  if (!/^https?:\/\//i.test(input.apiBaseUrl)) {
    throw AppError.unprocessable("apiBaseUrl must be a valid http(s) URL");
  }
  if (input.apiKey.trim().length < 8) {
    throw AppError.unprocessable("apiKey must be at least 8 characters");
  }
  if (input.signingSecret.trim().length < 16) {
    throw AppError.unprocessable("signingSecret must be at least 16 characters");
  }

  return withTenant(actor.companyId, null, async (db) => {
    if (!(await actorHoldsRole(db, actor, PROVIDER_CHANGE_ROLES))) {
      throw AppError.forbidden(
        "Only the MD, Deputy MD, GM or Finance group may configure payment providers"
      );
    }
    // Vision Part 8 — a change made by the MD is authorised by definition; a
    // change made by anyone else waits in the MD's authorisation queue.
    const actorIsMd = await actorHoldsRole(db, actor, ["md"]);

    const inserted = await db.query<{
      id: string;
      company_id: string;
      provider: string;
      api_base_url: string;
      api_key: string;
      is_active: boolean;
      md_approved_at: Date | null;
      created_at: Date;
    }>(
      `INSERT INTO payment_provider_configs
         (company_id, provider, api_base_url, api_key, is_active,
          md_approved_at, md_approved_by, connection_tested_at,
          connection_test_ok)
       VALUES ($1,$2,$3,$4,false,$5,$6,NULL,NULL)
       ON CONFLICT (company_id, provider)
       DO UPDATE SET api_base_url = EXCLUDED.api_base_url,
                     api_key = EXCLUDED.api_key,
                     is_active = false,
                     md_approved_at = EXCLUDED.md_approved_at,
                     md_approved_by = EXCLUDED.md_approved_by,
                     connection_tested_at = NULL,
                     connection_test_ok = NULL
       RETURNING id, company_id, provider, api_base_url, api_key,
                 is_active, md_approved_at, created_at`,
      [actor.companyId, input.provider.trim(),
       input.apiBaseUrl.trim(), input.apiKey,
       actorIsMd ? new Date() : null,
       actorIsMd ? actor.sub : null]
    );
    const row = inserted.rows[0]!;
    // Vision Part 8 — link the branch to this provider config via branch_payment_accounts.
    // (company_id, branch_id) is unique, so an update re-points to the new config.
    await db.query(
      `INSERT INTO branch_payment_accounts
         (company_id, branch_id, provider_config_id, account_name, provider_account_ref)
       VALUES ($1,$2,$3, $4, $5)
       ON CONFLICT (company_id, branch_id)
       DO UPDATE SET provider_config_id = EXCLUDED.provider_config_id,
                     account_name = EXCLUDED.account_name,
                     provider_account_ref = EXCLUDED.provider_account_ref`,
      [actor.companyId, input.branchId, row.id,
       input.provider.trim(), `va-${input.provider.trim()}-${input.branchId}`]
    );
    await db.query(
      `DELETE FROM webhook_signing_secrets WHERE company_id=$1 AND provider=$2`,
      [actor.companyId, input.provider.trim()]
    );
    await db.query(
      `INSERT INTO webhook_signing_secrets (company_id, provider, secret)
       VALUES ($1,$2,$3)`,
      [actor.companyId, input.provider.trim(), input.signingSecret]
    );

    await db.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action,
                               entity_type, entity_id, new_value, reason,
                               ip_address, user_agent, request_id)
       VALUES ($1,$2,'payment_provider.configured',
               'payment_provider_configs',$3,$4::jsonb,
               'provider configuration set (activation requires a successful connection test)', $5,$6,$7)`,
      [
        actor.companyId, actor.sub, row.id,
        JSON.stringify({
          provider: input.provider.trim(),
          api_base_url: input.apiBaseUrl.trim(),
          has_secret: true,
          md_approved: actorIsMd,
          awaits_md_authorisation: !actorIsMd
        }),
        meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null
      ]
    );

    // A non-MD change puts an authorisation item in the MD's Approvals group.
    if (!actorIsMd) {
      const mds = await db.query<{ recipient: string }>(
        `SELECT ra.user_id AS recipient
           FROM role_assignments ra
           JOIN roles r ON r.id = ra.role_id
          WHERE ra.company_id=$1 AND ra.status='active' AND r.role_key='md'`,
        [actor.companyId]
      );
      for (const m of mds.rows) {
        await db.query(
          `INSERT INTO notifications (company_id, recipient_user_id, kind, payload)
           VALUES ($1,$2,'provider.awaiting_authorisation',$3::jsonb)`,
          [actor.companyId, m.recipient,
           JSON.stringify({ provider_config_id: row.id, provider: input.provider.trim() })]
        );
      }
    }

return toProviderConfigRow({ ...row, branch_id: input.branchId });
  });
}

/**
 * Vision Part 8 — the connection test. A provider configuration may only be
 * activated after a real, successful connection to the provider's API base
 * URL. The outcome is persisted, so activation is decided on evidence.
 */
export async function testProviderConnection(
  actor: PaymentActor,
  providerConfigId: string,
  meta: ActorMeta = {}
): Promise<{ ok: boolean; status: number | null; activated: boolean; detail: string }> {
  return withTenant(actor.companyId, null, async (db) => {
    if (!(await actorHoldsRole(db, actor, PROVIDER_CHANGE_ROLES))) {
      throw AppError.forbidden(
        "Only the MD, Deputy MD, GM or Finance group may test a provider connection"
      );
    }
    const cfg = await db.query<{
      id: string; api_base_url: string; md_approved_at: Date | null;
    }>(
      `SELECT id, api_base_url, md_approved_at FROM payment_provider_configs WHERE id=$1`,
      [providerConfigId]
    );
    if ((cfg.rowCount ?? 0) === 0) throw AppError.notFound("Provider config not found");
    const config = cfg.rows[0]!;

    let ok = false;
    let status: number | null = null;
    let detail = "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(config.api_base_url, {
        method: "GET",
        signal: controller.signal,
        redirect: "manual"
      });
      clearTimeout(timer);
      status = res.status;
      // Prohibitions #19/#21 — activation must follow a REAL successful
      // connection. A 401/403/404 proves the endpoint is reachable but that
      // the configuration is wrong, so it must NOT count as a pass.
      ok = res.status >= 200 && res.status < 300;
      detail = ok
        ? `HTTP ${res.status}`
        : `HTTP ${res.status} — the provider did not accept this configuration`;
    } catch (err) {
      detail = `connection failed: ${(err as Error).message}`;
    }

    await db.query(
      `UPDATE payment_provider_configs
          SET connection_tested_at = now(), connection_test_ok = $2,
              is_active = ($2 AND md_approved_at IS NOT NULL)
        WHERE id=$1`,
      [providerConfigId, ok]
    );
    const activated = ok && config.md_approved_at !== null;

    await db.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                               entity_id, new_value, reason, ip_address,
                               user_agent, request_id)
       VALUES ($1,$2,'payment_provider.connection_tested',
               'payment_provider_configs',$3,$4::jsonb,$5,$6,$7,$8)`,
       [actor.companyId, actor.sub, providerConfigId,
        JSON.stringify({ ok, status, activated }),
        detail, meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null]
    );

    // RULE 4.7.1 — a failed provider connection is an MD-level event.
    if (!ok) {
      await notifyProviderFailure(db, actor.companyId, {
        provider_config_id: providerConfigId,
        status,
        detail
      });
    }

    return { ok, status, activated, detail };
  });
}

/**
 * RULE 4.7.1 — the MD is notified of a provider or webhook failure.
 * A failed connection test means the branch's payment rail is not working,
 * which is an MD-level operational event, not only an audit line.
 */
async function notifyProviderFailure(
  db: pg.PoolClient,
  companyId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await insertNotificationsToMds(db, companyId, "provider.failure", payload);
}

/**
 * Vision Part 8 — the MD's authorisation of a provider change made by a
 * non-MD user. The authorisation arrives as a queue item in the MD's
 * Approvals group; approval activates the config once its connection test
 * has passed.
 */
export async function approveProviderChange(
  actor: PaymentActor,
  providerConfigId: string,
  meta: ActorMeta = {}
): Promise<{ ok: true; activated: boolean }> {
  return withTenant(actor.companyId, null, async (db) => {
    if (!(await actorHoldsRole(db, actor, ["md"]))) {
      throw AppError.forbidden("Only the MD may authorise a provider change");
    }
    const cfg = await db.query<{ id: string; connection_test_ok: boolean | null }>(
      `SELECT id, connection_test_ok FROM payment_provider_configs WHERE id=$1`,
      [providerConfigId]
    );
    if ((cfg.rowCount ?? 0) === 0) throw AppError.notFound("Provider config not found");
    const activated = cfg.rows[0]!.connection_test_ok === true;

    await db.query(
      `UPDATE payment_provider_configs
          SET md_approved_at = now(), md_approved_by = $2, is_active = $3::boolean
        WHERE id=$1`,
      [providerConfigId, actor.sub, activated]
    );
    await db.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                               entity_id, new_value, reason, ip_address,
                               user_agent, request_id)
       VALUES ($1,$2,'payment_provider.authorised',
               'payment_provider_configs',$3,$4::jsonb,
               'MD authorisation of provider change',$5,$6,$7)`,
      [actor.companyId, actor.sub, providerConfigId,
       JSON.stringify({ activated }),
       meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null]
    );
    return { ok: true, activated };
  });
}

/**
 * Vision Part 8 — the MD's Approvals group: provider changes awaiting the
 * MD's authorisation.
 */
export async function listPendingProviderApprovals(
  actor: PaymentActor
): Promise<{ items: unknown[] }> {
  return withTenant(actor.companyId, null, async (db) => {
    if (!(await actorHoldsRole(db, actor, ["md"]))) {
      throw AppError.forbidden("Only the MD sees the provider authorisation queue");
    }
    const r = await db.query(
      `SELECT id, provider, api_base_url, connection_tested_at,
              connection_test_ok, created_at
         FROM payment_provider_configs
        WHERE md_approved_at IS NULL
        ORDER BY created_at`
    );
    return {
      items: (r.rows as Array<Record<string, unknown>>).map((row) => ({
        id: row.id, provider: row.provider, apiBaseUrl: row.api_base_url,
        connectionTestedAt: row.connection_tested_at,
        connectionTestOk: row.connection_test_ok,
        createdAt: row.created_at
      }))
    };
  });
}

export async function listProviderConfigs(
  actor: PaymentActor
): Promise<ProviderConfigRow[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const r = await db.query<{
      id: string; provider: string;
      api_base_url: string; api_key: string;
      is_active: boolean; md_approved_at: Date | null; created_at: Date;
      branch_id: string | null;
    }>(
      `SELECT ppc.id, ppc.provider, ppc.api_base_url, ppc.api_key,
              ppc.is_active, ppc.md_approved_at, ppc.created_at,
              (SELECT bpa.branch_id FROM branch_payment_accounts bpa
                WHERE bpa.provider_config_id = ppc.id
                ORDER BY bpa.created_at LIMIT 1) AS branch_id
         FROM payment_provider_configs ppc
        WHERE ppc.company_id=$1
        ORDER BY ppc.created_at`,
      [actor.companyId]
    );
    return r.rows.map((row) => toProviderConfigRow(row));
  });
}

export async function getActiveProviderConfig(
  actor: PaymentActor
): Promise<ProviderConfigRow | null> {
  return withTenant(actor.companyId, null, async (db) => {
    const r = await db.query<{
      id: string; provider: string;
      api_base_url: string; api_key: string;
      is_active: boolean; md_approved_at: Date | null; created_at: Date;
      branch_id: string | null;
    }>(
      `SELECT ppc.id, ppc.provider, ppc.api_base_url, ppc.api_key,
              ppc.is_active, ppc.md_approved_at, ppc.created_at,
              bpa.branch_id
         FROM payment_provider_configs ppc
         JOIN branch_payment_accounts bpa ON bpa.provider_config_id = ppc.id
        WHERE ppc.company_id=$1 AND ppc.is_active=true
        ORDER BY ppc.md_approved_at DESC NULLS LAST, ppc.created_at ASC
        LIMIT 1`,
      [actor.companyId]
    );
    if ((r.rowCount ?? 0) === 0) return null;
    const row = r.rows[0]!;
    return toProviderConfigRow(row);
  });
}

export async function approveProviderConfig(
  actor: PaymentActor,
  configId: string,
  meta: ActorMeta = {}
): Promise<{ ok: boolean }> {
  return withTenant(actor.companyId, null, async (db) => {
    if (!(await actorHoldsRole(db, actor, ["md"]))) {
      throw AppError.forbidden("Only the MD may approve payment provider configuration");
    }
    const r = await db.query<{ id: string }>(
      `UPDATE payment_provider_configs
          SET md_approved_at=now(), md_approved_by=$2
        WHERE id=$1 AND company_id=$3
        RETURNING id`,
      [configId, actor.sub, actor.companyId]
    );
    if ((r.rowCount ?? 0) === 0) throw AppError.notFound("Provider config not found");
    await db.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                               entity_id, reason, ip_address, user_agent, request_id)
       VALUES ($1,$2,'payment_provider.md_approved','payment_provider_configs',$3,
               'MD authorised payment provider', $4,$5,$6)`,
      [actor.companyId, actor.sub, configId,
       meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null]
    );
    return { ok: true };
  });
}

export interface AssignBranchPaymentAccountInput {
  branchId: string;
  providerConfigId: string;
  accountName: string;
  providerAccountRef: string;
}

export async function assignBranchPaymentAccount(
  actor: PaymentActor,
  input: AssignBranchPaymentAccountInput
): Promise<BranchPaymentAccountRow> {
  if (!input.branchId) throw AppError.unprocessable("branchId is required");
  if (!input.accountName.trim() || !input.providerAccountRef.trim()) {
    throw AppError.unprocessable("accountName and providerAccountRef are required");
  }
  if (actor.branchId !== null && actor.branchId !== input.branchId) {
    throw AppError.forbidden("branch scope mismatch");
  }
  return withTenant(actor.companyId, null, async (db) => {
    // RULE 8.4.1 / prohibition #20 — a branch's provider is chosen by the MD's
    // management group. The IT/System Administrator performs the technical
    // credential flow but never changes which provider a branch uses.
    if (!(await actorHoldsRole(db, actor, PROVIDER_CHANGE_ROLES))) {
      throw AppError.forbidden(
        "Only the MD, Deputy MD, GM or Finance group may change a branch's payment provider"
      );
    }
    const branch = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE id=$1 AND company_id=$2`,
      [input.branchId, actor.companyId]
    );
    if ((branch.rowCount ?? 0) === 0) throw AppError.notFound("Branch not found");
    const config = await db.query<{ id: string; is_active: boolean; md_approved_at: Date | null }>(
      `SELECT id, is_active, md_approved_at FROM payment_provider_configs
        WHERE id=$1 AND company_id=$2`,
      [input.providerConfigId, actor.companyId]
    );
    if ((config.rowCount ?? 0) === 0) throw AppError.notFound("Provider config not found");
    // RULE 8.4.1 — a branch may only be pointed at a provider configuration
    // that is active AND MD-authorised; mapping must never activate a config
    // that has not passed its own test and authorisation.
    if (!config.rows[0]!.is_active || config.rows[0]!.md_approved_at === null) {
      throw AppError.conflict(
        "That provider configuration is not active or not yet MD-authorised; " +
        "a branch cannot be mapped to it"
      );
    }
    const inserted = await db.query<{
      id: string; branch_id: string; provider_config_id: string;
      account_name: string; provider_account_ref: string; is_active: boolean;
    }>(
      `INSERT INTO branch_payment_accounts
         (company_id, branch_id, provider_config_id, account_name, provider_account_ref)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (company_id, branch_id)
       DO UPDATE SET provider_config_id = EXCLUDED.provider_config_id,
                     account_name = EXCLUDED.account_name,
                     provider_account_ref = EXCLUDED.provider_account_ref,
                     is_active = true
       RETURNING id, branch_id, provider_config_id, account_name,
                 provider_account_ref, is_active`,
      [actor.companyId, input.branchId, input.providerConfigId,
       input.accountName.trim(), input.providerAccountRef.trim()]
    );
    const row = inserted.rows[0]!;
    const provider = (await db.query<{ provider: string }>(
      `SELECT provider FROM payment_provider_configs WHERE id=$1`,
      [input.providerConfigId]
    )).rows[0]!.provider;
    return {
      id: row.id, companyId: actor.companyId, branchId: row.branch_id,
      providerConfigId: row.provider_config_id, provider,
      accountName: row.account_name, providerAccountRef: row.provider_account_ref,
      isActive: row.is_active
    };
  });
}

export async function listBranchPaymentAccounts(
  actor: PaymentActor,
  branchId?: string | null
): Promise<BranchPaymentAccountRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const conds: string[] = [];
    const params: unknown[] = [actor.companyId];
    if (branchId) {
      params.push(branchId);
      conds.push(`bpa.branch_id=$${params.length}`);
    }
    const where = conds.length ? `AND ${conds.join(" AND ")}` : "";
    const r = await db.query<{
      id: string; branch_id: string; provider_config_id: string;
      provider: string; account_name: string; provider_account_ref: string;
      is_active: boolean;
    }>(
      `SELECT bpa.id, bpa.branch_id, bpa.provider_config_id, ppc.provider,
              bpa.account_name, bpa.provider_account_ref, bpa.is_active
         FROM branch_payment_accounts bpa
         JOIN payment_provider_configs ppc ON ppc.id = bpa.provider_config_id
        WHERE bpa.company_id=$1 ${where}
        ORDER BY bpa.created_at`,
      params
    );
    return r.rows.map((row) => ({
      id: row.id, companyId: actor.companyId, branchId: row.branch_id,
      providerConfigId: row.provider_config_id, provider: row.provider,
      accountName: row.account_name, providerAccountRef: row.provider_account_ref,
      isActive: row.is_active
    }));
  });
}

export async function loadSigningSecret(
  companyId: string,
  provider: string
): Promise<string | null> {
  // Tenant-scoped lookup: the webhook has already resolved the company,
  // so a tenant session scopes the RLS policy to that company's secret
  // (withBypass would only set bypass_rls, which the tenant policy on
  // webhook_signing_secrets does not honor).
  //
  // Only an MD-approved, active provider config can ingress webhooks
  // (Part 7 authorisation rule).
  return withTenant(companyId, null, async (db) => {
    const r = await db.query<{ secret: string }>(
      `SELECT wss.secret
         FROM webhook_signing_secrets wss
         JOIN payment_provider_configs ppc
           ON ppc.company_id = wss.company_id AND ppc.provider = wss.provider
        WHERE wss.company_id=$1 AND wss.provider=$2 AND wss.active=true
          AND ppc.is_active = true AND ppc.md_approved_at IS NOT NULL
        LIMIT 1`,
      [companyId, provider]
    );
    return (r.rowCount ?? 0) > 0 ? r.rows[0]!.secret : null;
  });
}

// ===================== pipeline =====================

export type WebhookEventKind =
  | "payment.received"
  | "payment.reversed";

export interface NormalizedWebhookEvent {
  provider: string;
  providerEventId: string;
  providerTxnRef: string;
  companySlug: string;        // resolved via provider header
  accountNumber: string;      // provider's account number for the customer's VA
  amount: string;             // numeric string
  valueDate: string;          // ISO timestamp from provider
  rawPayload: unknown;
  kind: WebhookEventKind;
  reason?: string;            // for reversals
}

export type PipelineOutcome =
  | { kind: "duplicate_suppressed"; paymentId: string }
  | { kind: "pending_allocation"; paymentId: string }
  | { kind: "received"; paymentId: string; status: string }
  | { kind: "unmatched"; paymentId: string }
  | { kind: "unallocated"; paymentId: string; reason: string }
  | { kind: "reversed"; reversalId: string; originalPaymentId: string }
  | { kind: "no_op"; reason: string };

// VERSION 3.2 — The Version 3.1 automatic allocation engine has been removed
// in full. Nexora automatically verifies and records incoming provider
// payments; the Collection Officer manually allocates the already-verified
// amount with EXACT equality (Loan Repayment + Savings = Verified Payment).
// There is no priority engine, no rollover/roll-forward, no residual, no
// silent rounding and no automatic correction anywhere in the pipeline.

// ----- pipeline step bookkeeping --------------------------------------

const STEP_NAMES: Record<number, string> = {
  1:  "signature_verification",
  2:  "idempotency_check",
  3:  "provider_verification",
  4:  "resolve_virtual_account",
  5:  "resolve_active_loans",
  6:  "allocation_engine",
  7:  "loan_repayment_savings_record",
  8:  "digital_collection_ledger_update",
  9:  "accounting_post",
  10: "receipt_generated",
  11: "notifications_sent",
  12: "audit_log_recorded",
  13: "dashboards_updated"
};

async function recordPipelineSteps(
  db: pg.PoolClient,
  paymentId: string,
  steps: number[]
): Promise<void> {
  for (const step of steps) {
    await db.query(
      `INSERT INTO pipeline_jobs
         (company_id, payment_id, step_number, step_name, status, attempts,
          started_at, finished_at)
       VALUES (
         (SELECT company_id FROM payments WHERE id=$1),
         $1, $2, $3, 'succeeded', 1, now(), now()
       )
       ON CONFLICT (payment_id, step_number) DO NOTHING`,
      [paymentId, step, STEP_NAMES[step] ?? `step_${step}`]
    );
  }
}

async function applyToSchedule(
  db: pg.PoolClient,
  paymentId: string,
  loanId: string,
  repaymentCents: bigint,
  savingsCents: bigint
): Promise<void> {
  if (repaymentCents === 0n && savingsCents === 0n) return;
  const r = await db.query<{ id: string }>(
    `SELECT id FROM repayment_schedule_rows
      WHERE loan_id=$1 AND paid_at IS NULL
      ORDER BY due_date ASC, cycle_number ASC
      LIMIT 1
      FOR UPDATE`,
    [loanId]
  );
  if ((r.rowCount ?? 0) === 0) {
    // RULE 9.1.3 / 10.5.1 / Part 15 prohibition 11.
    //
    // There is no open schedule row to apply this allocation to. The system
    // must NOT silently divert the money into savings, and it must NOT silently
    // drop it either: savings is only ever an outcome of the normal
    // loan-and-payment lifecycle, and only the amount the C.O. explicitly
    // allocated as savings may be posted as savings (RULE 19.6.1). A repayment
    // portion is never converted into savings behind the allocator's back.
    //
    // So the allocation is refused and surfaced as a reconciliation exception
    // for Finance, which is the Vision's "expose the discrepancy rather than
    // silently resolve or hide it" principle. The caller's transaction rolls
    // back, so no partial or invented financial record survives.
    throw AppError.unprocessable(
      "This loan has no open repayment schedule row to apply the allocation to. " +
        "The loan's schedule is fully settled, so this payment must be handled as " +
        "an exception by Finance rather than being posted automatically. " +
        "Savings is only ever posted from the amount explicitly allocated as savings."
    );
  }
  const scheduleId = r.rows[0]!.id;
  await db.query(
    `UPDATE repayment_schedule_rows
        SET actual_repayment = actual_repayment + $1::numeric,
            actual_savings   = actual_savings   + $2::numeric,
            paid_at = CASE
              WHEN actual_repayment + $1::numeric >= expected_repayment
                AND actual_savings + $2::numeric >= expected_savings
              THEN COALESCE(paid_at, now())
              ELSE paid_at
            END
      WHERE id=$3`,
    [fromCents(repaymentCents), fromCents(savingsCents), scheduleId]
  );
  // Backfill the exact ledger row this payment was applied to (0019 granted
  // column-level UPDATE on payment_allocations for this single linkage field).
  await db.query(
    `UPDATE payment_allocations SET schedule_row_id=$1 WHERE payment_id=$2`,
    [scheduleId, paymentId]
  );
}

async function creditSavings(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  customerId: string,
  paymentId: string,
  amountCents: bigint
): Promise<void> {
  if (amountCents <= 0n) return;
  await db.query(
    `INSERT INTO savings_accounts (company_id, branch_id, customer_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (customer_id) DO NOTHING`,
    [companyId, branchId, customerId]
  );
  const sa = await db.query<{ id: string; balance: string }>(
    `SELECT id, balance FROM savings_accounts WHERE customer_id=$1 FOR UPDATE`,
    [customerId]
  );
  const accountId = sa.rows[0]!.id;
  const newBalanceCents = toCents(sa.rows[0]!.balance) + amountCents;
  await db.query(
    `UPDATE savings_accounts SET balance = $1::numeric WHERE id=$2`,
    [fromCents(newBalanceCents), accountId]
  );
  await db.query(
    `INSERT INTO savings_transactions
       (company_id, savings_account_id, payment_id, direction, amount, balance_after)
     VALUES ($1,$2,$3,'credit',$4::numeric,$5::numeric)`,
    [companyId, accountId, paymentId,
     fromCents(amountCents), fromCents(newBalanceCents)]
  );
}

async function recordUnallocated(
  db: pg.PoolClient,
  companyId: string,
  branchId: string | null,
  customerId: string | null,
  event: NormalizedWebhookEvent,
  reason: string
): Promise<PipelineOutcome> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO payments (company_id, branch_id, customer_id, provider,
                           provider_txn_ref, amount, value_date, status,
                           raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'unallocated',$8::jsonb)
     RETURNING id`,
    [companyId, branchId, customerId, event.provider, event.providerTxnRef,
     event.amount, event.valueDate, JSON.stringify(event.rawPayload)]
  );
  const paymentId = inserted.rows[0]!.id;
  await db.query(
    `INSERT INTO unallocated_payments
       (company_id, branch_id, payment_id, reason, raw_payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [companyId, branchId, paymentId, reason, JSON.stringify(event.rawPayload)]
  );
  await db.query(
    `INSERT INTO reconciliation_items
       (company_id, payment_id, provider, provider_txn_ref,
        item_type, detail, status)
     VALUES ($1,$2,$3,$4,'unallocated_payment',$5::jsonb,'open')`,
    [companyId, paymentId, event.provider, event.providerTxnRef,
     JSON.stringify({ reason, amount: event.amount })]
  );
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action,
                             entity_type, entity_id, transaction_ref, reason)
     VALUES ($1,$2,NULL,'payment.unallocated','payments',$3,$4,$5)`,
    [companyId, branchId, paymentId, event.providerTxnRef, reason]
  );

  // RULE 4.7.1 — the MD is notified of unallocated money waiting beyond the
  // configured threshold. A single unmatched payment is a finance matter; a
  // growing unallocated balance is an MD-level event.
  const UNALLOCATED_THRESHOLD_CENTS = 100_000n; // 1,000.00
  const unallocated = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(p.amount),0)::text AS total
       FROM unallocated_payments up
       JOIN payments p ON p.id = up.payment_id
      WHERE up.company_id=$1 AND up.resolved_at IS NULL`,
    [companyId]
  );
  if (toCents(unallocated.rows[0]?.total ?? "0") >= UNALLOCATED_THRESHOLD_CENTS) {
    await insertNotificationsToMds(db, companyId, "payments.unallocated_threshold_exceeded", {
      payment_id: paymentId,
      reason,
      unallocated_total: unallocated.rows[0]?.total ?? "0",
      threshold: "1000.00"
    });
    // RULE 6.5.5 - unallocated money beyond the threshold also reaches the
    // auditors, who must be able to see it without being able to touch it.
    await notifyAuditors(db, {
      companyId,
      branchId: null,
      kind: "audit.unallocated_money_beyond_threshold",
      payload: {
        payment_id: paymentId,
        reason,
        unallocated_total: unallocated.rows[0]?.total ?? "0",
        threshold: "1000.00"
      }
    });
  }
  return { kind: "unallocated", paymentId, reason };
}

export async function reversePayment(
  db: pg.PoolClient,
  companyId: string,
  originalPaymentId: string,
  event: NormalizedWebhookEvent
): Promise<PipelineOutcome> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM payment_reversals WHERE original_payment_id=$1`,
    [originalPaymentId]
  );
  if ((existing.rowCount ?? 0) > 0) {
    return { kind: "no_op", reason: "reversal already recorded" };
  }
  const orig = await db.query<{
    id: string; amount: string; branch_id: string; customer_id: string;
  }>(
    `SELECT id, amount, branch_id, customer_id FROM payments WHERE id=$1`,
    [originalPaymentId]
  );
  if ((orig.rowCount ?? 0) === 0) {
    return { kind: "no_op", reason: "original payment vanished" };
  }
  const origRow = orig.rows[0]!;

  const allocs = await db.query<{
    loan_id: string; repayment_amount: string; savings_amount: string;
    schedule_row_id: string | null;
  }>(
    `SELECT loan_id, repayment_amount, savings_amount, schedule_row_id
       FROM payment_allocations
      WHERE payment_id=$1`,
    [originalPaymentId]
  );
  for (const a of allocs.rows) {
    if (!a.loan_id) continue;
    await db.query(
      `UPDATE loans
          SET outstanding_principal = outstanding_principal + $1::numeric
        WHERE id=$2`,
      [a.repayment_amount, a.loan_id]
    );
    if (a.repayment_amount !== "0" || a.savings_amount !== "0") {
      if (a.schedule_row_id) {
        await db.query(
          `UPDATE repayment_schedule_rows
              SET actual_repayment = GREATEST(0, actual_repayment - $1::numeric),
                  actual_savings   = GREATEST(0, actual_savings   - $2::numeric),
                  paid_at = CASE
                    WHEN actual_repayment - $1::numeric < expected_repayment
                      OR actual_savings - $2::numeric < expected_savings
                    THEN NULL
                    ELSE paid_at
                  END
            WHERE id=$3`,
          [a.repayment_amount, a.savings_amount, a.schedule_row_id]
        );
      } else {
        await db.query(
          `UPDATE repayment_schedule_rows
              SET actual_repayment = GREATEST(0, actual_repayment - $1::numeric),
                  actual_savings   = GREATEST(0, actual_savings   - $2::numeric),
                  paid_at = CASE
                    WHEN actual_repayment - $1::numeric < expected_repayment
                      OR actual_savings - $2::numeric < expected_savings
                    THEN NULL
                    ELSE paid_at
                  END
            WHERE id = (
              SELECT id FROM repayment_schedule_rows
               WHERE loan_id=$3
               ORDER BY due_date DESC, cycle_number DESC
               LIMIT 1
            )`,
          [a.repayment_amount, a.savings_amount, a.loan_id]
        );
      }
    }
    await db.query(
      `UPDATE loans SET status='active', completed_at=NULL
        WHERE id=$1 AND status='completed' AND outstanding_principal > 0`,
      [a.loan_id]
    );
  }

  const savingsTx = await db.query<{
    id: string; amount: string; savings_account_id: string;
  }>(
    `SELECT id, amount, savings_account_id
       FROM savings_transactions
      WHERE payment_id=$1 AND direction='credit'`,
    [originalPaymentId]
  );
  for (const s of savingsTx.rows) {
    const sa = await db.query<{ balance: string }>(
      `SELECT balance FROM savings_accounts WHERE id=$1 FOR UPDATE`,
      [s.savings_account_id]
    );
    if ((sa.rowCount ?? 0) > 0) {
      const newBalance = toCents(sa.rows[0]!.balance) - toCents(s.amount);
      if (newBalance < 0n) {
        await db.query(
          `UPDATE savings_accounts SET balance = 0 WHERE id=$1`,
          [s.savings_account_id]
        );
      } else {
        await db.query(
          `UPDATE savings_accounts SET balance = $1::numeric WHERE id=$2`,
          [fromCents(newBalance), s.savings_account_id]
        );
      }
      await db.query(
        `INSERT INTO savings_transactions
           (company_id, savings_account_id, payment_id, direction, amount, balance_after)
         VALUES ($1,$2,$3,'debit',$4::numeric,$5::numeric)`,
        [companyId, s.savings_account_id, originalPaymentId, s.amount,
         fromCents(newBalance < 0n ? 0n : newBalance)]
      );
    }
  }

    const rev = await db.query<{ id: string; branch_id: string | null }>(
      `INSERT INTO payment_reversals
         (company_id, original_payment_id, provider_txn_ref, reason)
       VALUES ($1,$2,$3,$4)
       RETURNING id,
         (SELECT branch_id FROM payments WHERE id=$2) AS branch_id`,
      [companyId, originalPaymentId, event.providerTxnRef,
       event.reason ?? "provider-initiated reversal"]
    );

  await db.query(
    `UPDATE payments SET status='reversed' WHERE id=$1`,
    [originalPaymentId]
  );

  await db.query(
    `INSERT INTO reconciliation_items
       (company_id, payment_id, provider, provider_txn_ref,
        item_type, detail, status)
     VALUES ($1,$2,$3,$4,'reversed_transaction',$5::jsonb,'open')`,
    [companyId, originalPaymentId, event.provider,
     event.providerTxnRef,
     JSON.stringify({ amount: origRow.amount, reason: event.reason })]
  );

  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action,
                             entity_type, entity_id, transaction_ref, reason)
     VALUES ($1,$2,NULL,'payment.reversed','payments',$3,$4,$5)`,
    [companyId, origRow.branch_id, originalPaymentId, event.providerTxnRef,
     event.reason ?? "provider reversal"]
  );

  // [9] accounting — mirror the original journal exactly (debit/credit
  // swapped) into a linked reversal entry. Idempotent: a reversal never
  // creates a second reversal entry.
  const originalEntry = await db.query<{ id: string }>(
    `SELECT id FROM journal_entries
      WHERE payment_id=$1 AND source='payment_pipeline'
      ORDER BY created_at ASC
      LIMIT 1`,
    [originalPaymentId]
  );
  if ((originalEntry.rowCount ?? 0) > 0) {
    await postReversalJournal(db, companyId, {
      paymentId: originalPaymentId,
      entryDate: event.valueDate.slice(0, 10),
      source: "reversal",
      description: "Provider reversal of verified payment allocation",
      createdBy: null,
      originalEntryId: originalEntry.rows[0]!.id
    });
  }

  // RULE 6.5.5 - a reversal is an auditable money event, so the company's
  // auditors are notified even though they can never act on it.
  await notifyAuditors(db, {
    companyId,
    branchId: rev.rows[0]!.branch_id,
    kind: "audit.payment_reversed",
    payload: {
      reversal_id: rev.rows[0]!.id,
      original_payment_id: originalPaymentId,
      reason: event.reason ?? null,
      provider: event.provider,
      provider_txn_ref: event.providerTxnRef
    }
  });

  return {
    kind: "reversed",
    reversalId: rev.rows[0]!.id,
    originalPaymentId
  };
}

/**
 * 13-step pipeline entry. Runs in a single tenant-scoped DB
 * transaction (withTenant on the resolved company).
 *
 * [1] signature verification — caller does this before invoking
 * [2] idempotency check via UNIQUE(provider, provider_txn_ref)
 * [3] provider verification (test stub: trust webhook body)
 * [4] resolve VA -> customer
 * [5] resolve customer's active loan(s)
 * [6] allocation engine
 * [7] repayment + savings ledger writes
 * [8] digital collection ledger (= schedule + savings)
 * [9] accounting post (receipts placeholder)
 * [10] receipt (receipts row)
 * [11] notifications
 * [12] audit log
 * [13] dashboards (derived)
 */
export async function runPaymentPipeline(
  event: NormalizedWebhookEvent
): Promise<PipelineOutcome> {
  // Resolve the company pre-auth (companies policies honor bypass_rls),
  // then run the whole pipeline inside a tenant-scoped transaction so
  // RLS scopes every ledger write to the webhook's company.
  const companyId = await withBypass(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM companies WHERE slug=$1`,
      [event.companySlug]
    );
    return (r.rowCount ?? 0) > 0 ? r.rows[0]!.id : null;
  });
  if (!companyId) {
    throw AppError.badRequest(`unknown company slug: ${event.companySlug}`);
  }

  return withTenant(companyId, null, async (db) => {
    const dup = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM payments
        WHERE provider=$1 AND provider_txn_ref=$2 LIMIT 1`,
      [event.provider, event.providerTxnRef]
    );

    if (event.kind === "payment.reversed") {
      if ((dup.rowCount ?? 0) === 0) {
        await db.query(
          `INSERT INTO webhook_exceptions
             (company_id, provider, exception_type, raw_payload, detail)
           VALUES ($1,$2,'verification_failed',$3::jsonb,$4::jsonb)`,
          [companyId, event.provider, JSON.stringify(event.rawPayload),
           JSON.stringify({ reason: "reversal of unknown original txn_ref" })]
        );
        return { kind: "no_op", reason: "reversal of unknown payment" };
      }
      return reversePayment(db, companyId, dup.rows[0]!.id, event);
    }

    if ((dup.rowCount ?? 0) > 0) {
      const existing = dup.rows[0]!;
      await db.query(
        `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                                 entity_id, transaction_ref, reason)
         VALUES ($1, NULL, 'payment.duplicate_suppressed', 'payments',
                 $2, $3, 'idempotency key already processed')`,
        [companyId, existing.id, event.providerTxnRef]
      );
      return { kind: "duplicate_suppressed", paymentId: existing.id };
    }
    return runForwardPipeline(db, companyId, event);
  });
}

async function runForwardPipeline(
  db: pg.PoolClient,
  companyId: string,
  event: NormalizedWebhookEvent
): Promise<PipelineOutcome> {
  // [4] Resolve VA
  const va = await db.query<{
    id: string; customer_id: string; branch_id: string; status: string;
  }>(
    `SELECT id, customer_id, branch_id, status FROM virtual_accounts
      WHERE provider=$1 AND account_number=$2 LIMIT 1`,
    [event.provider, event.accountNumber]
  );

  if ((va.rowCount ?? 0) === 0) {
    return await recordUnmatchedPayment(db, companyId, event);
  }
  const vaRow = va.rows[0]!;
  if (vaRow.status !== "active") {
    return await recordUnallocated(
      db, companyId, vaRow.branch_id, vaRow.customer_id, event,
      `virtual account status=${vaRow.status} (not active)`
    );
  }

  // [5] Resolve customer's active loans
  const loans = await db.query<{
    id: string; outstanding_principal: string; cycle_count: number;
    expected_repayment_per_cycle: string; expected_savings_per_cycle: string;
    status: string;
  }>(
    `SELECT id, outstanding_principal, cycle_count,
            expected_repayment_per_cycle, expected_savings_per_cycle, status
       FROM loans
      WHERE customer_id=$1 AND status IN ('active','overdue')
      ORDER BY disbursed_at ASC`,
    [vaRow.customer_id]
  );

  // RULE 9.1.3 / Part 15 prohibition 11 — a customer is never created or funded
  // in order to save. A verified payment for a customer with no active loan
  // cannot be allocated (Loan Repayment + Savings must equal the Verified
  // Payment), so it is recorded as an unallocated exception for
  // Finance/reconciliation — it never enters the C.O. Payment Allocation Queue
  // and never credits savings automatically.
  if ((loans.rowCount ?? 0) === 0) {
    return await recordUnallocated(
      db, companyId, vaRow.branch_id, vaRow.customer_id, event,
      "customer has no active loan to allocate against"
    );
  }

  // [6] VERSION 3.2 — the verified payment enters the responsible
  // Collection Officer's Payment Allocation Queue. The C.O. manually
  // allocates the immutable verified amount; Nexora then validates exact
  // equality and posts through the controlled pipeline. No automatic
  // allocation happens here.
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO payments (company_id, branch_id, customer_id, virtual_account_id,
                           provider, provider_txn_ref, amount, value_date,
                           status, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_allocation',$9::jsonb)
     RETURNING id`,
    [companyId, vaRow.branch_id, vaRow.customer_id, vaRow.id,
     event.provider, event.providerTxnRef, event.amount, event.valueDate,
     JSON.stringify(event.rawPayload)]
  );
  const paymentId = inserted.rows[0]!.id;
  await recordPipelineSteps(db, paymentId, [1, 2, 3, 4, 5]);
  // Step 6 (allocation) is pending until the C.O. allocates and posts.
  await db.query(
    `INSERT INTO pipeline_jobs
       (company_id, payment_id, step_number, step_name, status, attempts,
        started_at)
     VALUES (
       (SELECT company_id FROM payments WHERE id=$1),
       $1, 6, $2, 'pending_allocation', 1, now()
     )
     ON CONFLICT (payment_id, step_number) DO NOTHING`,
    [paymentId, STEP_NAMES[6] ?? "step_6"]
  );

  // Audit: verified payment awaiting allocation.
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action,
                             entity_type, entity_id, transaction_ref,
                             new_value, reason)
     VALUES ($1,$2,NULL,'payment.awaiting_allocation','payments',$3,$4,
             $5::jsonb, 'verified webhook payment awaiting C.O. allocation')`,
    [companyId, vaRow.branch_id, paymentId, event.providerTxnRef,
     JSON.stringify({ amount: event.amount, provider: event.provider })]
  );

  // Notify the responsible Collection Officer (customer assignment), the
  // branch's managers, and the Head Office finance class.
  await notifyAllocationQueue(db, companyId, vaRow.branch_id,
    vaRow.customer_id, paymentId, event.amount);

  return { kind: "pending_allocation", paymentId };
}

interface VaRow {
  id: string; customer_id: string; branch_id: string; status: string;
}

/**
 * VERSION 3.2 — notifies the responsible Collection Officer (via the
 * customer's active assignment), the branch's branch managers, and the
 * finance/MD class that a verified payment is waiting for allocation.
 */
async function notifyAllocationQueue(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  customerId: string,
  paymentId: string,
  amount: string
): Promise<void> {
  const payload = JSON.stringify({ payment_id: paymentId, amount });
  const recipients = await db.query<{ recipient: string }>(
    `SELECT DISTINCT recipient FROM (
        -- the customer's actively assigned Collection Officer
        SELECT ca.staff_id AS recipient
          FROM customer_assignments ca
         WHERE ca.company_id=$1 AND ca.customer_id=$2
           AND ca.status='active'
        UNION
        -- branch managers of the payment's branch
        SELECT ra.user_id AS recipient
          FROM role_assignments ra
          JOIN roles r ON r.id = ra.role_id
          JOIN role_assignment_branches rab ON rab.assignment_id = ra.id
         WHERE ra.company_id=$1 AND ra.status='active'
           AND r.role_key='branch_manager' AND rab.branch_id=$3
        UNION
        -- Head Office finance class + MD (company-wide financial oversight)
        SELECT ra.user_id AS recipient
          FROM role_assignments ra
          JOIN roles r ON r.id = ra.role_id
         WHERE ra.company_id=$1 AND ra.status='active'
           AND ra.scope_type='company_wide'
           AND r.role_key IN ('md','finance_manager','accountant')
     ) t`,
    [companyId, customerId, branchId]
  );
  for (const r of recipients.rows) {
    await db.query(
      `INSERT INTO notifications (company_id, recipient_user_id, kind, payload)
       VALUES ($1,$2,'payment.awaiting_allocation',$3::jsonb)`,
      [companyId, r.recipient, payload]
    );
  }
  // The customer is always notified that their verified payment is waiting
  // for allocation (RULE 9.9.1: payment received notifications to the
  // customer and the responsible worker).
  await db.query(
    `INSERT INTO notifications (company_id, recipient_customer_id, kind, payload)
     VALUES ($1,$2,'payment.awaiting_allocation',$3::jsonb)`,
    [companyId, customerId, payload]
  );
}

/**
 * VERSION 3.2 — the controlled financial posting pipeline. Called by
 * `allocateVerifiedPayment` after the C.O.'s manual allocation has passed
 * exact-equality validation. Every resulting financial record (allocation,
 * schedule, loan, Savings Achieved, accounting journal, receipt,
 * notifications, audit) is written here and nowhere else — no human ever
 * writes ledger figures directly.
 */
async function postVerifiedAllocation(
  db: pg.PoolClient,
  companyId: string,
  paymentId: string,
  payment: { amount: string; value_date: Date; customer_id: string; branch_id: string },
  loanId: string,
  repayCents: bigint,
  saveCents: bigint,
  allocatedBy: string
): Promise<void> {
  // [A] Allocation record (rollover is never used in Version 3.2).
  await db.query(
    `INSERT INTO payment_allocations
       (company_id, payment_id, loan_id, repayment_amount, savings_amount)
     VALUES ($1,$2,$3,$4,$5)`,
    [companyId, paymentId, loanId,
     fromCents(repayCents), fromCents(saveCents)]
  );

  // [B] Schedule + loan effects (the loan repayment portion).
  // The principal still outstanding BEFORE this repayment decides how much of
  // the repayment is principal and how much is interest (RULE 11.6.1).
  let outstandingCents = 0n;
  if (repayCents > 0n) {
    const before = await db.query<{ outstanding_principal: string }>(
      `SELECT outstanding_principal FROM loans WHERE id=$1`,
      [loanId]
    );
    outstandingCents = toCents(before.rows[0]!.outstanding_principal);
  }
  await applyToSchedule(db, paymentId, loanId, repayCents, saveCents);
  if (repayCents > 0n) {
    await db.query(
      `UPDATE loans
          SET outstanding_principal = GREATEST(0,
            outstanding_principal - $1::numeric)
        WHERE id=$2`,
      [fromCents(repayCents), loanId]
    );
    const completed = await db.query<{ outstanding_principal: string }>(
      `SELECT outstanding_principal FROM loans WHERE id=$1`, [loanId]
    );
    if (BigInt(toCents(completed.rows[0]!.outstanding_principal)) === 0n) {
      await db.query(
        `UPDATE loans SET status='completed', completed_at=now() WHERE id=$1`,
        [loanId]
      );
    }
  }

  // [C] Savings Achieved — an actual outcome of this posted allocation.
  if (saveCents > 0n) {
    await creditSavings(db, companyId, payment.branch_id,
      payment.customer_id, paymentId, saveCents);
  }

  // [D] Accounting journal — balanced by construction:
  //   DR 1000 Collection Account   = verified amount
  //   CR 1100 Loan Receivables     = principal portion of the repayment
  //   CR 4000 Interest Income      = interest recognised (the part of the
  //                                  repayment that exceeds the principal
  //                                  still outstanding)
  //   CR 2100 Customer Savings     = savings portion
  // RULE 11.6.1 — interest is income as it is earned. A repayment cannot drive
  // principal below zero, so whatever the repayment carries beyond the
  // outstanding principal is interest earned and is credited to income. This
  // is what makes an income statement derivable from the journal alone.
  const principalCents = repayCents < outstandingCents ? repayCents : outstandingCents;
  const interestCents = repayCents - principalCents;

  await postPaymentJournal(db, companyId, {
    paymentId,
    entryDate: payment.value_date.toISOString().slice(0, 10),
    source: "payment_pipeline",
    description: "Verified payment allocation (C.O.)",
    createdBy: allocatedBy,
    amountCents: toCents(payment.amount),
    loanCreditCents: principalCents,
    savingsCreditCents: saveCents,
    interestCents
  });

  // [E] Receipt.
  await db.query(
    `INSERT INTO receipts (company_id, payment_id, receipt_number, amount)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (payment_id) DO NOTHING`,
    [companyId, paymentId, `RCP-${paymentId}`, payment.amount]
  );

  // [F] Notifications: the customer and the allocating officer.
  await db.query(
    `INSERT INTO notifications (company_id, recipient_customer_id, kind, payload)
     VALUES ($1,$2,'payment.allocated',$3::jsonb)`,
    [companyId, payment.customer_id, JSON.stringify({
      payment_id: paymentId,
      amount: payment.amount,
      loan_id: loanId
    })]
  );
  await db.query(
    `INSERT INTO notifications (company_id, recipient_user_id, kind, payload)
     VALUES ($1,$2,'payment.allocated',$3::jsonb)`,
    [companyId, allocatedBy, JSON.stringify({ payment_id: paymentId, amount: payment.amount })]
  );

  // [G] Audit — allocation decisions are always audit-logged.
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action,
                             entity_type, entity_id, transaction_ref,
                             previous_value, new_value, reason)
     VALUES ($1,$2,$3,'payment.allocated','payments',$4,NULL,
             $5::jsonb, $6::jsonb, 'C.O. manual allocation of verified payment')`,
    [companyId, payment.branch_id, allocatedBy, paymentId,
     JSON.stringify({ status: "pending_allocation" }),
     JSON.stringify({
       status: "posted",
       loan_id: loanId,
       repayment: fromCents(repayCents),
       savings: fromCents(saveCents),
       verified_amount: payment.amount
     })]
  );

  // [H] The posted payment leaves the pending allocation queue. Historical
  // traceability is preserved through payment_allocations, the journal, the
  // audit trail and the payments row itself.
  await db.query(
    `UPDATE payments
        SET status='posted',
            allocation_submitted_by=$2,
            allocation_submitted_at=now()
      WHERE id=$1`,
    [paymentId, allocatedBy]
  );

  // [I] Pipeline steps 7-13 succeed; step 6 (allocation) completes.
  await db.query(
    `UPDATE pipeline_jobs SET status='succeeded', finished_at=now()
      WHERE payment_id=$1 AND step_number=6`,
    [paymentId]
  );
  await recordPipelineSteps(db, paymentId, [7, 8, 9, 10, 11, 12, 13]);
}

async function recordUnmatchedPayment(
  db: pg.PoolClient,
  companyId: string,
  event: NormalizedWebhookEvent
): Promise<PipelineOutcome> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO payments (company_id, branch_id, customer_id, provider,
                           provider_txn_ref, amount, value_date, status,
                           raw_payload)
     VALUES ($1, NULL, NULL, $2, $3, $4, $5, 'unmatched', $6::jsonb)
     RETURNING id`,
    [companyId, event.provider, event.providerTxnRef, event.amount,
     event.valueDate, JSON.stringify(event.rawPayload)]
  );
  const paymentId = inserted.rows[0]!.id;
  await db.query(
    `INSERT INTO unmatched_payments
       (company_id, payment_id, provider, provider_account_number,
        provider_reference, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [companyId, paymentId, event.provider, event.accountNumber,
     (event.rawPayload as { reference?: string } | null)?.reference ?? null,
     JSON.stringify(event.rawPayload)]
  );
  await db.query(
    `INSERT INTO reconciliation_items
       (company_id, payment_id, provider, provider_txn_ref,
        item_type, detail, status)
     VALUES ($1,$2,$3,$4,'unmatched_payment',$5::jsonb,'open')`,
    [companyId, paymentId, event.provider, event.providerTxnRef,
     JSON.stringify({
       account_number: event.accountNumber,
       amount: event.amount
     })]
  );
  await db.query(
    `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                             entity_id, transaction_ref, reason)
     VALUES ($1, NULL, 'payment.unmatched', 'payments',
             $2, $3, 'no virtual account for provider reference')`,
    [companyId, paymentId, event.providerTxnRef]
  );
  // RULE 6.5.5 - a provider/webhook failure is an auditable event.
  await notifyAuditors(db, {
    companyId,
    branchId: null,
    kind: "audit.provider_webhook_failure",
    payload: {
      payment_id: paymentId,
      provider: event.provider,
      provider_txn_ref: event.providerTxnRef,
      reason: "no virtual account for provider reference"
    }
  });
  return { kind: "unmatched", paymentId };
}

// ===================== read APIs =====================

export interface PaymentRow {
  id: string;
  companyId: string;
  branchId: string | null;
  customerId: string | null;
  virtualAccountId: string | null;
  provider: string;
  providerTxnRef: string;
  amount: string;
  valueDate: string;
  receivedAt: string;
  status: string;
}

export async function listPayments(
  actor: PaymentActor,
  filter: {
    status?: string | null;
    customerId?: string | null;
    branchId?: string | null;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ items: PaymentRow[]; total: number }> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      const allowed = [
        "received","verified","pending_allocation","allocated","posted","completed",
        "duplicate_suppressed","unmatched","unallocated",
        "incomplete_processing","reversed"
      ];
      if (!allowed.includes(filter.status)) {
        throw AppError.unprocessable("invalid status filter");
      }
      params.push(filter.status);
      conditions.push(`status=$${params.length}`);
    }
    if (filter.customerId) {
      params.push(filter.customerId);
      conditions.push(`customer_id=$${params.length}`);
    }
    if (filter.branchId) {
      params.push(filter.branchId);
      conditions.push(`branch_id=$${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payments ${where}`, params
    );
    params.push(limit); params.push(offset);
    const items = await db.query<{
      id: string; company_id: string; branch_id: string | null;
      customer_id: string | null; virtual_account_id: string | null;
      provider: string; provider_txn_ref: string; amount: string;
      value_date: Date; received_at: Date; status: string;
    }>(
      `SELECT id, company_id, branch_id, customer_id, virtual_account_id,
              provider, provider_txn_ref, amount, value_date, received_at,
              status
         FROM payments ${where}
         ORDER BY received_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return {
      items: items.rows.map((r) => ({
        id: r.id, companyId: r.company_id, branchId: r.branch_id,
        customerId: r.customer_id, virtualAccountId: r.virtual_account_id,
        provider: r.provider, providerTxnRef: r.provider_txn_ref,
        amount: r.amount, valueDate: r.value_date.toISOString(),
        receivedAt: r.received_at.toISOString(), status: r.status
      })),
      total: parseInt(total.rows[0]?.count ?? "0", 10)
    };
  });
}

export interface PaymentDetail {
  allocations: Array<{
    loanId: string | null;
    repayment: string;
    savings: string;
  }>;
  pipelineSteps: Array<{ step: number; name: string; status: string }>;
}

export async function getPayment(
  actor: PaymentActor,
  paymentId: string
): Promise<(PaymentRow & PaymentDetail) | null> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<{
      id: string; company_id: string; branch_id: string | null;
      customer_id: string | null; virtual_account_id: string | null;
      provider: string; provider_txn_ref: string; amount: string;
      value_date: Date; received_at: Date; status: string;
    }>(
      `SELECT id, company_id, branch_id, customer_id, virtual_account_id,
              provider, provider_txn_ref, amount, value_date, received_at,
              status FROM payments WHERE id=$1`,
      [paymentId]
    );
    if ((r.rowCount ?? 0) === 0) return null;
    const p = r.rows[0]!;
    const allocs = await db.query<{
      loan_id: string | null; repayment_amount: string;
      savings_amount: string;
    }>(
      `SELECT loan_id, repayment_amount, savings_amount
         FROM payment_allocations WHERE payment_id=$1`,
      [paymentId]
    );
    const steps = await db.query<{
      step_number: number; step_name: string; status: string;
    }>(
      `SELECT step_number, step_name, status
         FROM pipeline_jobs WHERE payment_id=$1
         ORDER BY step_number ASC`,
      [paymentId]
    );
    return {
      id: p.id, companyId: p.company_id, branchId: p.branch_id,
      customerId: p.customer_id, virtualAccountId: p.virtual_account_id,
      provider: p.provider, providerTxnRef: p.provider_txn_ref,
      amount: p.amount, valueDate: p.value_date.toISOString(),
      receivedAt: p.received_at.toISOString(), status: p.status,
      allocations: allocs.rows.map((a) => ({
        loanId: a.loan_id, repayment: a.repayment_amount,
        savings: a.savings_amount
      })),
      pipelineSteps: steps.rows.map((s) => ({
        step: s.step_number, name: s.step_name, status: s.status
      }))
    };
  });
}

export async function listUnmatchedPayments(
  actor: PaymentActor,
  filter: { resolved?: boolean | null; limit?: number; offset?: number } = {}
): Promise<{ items: unknown[]; total: number }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.resolved === true) conditions.push("resolved=true");
    if (filter.resolved === false) conditions.push("resolved=false");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM unmatched_payments ${where}`, params
    );
    params.push(limit); params.push(offset);
    const items = await db.query(
      `SELECT id, payment_id, provider, provider_account_number,
              provider_reference, resolved, created_at
         FROM unmatched_payments ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: parseInt(total.rows[0]?.count ?? "0", 10) };
  });
}

export async function listUnallocatedPayments(
  actor: PaymentActor,
  filter: { resolved?: boolean | null; limit?: number; offset?: number } = {}
): Promise<{ items: unknown[]; total: number }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.resolved === true) conditions.push("resolved=true");
    if (filter.resolved === false) conditions.push("resolved=false");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM unallocated_payments ${where}`, params
    );
    params.push(limit); params.push(offset);
    const items = await db.query(
      `SELECT id, payment_id, reason, resolved, created_at
         FROM unallocated_payments ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: parseInt(total.rows[0]?.count ?? "0", 10) };
  });
}

export async function listWebhookExceptions(
  filter: { resolved?: boolean | null; limit?: number; offset?: number } = {}
): Promise<{ items: unknown[]; total: number }> {
  return withBypass(async (db) => {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const conditions: string[] = ["company_id IS NULL"];
    const params: unknown[] = [];
    if (filter.resolved === true) conditions.push("resolved=true");
    if (filter.resolved === false) conditions.push("resolved=false");
    const where = `WHERE ${conditions.join(" AND ")}`;
    const total = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM webhook_exceptions ${where}`, params
    );
    params.push(limit); params.push(offset);
    const items = await db.query(
      `SELECT id, provider, exception_type, detail, resolved, created_at
         FROM webhook_exceptions ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: parseInt(total.rows[0]?.count ?? "0", 10) };
  });
}

export async function listReconciliationItems(
  actor: PaymentActor,
  filter: { status?: "open" | "resolved" | "dismissed" | null;
            limit?: number; offset?: number; } = {}
): Promise<{ items: unknown[]; total: number }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status=$${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM reconciliation_items ${where}`, params
    );
    params.push(limit); params.push(offset);
    const items = await db.query(
      `SELECT id, payment_id, item_type, provider, provider_txn_ref,
              detail, status, created_at
         FROM reconciliation_items ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: parseInt(total.rows[0]?.count ?? "0", 10) };
  });
}

// VISION V3.2 — roles that may resolve/dismiss a reconciliation exception.
// The Finance group owns the reconciliation queue (RULE 6.6.1); the MD's
// management group may also act on open items.
const RECONCILIATION_ROLES = [
  "finance_manager",
  "accountant",
  "assistant_accountant",
  "cash_bank_reconciliation_officer",
  "md",
  "deputy_md",
  "gm",
];

async function actOnReconciliationItem(
  actor: PaymentActor,
  itemId: string,
  outcome: "resolved" | "dismissed",
  note: string | null,
  meta: ActorMeta
): Promise<unknown> {
  return withTenant(actor.companyId, null, async (db) => {
    if (!(await actorHoldsRole(db, actor, RECONCILIATION_ROLES))) {
      throw AppError.forbidden(
        "Only the Finance or MD management group may resolve or dismiss a reconciliation exception"
      );
    }
    const existing = await db.query(
      `SELECT id, company_id, status, resolved_by, resolved_at, resolution_note
         FROM reconciliation_items WHERE id=$1 FOR UPDATE`,
      [itemId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Reconciliation item not found");
    const prev = (existing.rows[0] ?? {}) as Record<string, unknown>;
    if (prev.status !== "open") {
      throw AppError.conflict(
        `Reconciliation item is '${String(prev.status)}' and can no longer be acted on`
      );
    }
    const updated = await db.query(
      `UPDATE reconciliation_items
          SET status=$2, resolved_by=$3, resolved_at=now(), resolution_note=$4
        WHERE id=$1
        RETURNING id, payment_id, item_type, provider, provider_txn_ref,
                  detail, status, resolved_by, resolved_at, resolution_note, created_at`,
      [itemId, outcome, actor.sub, note]
    );
    const next = updated.rows[0]!;
    await db.query(
      `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action,
                               entity_type, entity_id, previous_value, new_value, reason)
       VALUES ($1, $2, $3, $4, 'reconciliation_items', $5, $6::jsonb, $7::jsonb, $8)`,
      [
        actor.companyId, null, actor.sub,
        `reconciliation_item.${outcome}`, itemId,
        JSON.stringify({ status: "open" }),
        JSON.stringify({ status: outcome }),
        note,
      ]
    );
    return next;
  });
}

export async function resolveReconciliationItem(
  actor: PaymentActor,
  itemId: string,
  note: string | null,
  meta: ActorMeta = {}
): Promise<unknown> {
  return actOnReconciliationItem(actor, itemId, "resolved", note, meta);
}

export async function dismissReconciliationItem(
  actor: PaymentActor,
  itemId: string,
  note: string | null,
  meta: ActorMeta = {}
): Promise<unknown> {
  return actOnReconciliationItem(actor, itemId, "dismissed", note, meta);
}

/**
 * Manual re-allocation entry point for staff (Finance / Branch Manager).
 * Required by the §21 "Payment received but allocation failed" exception:
 * a verified payment that the engine could not apply now needs a human
 * decision. The endpoint never creates a new payment — it only moves
 * already-received money from `unallocated_payments` to a real
 * schedule row. This preserves the "no manual repayment entry" rule.
 */
// VERSION 3.2 — roles that may allocate an already-verified payment. The
// Collection Officer manually allocates; no other role may create, invent or
// edit a payment, and no role may edit the verified amount.
const ALLOCATION_ROLES = [
  "collection_officer",
  "senior_collection_officer",
  "branch_manager",
  "deputy_branch_manager",
  "recovery_officer",
  "md"
];

/**
 * VERSION 3.2 C.O. Payment Allocation workflow.
 *
 * The verified payment's amount is immutable: the C.O. submits a split and
 * Nexora enforces the mandatory allocation equation
 *
 *     Loan Repayment + Savings === Verified Payment   (exact, in cents)
 *
 * Under-allocation is rejected. Over-allocation is rejected. There is no
 * residual, no silent rounding (amounts with more than two decimals are
 * refused outright), no hidden adjustment and no automatic correction.
 * On success the allocation posts through the controlled pipeline
 * (`postVerifiedAllocation`) and the payment leaves the pending queue while
 * remaining fully traceable in history.
 */
export async function allocateVerifiedPayment(
  actor: PaymentActor,
  input: {
    paymentId: string;
    loanId: string;
    repaymentAmount: string;
    savingsAmount: string;
    note: string;
  },
  meta: ActorMeta = {}
): Promise<{ ok: true; paymentId: string; loanId: string }> {
  if (!input.loanId) throw AppError.unprocessable("loanId is required");
  if (!input.paymentId) throw AppError.unprocessable("paymentId is required");
  // Exact-decimal money parsing: anything with more than two decimals is
  // invalid, so silent rounding can never occur.
  let repay: bigint;
  let save: bigint;
  try {
    repay = toCents(input.repaymentAmount);
    save = toCents(input.savingsAmount);
  } catch {
    throw AppError.unprocessable(
      "amounts must be exact decimal values with at most two decimal places"
    );
  }

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    // Only the C.O. class (of the payment's branch) or the MD may allocate.
    if (!(await actorHoldsRole(db, actor, ALLOCATION_ROLES))) {
      throw AppError.forbidden(
        "Only a Collection Officer of the responsible branch (or the MD) may allocate a verified payment"
      );
    }

    const p = await db.query<{
      id: string; amount: string; status: string; customer_id: string;
      branch_id: string; value_date: Date;
    }>(
      `SELECT id, amount, status, customer_id, branch_id, value_date
         FROM payments WHERE id=$1`,
      [input.paymentId]
    );
    if ((p.rowCount ?? 0) === 0) throw AppError.notFound("Payment not found");
    const pay = p.rows[0]!;

    // The queue item must still be pending allocation. Posted, allocated,
    // reversed, unmatched and unallocated payments can never be allocated.
    if (pay.status !== "pending_allocation") {
      throw AppError.conflict(
        `Payment is not in the pending allocation queue (status=${pay.status})`
      );
    }

    // Branch-scoped actors may only allocate payments of their own branch.
    if (actor.branchId && pay.branch_id !== actor.branchId) {
      throw AppError.forbidden(
        "This payment belongs to another branch's allocation queue"
      );
    }

    // The loan must belong to the payment's customer and be live.
    const loan = await db.query<{ id: string; customer_id: string; status: string }>(
      `SELECT id, customer_id, status FROM loans WHERE id=$1`,
      [input.loanId]
    );
    if ((loan.rowCount ?? 0) === 0) throw AppError.notFound("Loan not found");
    if (loan.rows[0]!.customer_id !== pay.customer_id) {
      throw AppError.unprocessable(
        "The selected loan does not belong to this payment's customer"
      );
    }
    if (!["active", "overdue"].includes(loan.rows[0]!.status)) {
      throw AppError.unprocessable(
        `Loan is ${loan.rows[0]!.status}; only active or overdue loans can be repaid`
      );
    }

    // Mandatory allocation equation: Loan Repayment + Savings = Verified Payment.
    const verified = toCents(pay.amount);
    const submitted = repay + save;
    if (submitted < verified) {
      throw AppError.unprocessable(
        `Under-allocation rejected: Loan Repayment + Savings (${fromCents(submitted)}) must equal the verified payment (${fromCents(verified)}) exactly. Residuals are not allowed.`
      );
    }
    if (submitted > verified) {
      throw AppError.unprocessable(
        `Over-allocation rejected: Loan Repayment + Savings (${fromCents(submitted)}) must equal the verified payment (${fromCents(verified)}) exactly. Hidden adjustments are not allowed.`
      );
    }
    if (repay < 0n || save < 0n) {
      throw AppError.unprocessable("allocation components cannot be negative");
    }
    if (verified === 0n) {
      throw AppError.unprocessable("zero-amount payments cannot be allocated");
    }

    await postVerifiedAllocation(
      db, actor.companyId, input.paymentId, pay, input.loanId,
      repay, save, actor.sub
    );

    // Optional C.O. note is retained on the reconciliation trail when one
    // exists (never as a change to the immutable verified payment amount).
    if (input.note) {
      await db.query(
        `UPDATE reconciliation_items
            SET status='resolved', resolved_by=$1, resolved_at=now(),
                resolution_note=$2
          WHERE payment_id=$3 AND item_type='unallocated_payment'`,
        [actor.sub, input.note, input.paymentId]
      );
    }

    return { ok: true, paymentId: input.paymentId, loanId: input.loanId };
  });
}

/**
 * VERSION 3.2 — the responsible Collection Officer's Payment Allocation
 * Queue: verified payments awaiting manual allocation. Branch-scoped actors
 * see only their branch's queue; company-wide roles see the whole company.
 */
export async function listPendingAllocations(
  actor: PaymentActor,
  filter: { limit?: number; offset?: number } = {}
): Promise<{ items: unknown[]; total: number }> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const conditions: string[] = ["p.status='pending_allocation'"];
    const params: unknown[] = [];
    if (actor.branchId) {
      params.push(actor.branchId);
      conditions.push(`p.branch_id=$${params.length}`);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const total = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payments p ${where}`, params
    );
    params.push(limit); params.push(offset);
    const items = await db.query(
      `SELECT p.id, p.company_id, p.branch_id, p.customer_id,
              p.virtual_account_id, p.provider, p.provider_txn_ref, p.amount,
              p.value_date, p.received_at,
              c.first_name || ' ' || c.last_name AS customer_name,
              (SELECT g.id FROM group_members gm JOIN groups g ON g.id = gm.group_id
                WHERE gm.customer_id = p.customer_id AND g.status='active'
                ORDER BY gm.joined_at ASC LIMIT 1) AS group_id,
              (SELECT g.name FROM group_members gm JOIN groups g ON g.id = gm.group_id
                WHERE gm.customer_id = p.customer_id AND g.status='active'
                ORDER BY gm.joined_at ASC LIMIT 1) AS group_name,
              EXISTS (
                SELECT 1
                  FROM customer_assignments ca
                  JOIN users u ON u.id = ca.staff_id
                 WHERE ca.customer_id = p.customer_id
                   AND ca.status = 'active'
                   AND u.credential_state = 'portfolio_on_hold'
              ) AS held
         FROM payments p
         LEFT JOIN customers c ON c.id = p.customer_id
        ${where}
        ORDER BY p.received_at ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return {
      items: (items.rows as Array<Record<string, unknown>>).map((r) => ({
        id: r.id, companyId: r.company_id, branchId: r.branch_id,
        customerId: r.customer_id, virtualAccountId: r.virtual_account_id,
        provider: r.provider, providerTxnRef: r.provider_txn_ref,
        amount: r.amount, valueDate: (r.value_date as Date).toISOString(),
        receivedAt: (r.received_at as Date).toISOString(),
        customerName: r.customer_name,
        groupId: r.group_id,
        groupName: r.group_name,
        // RULE 5.8.2.4 — while a portfolio is on hold, money received is
        // flagged held so it is never silently treated as a normal book.
        held: r.held === true
      })),
      total: parseInt(total.rows[0]?.count ?? "0", 10)
    };
  });
}

export interface AllocationDetail {
  payment: {
    id: string;
    customerId: string;
    customerName: string;
    groupId: string | null;
    groupName: string | null;
    provider: string;
    providerTxnRef: string;
    verifiedAmount: string;
    status: string;
    valueDate: string;
    receivedAt: string;
  };
  financialContext: {
    outstandingLoanBalance: string;
    currentExpectedRepayment: string | null;
    nextExpectedRepayment: string | null;
    currentSavingsBalance: string;
    existingAllocations: Array<{
      scheduleRowId: string | null;
      loanRepayment: string;
      savings: string;
      total: string;
    }>;
    totalAllocated: string;
  };
  remainingToAllocate: string;
  canPost: boolean;
}

/**
 * RULE 10.5.3B/10.5.3C — opening a pending payment shows the customer, group,
 * reference, received date, the LOCKED verified amount, the loan/savings
 * inputs, the running total and what remains, together with the financial
 * context the C.O. needs: outstanding balance, current and next expected
 * repayment, current savings balance and the new verified payment. Posting is
 * permitted only when the total equals the verified amount exactly.
 */
export async function getAllocationDetail(
  actor: PaymentActor,
  paymentId: string
): Promise<AllocationDetail> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const payment = await db.query<{
      id: string; customer_id: string; provider: string; provider_txn_ref: string;
      amount: string; status: string; value_date: Date; received_at: Date;
      customer_name: string; group_id: string | null; group_name: string | null;
    }>(
      `SELECT p.id, p.customer_id, p.provider, p.provider_txn_ref, p.amount, p.status,
              p.value_date, p.received_at,
              c.first_name || ' ' || c.last_name AS customer_name,
              (SELECT g.id FROM group_members gm JOIN groups g ON g.id = gm.group_id
                WHERE gm.customer_id = p.customer_id AND g.status='active'
                ORDER BY gm.joined_at ASC LIMIT 1) AS group_id,
              (SELECT g.name FROM group_members gm JOIN groups g ON g.id = gm.group_id
                WHERE gm.customer_id = p.customer_id AND g.status='active'
                ORDER BY gm.joined_at ASC LIMIT 1) AS group_name
         FROM payments p
         LEFT JOIN customers c ON c.id = p.customer_id
        WHERE p.id = $1`,
      [paymentId]
    );
    if ((payment.rowCount ?? 0) === 0) throw AppError.notFound("Payment not found");
    const p = payment.rows[0]!;

    const loans = await db.query<{
      loan_id: string; outstanding_principal: string; status: string;
    }>(
      `SELECT id AS loan_id, outstanding_principal, status
         FROM loans WHERE customer_id=$1 AND status IN ('active','overdue')
        ORDER BY disbursed_at ASC LIMIT 1`,
      [p.customer_id]
    );
    const loan = (loans.rowCount ?? 0) > 0 ? loans.rows[0]! : null;

    const schedule = loan
      ? await db.query<{ id: string; expected_repayment: string; due_date: Date }>(
          `SELECT id, expected_repayment, due_date
             FROM repayment_schedule_rows
            WHERE loan_id=$1 AND (actual_repayment < expected_repayment)
            ORDER BY due_date ASC LIMIT 2`,
          [loan.loan_id]
        )
      : { rows: [] as Array<{ id: string; expected_repayment: string; due_date: Date }> };

    const savings = await db.query<{ balance: string }>(
      `SELECT COALESCE(balance,0)::text AS balance
         FROM savings_accounts WHERE customer_id=$1 AND status='active'
        ORDER BY created_at DESC LIMIT 1`,
      [p.customer_id]
    );

    const allocations = await db.query<{
      schedule_row_id: string | null; repayment_amount: string; savings_amount: string;
    }>(
      `SELECT schedule_row_id, repayment_amount, savings_amount
         FROM payment_allocations WHERE payment_id=$1`,
      [p.id]
    );
    const existingAllocations = allocations.rows.map((row) => ({
      scheduleRowId: row.schedule_row_id,
      loanRepayment: row.repayment_amount,
      savings: row.savings_amount,
      total: String(
        Math.round((Number(row.repayment_amount) + Number(row.savings_amount)) * 100) / 100
      )
    }));
    const totalAllocated = String(
      Math.round(
        existingAllocations.reduce((sum, row) => sum + Number(row.total), 0) * 100
      ) / 100
    );
    const remainingToAllocate = String(
      Math.round((Number(p.amount) - Number(totalAllocated)) * 100) / 100
    );

    return {
      payment: {
        id: p.id,
        customerId: p.customer_id,
        customerName: p.customer_name,
        groupId: p.group_id,
        groupName: p.group_name,
        provider: p.provider,
        providerTxnRef: p.provider_txn_ref,
        verifiedAmount: p.amount,
        status: p.status,
        valueDate: p.value_date.toISOString(),
        receivedAt: p.received_at.toISOString()
      },
      financialContext: {
        outstandingLoanBalance: loan?.outstanding_principal ?? "0",
        currentExpectedRepayment: schedule.rows[0]?.expected_repayment ?? null,
        nextExpectedRepayment: schedule.rows[1]?.expected_repayment ?? null,
        currentSavingsBalance: savings.rows[0]?.balance ?? "0.00",
        existingAllocations,
        totalAllocated
      },
      remainingToAllocate,
      canPost: Number(remainingToAllocate) === 0 && p.status === "pending_allocation"
    };
  });
}

/**
 * Scheduled reconciliation diff (Part 1 §21): per-company
 * reconciliation_items are persistent, resolvable records of
 * differences between provider-known and Nexora-known transactions.
 *
 * The actual provider pull is a separate cron/worker; this entry
 * point diffs an explicitly-supplied list of provider-known
 * transactions against what Nexora has on file and inserts new
 * reconciliation_items for any difference. The "reconciliation
 * is not a report that is generated and forgotten" rule is
 * enforced by inserting rows (not returning a result object) so
 * the differences live in the queue.
 */
export async function reconcileProviderTransactions(
  actor: PaymentActor,
  input: {
    provider: string;
    providerTransactions: Array<{
      providerTxnRef: string;
      amount: string;
      valueDate: string;
    }>;
  }
): Promise<{ added: number }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    let added = 0;
    for (const t of input.providerTransactions) {
      const r = await db.query<{
        id: string; amount: string; value_date: Date;
      }>(
        `SELECT id, amount, value_date FROM payments
          WHERE provider=$1 AND provider_txn_ref=$2 LIMIT 1`,
        [input.provider, t.providerTxnRef]
      );
      if ((r.rowCount ?? 0) === 0) {
        await db.query(
          `INSERT INTO reconciliation_items
             (company_id, payment_id, provider, provider_txn_ref,
              item_type, detail, status)
           VALUES ($1, NULL, $2, $3, 'incomplete_processing', $4::jsonb, 'open')`,
          [actor.companyId, input.provider, t.providerTxnRef,
           JSON.stringify({ reason: "provider has transaction, Nexora does not",
                            amount: t.amount, value_date: t.valueDate })]
        );
        added++;
      } else {
        const known = r.rows[0]!;
        if (known.amount !== t.amount) {
          await db.query(
            `INSERT INTO reconciliation_items
               (company_id, payment_id, provider, provider_txn_ref,
                item_type, detail, status)
             VALUES ($1, $2, $3, $4, 'incomplete_processing',
                     $5::jsonb, 'open')`,
            [actor.companyId, known.id, input.provider, t.providerTxnRef,
             JSON.stringify({ reason: "amount mismatch",
                              nexora_amount: known.amount,
                              provider_amount: t.amount })]
          );
          added++;
        }
      }
    }
    await db.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                               entity_id, reason)
       VALUES ($1, $2, 'payment.reconciliation_run',
               'reconciliation_items', NULL, $3)`,
      [actor.companyId, actor.sub,
       `provider=${input.provider} diffed ${input.providerTransactions.length} txns, added ${added} items`]
    );

    // Part 2 §40 — exceptions raised by the reconciliation run are surfaced in
    // the Notification Center for the finance group.
    if (added > 0) {
      const recipients = await activeFinanceUserIds(db, actor.companyId);
      if (recipients.length > 0) {
        await insertUserNotifications(
          db,
          actor.companyId,
          recipients,
          "reconciliation.exception_added",
          {
            provider: input.provider,
            added,
            transactions: input.providerTransactions,
          }
        );
      }
      // RULE 4.7.1 — a reconciliation exception is also an MD-level event.
      await insertNotificationsToMds(db, actor.companyId, "reconciliation.exception_added", {
        provider: input.provider,
        added
      });
      // RULE 6.5.5 — and an Auditor-level event.
      await notifyAuditors(db, {
        companyId: actor.companyId,
        branchId: null,
        kind: "audit.reconciliation_exception",
        payload: { provider: input.provider, added }
      });
    }
    return { added };
  });
}

// ===================== controlled correction workflow (RULE 5.6.3 / 11.4.3) =====================
//
// A financial correction is never an edit. Finance investigates and prepares a
// request; only MD, GM or an authorised Auditor may approve; the system then
// posts a new linked reversal record. The original payment, its allocation, its
// schedule effects and its journal entries are never rewritten.

/** RULE 5.6.3 — Finance prepares, these three approve. */
const CORRECTION_APPROVER_ROLES = ["md", "gm", "internal_auditor"];

/** RULE 5.6.3 — Finance and the C.O. side may investigate and prepare. */
const CORRECTION_REQUESTER_ROLES = [
  "md",
  "gm",
  "finance_manager",
  "accountant",
  "assistant_accountant",
  "cash_bank_reconciliation_officer",
  "internal_auditor",
  "audit_officer",
];

export interface CorrectionRequestRow {
  id: string;
  paymentId: string;
  kind: string;
  reason: string;
  status: string;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  postedReversalId: string | null;
  postedAt: Date | null;
}

function mapCorrection(row: Record<string, unknown>): CorrectionRequestRow {
  return {
    id: String(row.id),
    paymentId: String(row.payment_id),
    kind: String(row.kind),
    reason: String(row.reason),
    status: String(row.status),
    requestedBy: String(row.requested_by),
    requestedAt: row.requested_at as Date,
    decidedBy: (row.decided_by as string | null) ?? null,
    decidedAt: (row.decided_at as Date | null) ?? null,
    decisionReason: (row.decision_reason as string | null) ?? null,
    postedReversalId: (row.posted_reversal_id as string | null) ?? null,
    postedAt: (row.posted_at as Date | null) ?? null
  };
}

const CORRECTION_SELECT = `
  SELECT id, payment_id, kind, reason, status, requested_by, requested_at,
         decided_by, decided_at, decision_reason, posted_reversal_id, posted_at
    FROM correction_requests`;

/** RULE 5.6.3 — Finance prepares a correction request; it approves nothing. */
export async function requestCorrection(
  actor: PaymentActor,
  input: { paymentId: string; reason: string; kind?: "reversal" | "correction" },
  meta: ActorMeta = {}
): Promise<CorrectionRequestRow> {
  if (!input.reason || input.reason.trim().length < 10) {
    throw AppError.unprocessable("A correction request requires a reason of at least 10 characters");
  }
  return withTenant(actor.companyId, null, async (db) => {
    if (!(await actorHoldsRole(db, actor, CORRECTION_REQUESTER_ROLES))) {
      throw AppError.forbidden(
        "Only Finance, Audit or an MD/GM may prepare a correction request"
      );
    }
    const payment = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM payments WHERE id=$1 FOR UPDATE`,
      [input.paymentId]
    );
    if ((payment.rowCount ?? 0) === 0) throw AppError.notFound("Payment not found");

    const already = await db.query<{ id: string }>(
      `SELECT id FROM correction_requests
        WHERE payment_id=$1 AND status IN ('requested','approved')`,
      [input.paymentId]
    );
    if ((already.rowCount ?? 0) > 0) {
      throw AppError.conflict("A correction request is already open for this payment");
    }

    const inserted = await db.query<Record<string, unknown>>(
      `INSERT INTO correction_requests
         (company_id, payment_id, kind, reason, requested_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, payment_id, kind, reason, status, requested_by, requested_at,
                 decided_by, decided_at, decision_reason, posted_reversal_id, posted_at`,
      [actor.companyId, input.paymentId, input.kind ?? "reversal",
       input.reason.trim(), actor.sub]
    );
    const row = inserted.rows[0]!;

    await db.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                               entity_id, reason, ip_address, user_agent, request_id)
       VALUES ($1,$2,'correction.requested','correction_requests',$3,$4,$5,$6,$7)`,
      [actor.companyId, actor.sub, row.id, input.reason.trim(),
       meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null]
    );

    // RULE 4.7.1 — the approvers are notified that a correction awaits them.
    const approvers = await db.query<{ recipient: string }>(
      `SELECT ra.user_id AS recipient
         FROM role_assignments ra
         JOIN roles r ON r.id = ra.role_id
        WHERE ra.company_id=$1 AND ra.status='active'
          AND r.role_key = ANY($2::text[])`,
      [actor.companyId, CORRECTION_APPROVER_ROLES]
    );
    for (const a of approvers.rows) {
      await db.query(
        `INSERT INTO notifications (company_id, recipient_user_id, kind, payload)
         VALUES ($1,$2,'correction.awaiting_approval',$3::jsonb)`,
        [actor.companyId, a.recipient,
         JSON.stringify({ correction_request_id: row.id, payment_id: input.paymentId })]
      );
    }
    return mapCorrection(row);
  });
}

/** RULE 5.6.3 — approve or reject, then the system posts the reversal. */
export async function decideCorrection(
  actor: PaymentActor,
  requestId: string,
  decision: "approve" | "reject",
  reason: string,
  meta: ActorMeta = {}
): Promise<CorrectionRequestRow> {
  if (!reason || reason.trim().length < 5) {
    throw AppError.unprocessable("A decision reason is required");
  }
  return withTenant(actor.companyId, null, async (db) => {
    if (!(await actorHoldsRole(db, actor, CORRECTION_APPROVER_ROLES))) {
      throw AppError.forbidden(
        "Only the MD, GM or an authorised Auditor may approve a financial correction"
      );
    }
    const found = await db.query<Record<string, unknown>>(
      `SELECT id, payment_id, status FROM correction_requests WHERE id=$1 FOR UPDATE`,
      [requestId]
    );
    if ((found.rowCount ?? 0) === 0) throw AppError.notFound("Correction request not found");
    const req = found.rows[0]!;
    if (req.status !== "requested") {
      throw AppError.conflict(`This correction request is already ${req.status}`);
    }

    if (decision === "reject") {
      const rejected = await db.query<Record<string, unknown>>(
        `UPDATE correction_requests
            SET status='rejected', decided_by=$1, decided_at=now(), decision_reason=$2
          WHERE id=$3
          RETURNING id, payment_id, kind, reason, status, requested_by, requested_at,
                    decided_by, decided_at, decision_reason, posted_reversal_id, posted_at`,
        [actor.sub, reason.trim(), requestId]
      );
      const row = rejected.rows[0]!;
      await db.query(
        `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                                 entity_id, reason, ip_address, user_agent, request_id)
         VALUES ($1,$2,'correction.rejected','correction_requests',$3,$4,$5,$6,$7)`,
        [actor.companyId, actor.sub, requestId, reason.trim(),
         meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null]
      );
      return mapCorrection(row);
    }

    // Approve: the system posts the linked reversal. The original records are
    // left intact; this only adds a new, linked, audit-logged record.
    const payment = await db.query<{ provider_txn_ref: string; amount: string }>(
      `SELECT provider_txn_ref, amount FROM payments WHERE id=$1`,
      [req.payment_id]
    );
    const event: NormalizedWebhookEvent = {
      provider: "correction",
      providerEventId: `correction-${requestId}`,
      providerTxnRef: payment.rows[0]?.provider_txn_ref ?? `correction-${requestId}`,
      companySlug: "",
      accountNumber: "",
      amount: payment.rows[0]?.amount ?? "0",
      valueDate: new Date().toISOString(),
      rawPayload: { correction_request_id: requestId, decision_reason: reason.trim() },
      kind: "payment.reversed",
      reason: `Approved correction: ${reason.trim()}`
    };
    const outcome = await reversePayment(db, actor.companyId, String(req.payment_id), event);

    const posted = await db.query<Record<string, unknown>>(
      `UPDATE correction_requests
          SET status='posted', decided_by=$1, decided_at=now(), decision_reason=$2,
              posted_reversal_id=$3, posted_at=now()
        WHERE id=$4
        RETURNING id, payment_id, kind, reason, status, requested_by, requested_at,
                  decided_by, decided_at, decision_reason, posted_reversal_id, posted_at`,
      [actor.sub, reason.trim(),
       (outcome as { reversalId?: string }).reversalId ?? null, requestId]
    );
    const row = posted.rows[0]!;
    await db.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                               entity_id, reason, ip_address, user_agent, request_id)
       VALUES ($1,$2,'correction.posted','correction_requests',$3,$4,$5,$6,$7)`,
      [actor.companyId, actor.sub, requestId, reason.trim(),
       meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null]
    );
    return mapCorrection(row);
  });
}

/** Read surface for the approvers' queue. */
export async function listCorrections(
  actor: PaymentActor,
  status?: string
): Promise<CorrectionRequestRow[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const r = status
      ? await db.query<Record<string, unknown>>(
          `${CORRECTION_SELECT} WHERE status=$1 ORDER BY requested_at DESC`, [status])
      : await db.query<Record<string, unknown>>(
          `${CORRECTION_SELECT} ORDER BY requested_at DESC`);
    return r.rows.map(mapCorrection);
  });
}
