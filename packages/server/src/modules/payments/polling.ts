// Scheduled provider polling - Vision RULE 8.5.6.
//
// "The platform must never rely only on webhooks: a scheduled polling or
// reconciliation job must periodically confirm that every provider transaction
// matches a recorded payment, and must raise an exception for anything found
// only on the provider side."
//
// The reconciliation diff already existed, but nothing ever fed it: it expected
// an explicitly supplied list of provider transactions and its own comment
// deferred the "separate cron/worker" to a future change. Every provider was
// therefore webhook-only in practice, which is precisely what the rule forbids.
//
// Two properties matter more than the polling itself:
//
//  1. A FAILED poll is loud. If the provider cannot be reached or answers with
//     something we cannot read, the job raises an exception rather than
//     reporting success. A silent skip would let a broken rail look healthy,
//     which is the failure mode the rule is written against.
//
//  2. The watermark only advances after a poll that actually parsed. If a poll
//     fails or returns an unreadable envelope, the next poll re-reads the same
//     window, so transactions that were inside it cannot be skipped forever.

import type pg from "pg";
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { loadProviderApiKey, reconcileProviderTransactions } from "./service";

export interface PollActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface PollOutcome {
  providerConfigId: string;
  provider: string;
  fetched: number;
  exceptions: number;
  ok: boolean;
  detail: string;
}

interface ProviderPollConfig {
  id: string;
  provider: string;
  api_base_url: string;
  branch_id: string | null;
  poll_watermark: Date | null;
}

/**
 * How far back a poll looks on its first run. A watermark exists to avoid
 * re-reading months of history every hour, not to silently skip a window the
 * platform has never verified.
 */
const FIRST_POLL_LOOKBACK_HOURS = 48;
const POLL_TIMEOUT_MS = 8000;

/**
 * Reads the provider's transaction list. The envelope differs per provider, so
 * this deliberately recognises only the shapes that carry an unambiguous
 * reference, an amount and a date. Anything else is treated as UNREADABLE
 * rather than coerced, because guessing a transaction shape would create
 * reconciliation exceptions that look real but are fiction.
 */
function readProviderTransactions(payload: unknown): {
  transactions: Array<{ providerTxnRef: string; amount: string; valueDate: string }>;
} {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { transactions?: unknown })?.transactions)
        ? (payload as { transactions: unknown[] }).transactions
        : null;

  if (candidates === null) {
    throw new Error("provider response did not contain a transaction list");
  }

  const transactions: Array<{ providerTxnRef: string; amount: string; valueDate: string }> = [];
  for (const raw of candidates) {
    const row = raw as Record<string, unknown>;
    const ref =
      row.reference ?? row.provider_reference ?? row.reference_code ?? row.transaction_reference;
    const amount = row.amount ?? row.value ?? row.total;
    const date = row.value_date ?? row.transaction_date ?? row.created_at ?? row.date;

    if (typeof ref !== "string" || ref.trim() === "") {
      throw new Error("provider transaction has no usable reference");
    }
    if (amount === undefined || amount === null) {
      throw new Error(`provider transaction ${ref} has no amount`);
    }
    if (typeof date !== "string" && !(date instanceof Date)) {
      throw new Error(`provider transaction ${ref} has no value date`);
    }

    transactions.push({
      providerTxnRef: ref,
      amount: String(amount),
      valueDate: date instanceof Date ? date.toISOString() : date
    });
  }
  return { transactions };
}

async function recordPollFailure(
  db: pg.PoolClient,
  companyId: string,
  cfg: ProviderPollConfig,
  detail: string
): Promise<void> {
  await db.query(
    `UPDATE payment_provider_configs
        SET last_poll_at = now(), poll_failure_count = poll_failure_count + 1
      WHERE id = $1`,
    [cfg.id]
  );
  // RULE 8.5.6 - anything the platform cannot positively confirm must raise an
  // exception rather than disappear.
  await db.query(
    `INSERT INTO reconciliation_items
       (company_id, payment_id, provider, provider_txn_ref, item_type, detail, status)
     VALUES ($1, NULL, $2, NULL, 'incomplete_processing', $3::jsonb, 'open')`,
    [
      companyId,
      cfg.provider,
      JSON.stringify({ reason: "scheduled provider poll could not confirm transactions", detail })
    ]
  );
}

/**
 * Polls one active provider configuration and reconciles whatever it returns.
 * Never throws: a provider that is down must not abort the schedule for every
 * other provider, so the failure is recorded as an exception and reported.
 */
export async function pollProviderConfig(
  actor: PollActor,
  providerConfigId: string
): Promise<PollOutcome> {
  const cfg = await withTenant(actor.companyId, null, async (db) => {
    const r = await db.query<ProviderPollConfig>(
      `SELECT id, provider, api_base_url, branch_id, poll_watermark
         FROM payment_provider_configs
        WHERE id = $1 AND is_active = true`,
      [providerConfigId]
    );
    if ((r.rowCount ?? 0) === 0) {
      throw AppError.notFound("Active provider config not found");
    }
    return r.rows[0]!;
  });

  const since =
    cfg.poll_watermark ?? new Date(Date.now() - FIRST_POLL_LOOKBACK_HOURS * 3600_000);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
    // RULE 14.5.1 - the credential is decrypted for this single call and is
    // never logged or returned.
    const apiKey = await loadProviderApiKey(actor.companyId, cfg.provider);
    const headers: Record<string, string> = { accept: "application/json" };
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
      headers["x-api-key"] = apiKey;
    }
    const url = new URL(cfg.api_base_url);
    url.searchParams.set("since", since.toISOString());
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
      headers
    });
    clearTimeout(timer);

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`provider answered HTTP ${res.status}`);
    }

    const body = await res.json();
    const { transactions } = readProviderTransactions(body);

    const { added } = await reconcileProviderTransactions(actor, {
      provider: cfg.provider,
      providerTransactions: transactions
    });

    await withTenant(actor.companyId, null, async (db) => {
      // Only now is it safe to move the watermark: the poll parsed, and the
      // differences are durably in reconciliation_items.
      await db.query(
        `UPDATE payment_provider_configs
            SET last_poll_at = now(), poll_success_count = poll_success_count + 1,
                poll_watermark = GREATEST(COALESCE(poll_watermark, $2), $2)
          WHERE id = $1`,
        [cfg.id, new Date()]
      );
      if (cfg.branch_id !== null) {
        await db.query(
          `UPDATE branches
              SET last_provider_poll_at = now(), provider_poll_failure_count = 0
            WHERE id = $1`,
          [cfg.branch_id]
        );
      }
    });

    return {
      providerConfigId: cfg.id,
      provider: cfg.provider,
      fetched: transactions.length,
      exceptions: added,
      ok: true,
      detail: `confirmed ${transactions.length} provider transaction(s) since ${since.toISOString()}`
    };
  } catch (err) {
    const detail = (err as Error).message;
    await withTenant(actor.companyId, null, async (db) => {
      await recordPollFailure(db, actor.companyId, cfg, detail);
      if (cfg.branch_id !== null) {
        await db.query(
          `UPDATE branches
              SET last_provider_poll_at = now(),
                  provider_poll_failure_count = provider_poll_failure_count + 1
            WHERE id = $1`,
          [cfg.branch_id]
        );
      }
    });
    return {
      providerConfigId: cfg.id,
      provider: cfg.provider,
      fetched: 0,
      exceptions: 1,
      ok: false,
      detail
    };
  }
}