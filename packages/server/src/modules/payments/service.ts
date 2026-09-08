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
  branchId: string;
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  isActive: boolean;
  createdAt: string;
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
  if (!input.branchId) throw AppError.unprocessable("branchId is required");
  if (actor.branchId !== null && actor.branchId !== input.branchId) {
    throw AppError.forbidden("branch scope mismatch");
  }

  return withTenant(actor.companyId, input.branchId, async (db) => {
    // Replace any existing config for this company (one provider per
    // company in v1; rotating API key + secret is a re-write).
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM payment_provider_configs WHERE company_id=$1`,
      [actor.companyId]
    );
    if ((existing.rowCount ?? 0) > 0) {
      await db.query(`DELETE FROM payment_provider_configs WHERE company_id=$1`, [
        actor.companyId
      ]);
    }
    const existingSecret = await db.query<{ id: string }>(
      `SELECT id FROM webhook_signing_secrets WHERE company_id=$1`,
      [actor.companyId]
    );
    if ((existingSecret.rowCount ?? 0) > 0) {
      await db.query(`DELETE FROM webhook_signing_secrets WHERE company_id=$1`, [
        actor.companyId
      ]);
    }

    const inserted = await db.query<{
      id: string;
      company_id: string;
      branch_id: string;
      provider: string;
      api_base_url: string;
      api_key: string;
      is_active: boolean;
      created_at: Date;
    }>(
      `INSERT INTO payment_provider_configs
         (company_id, branch_id, provider, api_base_url, api_key, is_active)
       VALUES ($1,$2,$3,$4,$5,true)
       RETURNING id, company_id, branch_id, provider, api_base_url, api_key,
                 is_active, created_at`,
      [actor.companyId, input.branchId, input.provider.trim(),
       input.apiBaseUrl.trim(), input.apiKey]
    );
    const row = inserted.rows[0]!;
    await db.query(
      `INSERT INTO webhook_signing_secrets (company_id, provider, secret)
       VALUES ($1,$2,$3)`,
      [actor.companyId, input.provider.trim(), input.signingSecret]
    );

    await db.query(
      `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action,
                               entity_type, entity_id, new_value, reason,
                               ip_address, user_agent, request_id)
       VALUES ($1,$2,$3,'payment_provider.configured',
               'payment_provider_configs',$4,$5::jsonb,'provider configuration set',
               $6,$7,$8)`,
      [
        actor.companyId, input.branchId, actor.sub, row.id,
        JSON.stringify({
          provider: input.provider.trim(),
          api_base_url: input.apiBaseUrl.trim(),
          has_secret: true
        }),
        meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null
      ]
    );

    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      provider: row.provider,
      apiBaseUrl: row.api_base_url,
      apiKey: row.api_key,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString()
    };
  });
}

export async function getActiveProviderConfig(
  actor: PaymentActor
): Promise<ProviderConfigRow | null> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<{
      id: string; company_id: string; branch_id: string; provider: string;
      api_base_url: string; api_key: string; is_active: boolean; created_at: Date;
    }>(
      `SELECT id, company_id, branch_id, provider, api_base_url, api_key,
              is_active, created_at
         FROM payment_provider_configs
        WHERE company_id=$1 AND is_active=true
        LIMIT 1`,
      [actor.companyId]
    );
    if ((r.rowCount ?? 0) === 0) return null;
    const row = r.rows[0]!;
    return {
      id: row.id, companyId: row.company_id, branchId: row.branch_id,
      provider: row.provider, apiBaseUrl: row.api_base_url, apiKey: row.api_key,
      isActive: row.is_active, createdAt: row.created_at.toISOString()
    };
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
  return withTenant(companyId, null, async (db) => {
    const r = await db.query<{ secret: string }>(
      `SELECT secret FROM webhook_signing_secrets
        WHERE company_id=$1 AND provider=$2 AND active=true
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
  | { kind: "received"; paymentId: string; status: string }
  | { kind: "unmatched"; paymentId: string }
  | { kind: "unallocated"; paymentId: string; reason: string }
  | { kind: "reversed"; reversalId: string; originalPaymentId: string }
  | { kind: "no_op"; reason: string };

interface AllocationLoan {
  id: string;
  outstanding_principal: string;
  cycle_count: number;
  expected_repayment_per_cycle: string;
  expected_savings_per_cycle: string;
  status: string;
}

interface AllocationPart {
  loanId: string;
  repaymentAmount: bigint;
  savingsAmount: bigint;
  rolloverAmount: bigint;
}

type AllocationResult =
  | { kind: "ok"; parts: AllocationPart[]; savingsRemainder: bigint }
  | { kind: "unallocatable"; reason: string };

/**
 * Allocation engine (Part 1 §24).
 *
 * Inputs: amount received, list of customer's active loans with
 *         outstanding_principal + expected per-cycle amounts.
 * Output: per-loan split of repayment/savings/rollover, plus any
 *         savings remainder (excess that did not roll forward).
 *
 * Rules:
 *   • Exact expected amount → full repayment + full savings per loan.
 *   • Less than expected → repayment first, savings absorbs the
 *     shortfall (down to zero).
 *   • More than expected → excess goes to savings, or — if it
 *     completes a full cycle — rolls forward to the next cycle's
 *     repayment (repayment of the same loan, not the next loan).
 *   • Multiple loans → oldest loan (first in list) is paid first.
 */
function allocateAcrossLoans(
  amountReceived: string,
  loans: AllocationLoan[]
): AllocationResult {
  if (loans.length === 0) {
    return { kind: "unallocatable", reason: "no active loans" };
  }
  let remaining = toCents(amountReceived);
  const parts: AllocationPart[] = loans.map((l) => ({
    loanId: l.id,
    repaymentAmount: 0n,
    savingsAmount: 0n,
    rolloverAmount: 0n
  }));
  // The "savings remainder" is any money that could not be applied
  // to a loan and is therefore credited to the customer's savings
  // account. Within a loan, the spec calls out rollover as the
  // behaviour when excess covers a full cycle.
  let savingsRemainder = 0n;

  for (let i = 0; i < loans.length && remaining > 0n; i++) {
    const loan = loans[i]!;
    const part = parts[i]!;
    const expectedRepay = toCents(loan.expected_repayment_per_cycle);
    const expectedSave = toCents(loan.expected_savings_per_cycle);
    const outstanding = toCents(loan.outstanding_principal);

    // Step A: fill the current cycle's repayment first.
    const repayFill = outstanding < expectedRepay ? outstanding : expectedRepay;
    const repayApplied = remaining < repayFill ? remaining : repayFill;
    part.repaymentAmount = repayApplied;
    remaining -= repayApplied;

    // Step B: with anything left over, fill the current cycle's
    // savings (down to zero if amount < expected).
    if (remaining > 0n) {
      const saveFill = remaining < expectedSave ? remaining : expectedSave;
      part.savingsAmount = saveFill;
      remaining -= saveFill;
    }

    // Step C: if the cycle is fully satisfied and the customer
    // still has money, attempt a full-cycle rollover into the
    // next cycle's repayment. This is the "if excess completes a
    // full repayment cycle" branch of §24.
    if (remaining >= expectedRepay + expectedSave && outstanding > 0n) {
      part.rolloverAmount = expectedRepay + expectedSave;
      remaining -= expectedRepay + expectedSave;
    } else if (remaining > 0n) {
      // Partial excess → savings for this loan.
      part.savingsAmount += remaining;
      remaining = 0n;
    }

    if (outstanding === 0n) {
      // Loan already cleared; everything in this iteration goes
      // to savings.
      part.savingsAmount += part.repaymentAmount;
      part.repaymentAmount = 0n;
      // If the cycle was full + a rollover was queued, downgrade
      // the rollover into savings too.
      if (part.rolloverAmount > 0n) {
        part.savingsAmount += part.rolloverAmount;
        part.rolloverAmount = 0n;
      }
    }
  }

  if (remaining > 0n) {
    // No more loans to consume against; route excess to savings.
    savingsRemainder = remaining;
  }

  return { kind: "ok", parts, savingsRemainder };
}

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
    // No open cycle; treat the incoming as savings-only.
    if (repaymentCents + savingsCents > 0n) {
      const customer = await db.query<{ customer_id: string; branch_id: string }>(
        `SELECT customer_id, branch_id FROM loans WHERE id=$1`, [loanId]
      );
      if ((customer.rowCount ?? 0) > 0) {
        const companyId = (await db.query<{ company_id: string }>(
          `SELECT company_id FROM loans WHERE id=$1`, [loanId]
        )).rows[0]!.company_id;
        await creditSavings(db, companyId, customer.rows[0]!.branch_id,
          customer.rows[0]!.customer_id, paymentId,
          repaymentCents + savingsCents);
      }
    }
    return;
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

async function recordPureSavings(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  customerId: string,
  event: NormalizedWebhookEvent
): Promise<PipelineOutcome> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO payments (company_id, branch_id, customer_id, provider,
                           provider_txn_ref, amount, value_date, status,
                           raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',$8::jsonb)
     RETURNING id`,
    [companyId, branchId, customerId, event.provider, event.providerTxnRef,
     event.amount, event.valueDate, JSON.stringify(event.rawPayload)]
  );
  const paymentId = inserted.rows[0]!.id;
  await recordPipelineSteps(db, paymentId,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  await creditSavings(db, companyId, branchId, customerId, paymentId,
    toCents(event.amount));
  await db.query(
    `INSERT INTO receipts (company_id, payment_id, receipt_number, amount)
     VALUES ($1,$2,$3,$4)`,
    [companyId, paymentId, `RCP-${paymentId}`,
     event.amount]
  );
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action,
                             entity_type, entity_id, transaction_ref, reason)
     VALUES ($1,$2,NULL,'payment.received','payments',$3,$4,
             'savings-only deposit (no active loans)')`,
    [companyId, branchId, paymentId, event.providerTxnRef]
  );
  return { kind: "received", paymentId, status: "completed" };
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
  return { kind: "unallocated", paymentId, reason };
}

async function reversePayment(
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
  }>(
    `SELECT loan_id, repayment_amount, savings_amount
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

  const rev = await db.query<{ id: string }>(
    `INSERT INTO payment_reversals
       (company_id, original_payment_id, provider_txn_ref, reason)
     VALUES ($1,$2,$3,$4)
     RETURNING id`,
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

  if ((loans.rowCount ?? 0) === 0) {
    return await recordPureSavings(
      db, companyId, vaRow.branch_id, vaRow.customer_id, event
    );
  }

  // [6]+[7]+[8] Allocation + ledger writes
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO payments (company_id, branch_id, customer_id, virtual_account_id,
                           provider, provider_txn_ref, amount, value_date,
                           status, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'verified',$9::jsonb)
     RETURNING id`,
    [companyId, vaRow.branch_id, vaRow.customer_id, vaRow.id,
     event.provider, event.providerTxnRef, event.amount, event.valueDate,
     JSON.stringify(event.rawPayload)]
  );
  const paymentId = inserted.rows[0]!.id;
  await recordPipelineSteps(db, paymentId, [1, 2, 3, 4, 5]);

  const allocation = allocateAcrossLoans(
    event.amount,
    loans.rows.map((l) => ({
      id: l.id,
      outstanding_principal: l.outstanding_principal,
      cycle_count: l.cycle_count,
      expected_repayment_per_cycle: l.expected_repayment_per_cycle,
      expected_savings_per_cycle: l.expected_savings_per_cycle,
      status: l.status
    }))
  );

  if (allocation.kind === "unallocatable") {
    await db.query(
      `UPDATE payments SET status='unallocated' WHERE id=$1`,
      [paymentId]
    );
    await db.query(
      `INSERT INTO unallocated_payments
         (company_id, branch_id, payment_id, reason, raw_payload)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [companyId, vaRow.branch_id, paymentId, allocation.reason,
       JSON.stringify(event.rawPayload)]
    );
    await db.query(
      `INSERT INTO reconciliation_items
         (company_id, payment_id, provider, provider_txn_ref,
          item_type, detail, status)
       VALUES ($1,$2,$3,$4,'unallocated_payment',$5::jsonb,'open')`,
      [companyId, paymentId, event.provider,
       event.providerTxnRef,
       JSON.stringify({ reason: allocation.reason, amount: event.amount })]
    );
    await db.query(
      `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action,
                               entity_type, entity_id, transaction_ref, reason)
       VALUES ($1,$2,NULL,'payment.unallocated','payments',$3,$4,$5)`,
      [companyId, vaRow.branch_id, paymentId, event.providerTxnRef,
       allocation.reason]
    );
    return { kind: "unallocated", paymentId, reason: allocation.reason };
  }
  return await persistForwardAllocation(
    db, companyId, vaRow, allocation, paymentId, event
  );
}

interface VaRow {
  id: string; customer_id: string; branch_id: string; status: string;
}

async function persistForwardAllocation(
  db: pg.PoolClient,
  companyId: string,
  vaRow: VaRow,
  allocation: { kind: "ok"; parts: AllocationPart[]; savingsRemainder: bigint },
  paymentId: string,
  event: NormalizedWebhookEvent
): Promise<PipelineOutcome> {
  for (const part of allocation.parts) {
    if (part.repaymentAmount === 0n && part.savingsAmount === 0n &&
        part.rolloverAmount === 0n) {
      continue;
    }
    await db.query(
      `INSERT INTO payment_allocations
         (company_id, payment_id, loan_id, repayment_amount,
          savings_amount, rollover_amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [companyId, paymentId, part.loanId,
       fromCents(part.repaymentAmount),
       fromCents(part.savingsAmount),
       fromCents(part.rolloverAmount)]
    );
  }

  for (const part of allocation.parts) {
    if (part.repaymentAmount === 0n && part.savingsAmount === 0n &&
        part.rolloverAmount === 0n) {
      continue;
    }
    await applyToSchedule(db, paymentId, part.loanId,
      part.repaymentAmount, part.savingsAmount);
    if (part.repaymentAmount > 0n) {
      await db.query(
        `UPDATE loans
            SET outstanding_principal = GREATEST(0,
              outstanding_principal - $1::numeric)
          WHERE id=$2`,
        [fromCents(part.repaymentAmount), part.loanId]
      );
      const completed = await db.query<{ outstanding_principal: string }>(
        `SELECT outstanding_principal FROM loans WHERE id=$1`, [part.loanId]
      );
      if (BigInt(toCents(completed.rows[0]!.outstanding_principal)) === 0n) {
        await db.query(
          `UPDATE loans SET status='completed', completed_at=now() WHERE id=$1`,
          [part.loanId]
        );
      }
    }
  }

  if (allocation.savingsRemainder > 0n) {
    await creditSavings(
      db, companyId, vaRow.branch_id, vaRow.customer_id, paymentId,
      allocation.savingsRemainder
    );
  }

  // [10] receipt
  await db.query(
    `INSERT INTO receipts (company_id, payment_id, receipt_number, amount)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (payment_id) DO NOTHING`,
    [companyId, paymentId,
     `RCP-${paymentId}`, event.amount]
  );

  // [11] notifications
  await db.query(
    `INSERT INTO notifications (company_id, recipient_customer_id, kind, payload)
     VALUES ($1,$2,'payment.received',$3::jsonb)`,
    [companyId, vaRow.customer_id, JSON.stringify({
      payment_id: paymentId,
      amount: event.amount,
      provider: event.provider
    })]
  );

  // [12] audit
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action,
                             entity_type, entity_id, transaction_ref,
                             previous_value, new_value, reason)
     VALUES ($1,$2,NULL,'payment.received','payments',$3,$4,
             NULL, $5::jsonb, 'webhook')`,
    [companyId, vaRow.branch_id, paymentId, event.providerTxnRef,
     JSON.stringify({
       amount: event.amount,
       allocation: allocation.parts.map((p) => ({
         loan_id: p.loanId,
         repayment: fromCents(p.repaymentAmount),
         savings: fromCents(p.savingsAmount),
         rollover: fromCents(p.rolloverAmount)
       })),
       savings_remainder: fromCents(allocation.savingsRemainder)
     })]
  );

  await db.query(
    `UPDATE payments SET status='completed' WHERE id=$1`,
    [paymentId]
  );

  await recordPipelineSteps(db, paymentId, [6, 7, 8, 9, 10, 11, 12, 13]);

  return { kind: "received", paymentId, status: "completed" };
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
        "received","verified","identified","allocated","posted","completed",
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
    rollover: string;
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
      savings_amount: string; rollover_amount: string;
    }>(
      `SELECT loan_id, repayment_amount, savings_amount, rollover_amount
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
        savings: a.savings_amount, rollover: a.rollover_amount
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

/**
 * Manual re-allocation entry point for staff (Finance / Branch Manager).
 * Required by the §21 "Payment received but allocation failed" exception:
 * a verified payment that the engine could not apply now needs a human
 * decision. The endpoint never creates a new payment — it only moves
 * already-received money from `unallocated_payments` to a real
 * schedule row. This preserves the "no manual repayment entry" rule.
 */
export async function manuallyAllocate(
  actor: PaymentActor,
  input: {
    paymentId: string;
    loanId: string;
    repaymentAmount: string;
    savingsAmount: string;
    note: string;
  },
  meta: ActorMeta = {}
): Promise<unknown> {
  if (!input.loanId) throw AppError.unprocessable("loanId is required");
  if (!input.paymentId) throw AppError.unprocessable("paymentId is required");
  const repay = toCents(input.repaymentAmount);
  const save = toCents(input.savingsAmount);
  if (repay + save <= 0n) {
    throw AppError.unprocessable("must allocate > 0");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const p = await db.query<{ id: string; amount: string; status: string }>(
      `SELECT id, amount, status FROM payments WHERE id=$1`, [input.paymentId]
    );
    if ((p.rowCount ?? 0) === 0) throw AppError.notFound("Payment not found");
    if (p.rows[0]!.status !== "unallocated") {
      throw AppError.conflict("Payment is not in unallocated state");
    }
    await db.query(
      `INSERT INTO payment_allocations
         (company_id, payment_id, loan_id, repayment_amount, savings_amount)
       VALUES (
         (SELECT company_id FROM payments WHERE id=$1),
         $1, $2, $3, $4)`,
      [input.paymentId, input.loanId,
       fromCents(repay), fromCents(save)]
    );
    await applyToSchedule(db, input.paymentId, input.loanId, repay, save);
    if (repay > 0n) {
      await db.query(
        `UPDATE loans
            SET outstanding_principal = GREATEST(0,
              outstanding_principal - $1::numeric)
          WHERE id=$2`,
        [fromCents(repay), input.loanId]
      );
    }
    const customer = await db.query<{ customer_id: string; branch_id: string }>(
      `SELECT customer_id, branch_id FROM loans WHERE id=$1`, [input.loanId]
    );
    if (save > 0n && (customer.rowCount ?? 0) > 0) {
      const companyId = (await db.query<{ company_id: string }>(
        `SELECT company_id FROM loans WHERE id=$1`, [input.loanId]
      )).rows[0]!.company_id;
      await creditSavings(db, companyId,
        customer.rows[0]!.branch_id, customer.rows[0]!.customer_id,
        input.paymentId, save);
    }
    await db.query(
      `UPDATE payments SET status='completed' WHERE id=$1`,
      [input.paymentId]
    );
    await db.query(
      `UPDATE unallocated_payments
          SET resolved=true, resolved_by=$1, resolved_at=now(),
              resolution_note=$2
        WHERE payment_id=$3`,
      [actor.sub, input.note, input.paymentId]
    );
    await db.query(
      `UPDATE reconciliation_items
          SET status='resolved', resolved_by=$1, resolved_at=now(),
              resolution_note=$2
        WHERE payment_id=$3 AND item_type='unallocated_payment'`,
      [actor.sub, input.note, input.paymentId]
    );
    return { ok: true, paymentId: input.paymentId, loanId: input.loanId };
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
    return { added };
  });
}
