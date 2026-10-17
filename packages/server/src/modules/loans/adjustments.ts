// Write-off and restructuring - Vision RULE 10.6.3, RULE 4.4.1, RULE 20.3.2.
//
// RULE 10.6.3: "Restructuring and write-off are configured processes with their
// own approval chain; they create new records and never edit the original loan
// history."
//
// Neither process existed. `loans.status` permitted only active/overdue/
// completed, so a bad debt could be neither written off nor restructured, and
// RULE 4.4.1's MD command view could never report a written-off or restructured
// amount.
//
// The controlling design decision here is that the original loan is NEVER
// rewritten. A restructuring inserts a new `loans` row linked by
// supersedes_loan_id and marks only the original's own status; a write-off
// inserts an adjustment record and moves only the original's own status. The
// repayment schedule, payments, allocations and journal entries of the original
// are untouched, exactly as RULE 20.3.2 requires.
//
// Authority mirrors RULE 10.4.3 / 19.13.1 rather than hard-coding a role list:
// the approving role is the FINAL stage of the loan product's configured
// approval chain. That keeps the chain company data (RULE 19.12.1) instead of an
// assumption baked into the server, and it is why a Collection Officer (RULE
// 12.27 "Cannot: approve a loan") cannot write a loan off either.

import type pg from "pg";
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { toCents } from "../payments/service";

export interface AdjustmentActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface AdjustmentMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * toCents works in bigint so money never passes through a float. Converting back
 * for storage and for the JSONB before/after snapshot needs a plain decimal
 * string, which is why this exists rather than an inline `/ 100`.
 */
function centsToAmount(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}
export type AdjustmentKind = "write_off" | "restructuring";

export interface LoanAdjustmentRow {
  id: string;
  company_id: string;
  branch_id: string;
  loan_id: string;
  kind: AdjustmentKind;
  reason: string;
  approval_chain_id: string | null;
  required_approver_role_keys: string[];
  status: "requested" | "approved" | "rejected" | "posted";
  previous_state: Record<string, unknown>;
  new_state: Record<string, unknown>;
  supersedes_loan_id: string | null;
  superseding_loan_id: string | null;
  amount: number;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  posted_at: string | null;
}

interface LoanState {
  id: string;
  branch_id: string;
  status: string;
  principal_amount: string;
  outstanding_principal: string;
  cycle_days: number;
  cycle_count: number;
  interest_rate: string;
  interest_method: string | null;
  expected_repayment_per_cycle: string;
  expected_savings_per_cycle: string;
  chain_id: string;
  product_id: string;
  customer_id: string;
}

async function loadLoan(db: pg.PoolClient, actor: AdjustmentActor, loanId: string): Promise<LoanState> {
  const r = await db.query<LoanState>(
    `SELECT l.id, l.branch_id, l.status, l.principal_amount, l.outstanding_principal,
            l.cycle_days, l.cycle_count, l.interest_rate, l.interest_method,
            l.expected_repayment_per_cycle, l.expected_savings_per_cycle,
            l.product_id, l.customer_id, a.chain_id
       FROM loans l
       JOIN loan_applications a ON a.id = l.application_id
      WHERE l.id = $1`,
    [loanId]
  );
  if ((r.rowCount ?? 0) === 0) throw AppError.notFound("Loan not found");
  const loan = r.rows[0]!;
  if (actor.branchId !== null && actor.branchId !== loan.branch_id) {
    throw AppError.forbidden(
      "This loan belongs to another branch; a branch-scoped account may only adjust loans inside its own branch"
    );
  }
  return loan;
}

/**
 * Resolves the role authorised to approve a write-off or restructuring: the final
 * stage of the loan product's configured approval chain. Mirrors the
 * disbursement authority resolution so both sit at the END of company data.
 */
async function assertFinalAuthority(
  db: pg.PoolClient,
  actor: AdjustmentActor,
  chainId: string
): Promise<void> {
  const finalStage = await db.query<{ role_id: string; role_key: string }>(
    `SELECT s.role_id, r.role_key
       FROM approval_chain_steps s
       JOIN roles r ON r.id = s.role_id
      WHERE s.chain_id = $1
      ORDER BY s.stage_order DESC
      LIMIT 1`,
    [chainId]
  );
  if ((finalStage.rowCount ?? 0) === 0) {
    throw AppError.conflict(
      "This loan's approval chain has no configured stages; adjustment authority cannot be resolved"
    );
  }
  const holds = await db.query(
    `SELECT 1
       FROM role_assignments ra
      WHERE ra.user_id = $1
        AND ra.company_id = $2
        AND ra.role_id = $3
        AND ra.status = 'active'
        AND (ra.assignment_type = 'permanent'
             OR (ra.starts_at <= now() AND (ra.ends_at IS NULL OR ra.ends_at > now())))
      LIMIT 1`,
    [actor.sub, actor.companyId, finalStage.rows[0]!.role_id]
  );
  if ((holds.rowCount ?? 0) === 0) {
    throw AppError.forbidden(
      "Write-off and restructuring are reserved to the final approval authority configured on this loan's approval chain"
    );
  }
  return;
}

/**
 * RULE 14.3.1 - automated and human actions are audited identically. The
 * before/after pair on the adjustment row is the primary record; this log entry
 * is what makes the transition findable from the audit trail alone.
 */
async function audit(
  db: pg.PoolClient,
  actor: AdjustmentActor,
  action: string,
  entityId: string,
  previousValue: unknown,
  newValue: unknown,
  reason: string,
  meta: AdjustmentMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,'loans',$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
    [
      actor.companyId,
      actor.branchId,
      actor.sub,
      action,
      entityId,
      JSON.stringify(previousValue ?? null),
      JSON.stringify(newValue ?? null),
      reason,
      meta.ip ?? null,
      meta.userAgent ?? null,
      meta.requestId ?? null
    ]
  );
}

export interface RequestWriteOffInput {
  loanId: string;
  reason: string;
  /** Optional: defaults to the whole outstanding principal. */
  amount?: number;
}

export interface RequestRestructuringInput {
  loanId: string;
  reason: string;
  newCycleDays: number;
  newCycleCount: number;
  newInterestRate: number;
}

function requireReason(reason: string): string {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 5) {
    throw AppError.unprocessable("A written reason of at least 5 characters is required");
  }
  return trimmed;
}

/**
 * RULE 10.6.3 write-off. The loan's money is bad debt; the record stays on the
 * books and the loan's own status moves. Nothing else about the loan changes.
 */
export async function requestLoanWriteOff(
  actor: AdjustmentActor,
  input: RequestWriteOffInput,
  meta: AdjustmentMeta = {}
): Promise<LoanAdjustmentRow> {
  const reason = requireReason(input.reason);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const loan = await loadLoan(db, actor, input.loanId);
    if (loan.status === "completed") {
      throw AppError.conflict("A completed loan cannot be written off");
    }
    if (loan.status === "written_off") {
      throw AppError.conflict("This loan is already written off");
    }
    await assertFinalAuthority(db, actor, loan.chain_id);

    const outstanding = toCents(loan.outstanding_principal);
    const requested = input.amount === undefined ? outstanding : toCents(String(input.amount));
    if (requested <= 0) {
      throw AppError.unprocessable("The written-off amount must be greater than zero");
    }
    if (requested > outstanding) {
      throw AppError.unprocessable(
        "The written-off amount cannot exceed the loan's outstanding principal"
      );
    }

    const previousState = {
      status: loan.status,
      outstanding_principal: loan.outstanding_principal,
      written_off_amount: 0
    };
    const newState = {
      status: "written_off",
      outstanding_principal: loan.outstanding_principal,
      written_off_amount: centsToAmount(requested)
    };

    const inserted = await db.query<LoanAdjustmentRow>(
      `INSERT INTO loan_adjustments
         (company_id, branch_id, loan_id, kind, reason, approval_chain_id,
          required_approver_role_keys, previous_state, new_state, amount, requested_by)
       VALUES ($1,$2,$3,'write_off',$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)
       RETURNING *`,
      [
        actor.companyId,
        loan.branch_id,
        loan.id,
        reason,
        loan.chain_id,
        [],
        JSON.stringify(previousState),
        JSON.stringify(newState),
        centsToAmount(requested),
        actor.sub
      ]
    );
    const adjustment = inserted.rows[0]!;

    // The loan's own status is the ONLY thing on the original that moves. The
    // repayment schedule, payments and journal entries are left exactly as they
    // were, which is what "never edit the original loan history" requires.
    await db.query(`UPDATE loans SET status='written_off' WHERE id=$1`, [loan.id]);

    await audit(
      db,
      actor,
      "loan.written_off",
      loan.id,
      previousState,
      newState,
      reason,
      meta
    );
    return adjustment;
  });
}

/**
 * RULE 10.6.3 restructuring: "they create new records and never edit the original
 * loan history." The new terms live on a NEW loan row. The original keeps its
 * principal, its schedule and its payments, and is only marked restructured so
 * the pair is navigable from either side.
 */
export async function requestLoanRestructuring(
  actor: AdjustmentActor,
  input: RequestRestructuringInput,
  meta: AdjustmentMeta = {}
): Promise<LoanAdjustmentRow> {
  const reason = requireReason(input.reason);
  if (!Number.isInteger(input.newCycleDays) || input.newCycleDays <= 0) {
    throw AppError.unprocessable("newCycleDays must be a positive whole number of days");
  }
  if (!Number.isInteger(input.newCycleCount) || input.newCycleCount <= 0) {
    throw AppError.unprocessable("newCycleCount must be a positive whole number of cycles");
  }
  if (!Number.isFinite(input.newInterestRate) || input.newInterestRate < 0) {
    throw AppError.unprocessable("newInterestRate must be zero or greater");
  }

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const loan = await loadLoan(db, actor, input.loanId);
    if (loan.status === "written_off") {
      throw AppError.conflict("A written-off loan cannot be restructured");
    }
    if (loan.status === "restructured") {
      throw AppError.conflict("This loan has already been restructured");
    }
    await assertFinalAuthority(db, actor, loan.chain_id);

    const previousState = {
      status: loan.status,
      cycle_days: loan.cycle_days,
      cycle_count: loan.cycle_count,
      interest_rate: loan.interest_rate
    };
    const newState = {
      status: "restructured",
      cycle_days: input.newCycleDays,
      cycle_count: input.newCycleCount,
      interest_rate: input.newInterestRate.toFixed(4)
    };

    const inserted = await db.query<LoanAdjustmentRow>(
      `INSERT INTO loan_adjustments
         (company_id, branch_id, loan_id, kind, reason, approval_chain_id,
          required_approver_role_keys, previous_state, new_state, supersedes_loan_id, requested_by)
       VALUES ($1,$2,$3,'restructuring',$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)
       RETURNING *`,
      [
        actor.companyId,
        loan.branch_id,
        loan.id,
        reason,
        loan.chain_id,
        [],
        JSON.stringify(previousState),
        JSON.stringify(newState),
        loan.id,
        actor.sub
      ]
    );
    const adjustment = inserted.rows[0]!;

    // A rejected restructuring must leave the loan completely untouched, so the
    // new loan is not created until the request is APPROVED. This function
    // records the request; approveLoanAdjustment performs the posting.
    await audit(
      db,
      actor,
      "loan.restructuring_requested",
      loan.id,
      previousState,
      newState,
      reason,
      meta
    );
    return adjustment;
  });
}

/**
 * Approval of a restructuring: creates the NEW linked loan with the new terms
 * and only then marks the original restructured. The two writes happen in one
 * transaction so the pair can never be half-created.
 */
async function postRestructuring(
  db: pg.PoolClient,
  actor: AdjustmentActor,
  adjustment: LoanAdjustmentRow,
  newState: { cycle_days: number; cycle_count: number; interest_rate: string },
  meta: AdjustmentMeta
): Promise<void> {
  const loan = await loadLoan(db, actor, adjustment.loan_id);

  const created = await db.query<{ id: string }>(
    `INSERT INTO loans
       (company_id, branch_id, customer_id, application_id, product_id,
        principal_amount, interest_rate, interest_method, cycle_days, cycle_count,
        expected_repayment_per_cycle, expected_savings_per_cycle,
        outstanding_principal, status, disbursed_by, disbursed_at, origin_loan_id)
     SELECT company_id, branch_id, customer_id, application_id, product_id,
            principal_amount, $2, interest_method, $3, $4,
            expected_repayment_per_cycle, expected_savings_per_cycle,
            outstanding_principal, 'active', disbursed_by, now(), id
       FROM loans WHERE id = $1
     RETURNING id`,
    [loan.id, newState.interest_rate, newState.cycle_days, newState.cycle_count]
  );
  const newLoanId = created.rows[0]!.id;

  await db.query(`UPDATE loans SET status='restructured' WHERE id=$1`, [loan.id]);
  await db.query(
    `UPDATE loan_adjustments
        SET status='posted', decided_by=$2, decided_at=now(), posted_at=now(),
            superseding_loan_id=$3
      WHERE id=$1`,
    [adjustment.id, actor.sub, newLoanId]
  );
  await audit(
    db,
    actor,
    "loan.restructured",
    loan.id,
    { ...adjustment.previous_state, original_loan_id: loan.id },
    { ...newState, superseding_loan_id: newLoanId },
    adjustment.reason,
    meta
  );
  return;
}

/**
 * Rejection. A rejection never posts anything: the loan is left exactly as it
 * was and the request record is retained as the explanation.
 */
export async function decideLoanAdjustment(
  actor: AdjustmentActor,
  adjustmentId: string,
  approve: boolean,
  decisionReason: string,
  meta: AdjustmentMeta = {}
): Promise<LoanAdjustmentRow> {
  const reason = requireReason(decisionReason);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const found = await db.query<LoanAdjustmentRow>(
      `SELECT * FROM loan_adjustments WHERE id=$1`,
      [adjustmentId]
    );
    if ((found.rowCount ?? 0) === 0) throw AppError.notFound("Adjustment request not found");
    const adjustment = found.rows[0]!;
    if (actor.branchId !== null && actor.branchId !== adjustment.branch_id) {
      throw AppError.forbidden("This request belongs to another branch");
    }
    if (adjustment.status !== "requested") {
      throw AppError.conflict(`This request has already been ${adjustment.status}`);
    }

    const loan = await loadLoan(db, actor, adjustment.loan_id);
    await assertFinalAuthority(db, actor, loan.chain_id);

    if (approve && adjustment.kind === "restructuring") {
      const newState = adjustment.new_state as unknown as {
        cycle_days: number;
        cycle_count: number;
        interest_rate: string;
      };
      await postRestructuring(db, actor, adjustment, newState, meta);
    } else {
      await db.query(
        `UPDATE loan_adjustments
            SET status=$2, decided_by=$3, decided_at=now(), decision_reason=$4,
                posted_at = CASE WHEN $2='approved' THEN now() ELSE NULL END
          WHERE id=$1`,
        [adjustment.id, approve ? "approved" : "rejected", actor.sub, reason]
      );
      await audit(
        db,
        actor,
        approve ? "loan.adjustment_approved" : "loan.adjustment_rejected",
        adjustment.loan_id,
        adjustment.previous_state,
        approve ? adjustment.new_state : adjustment.previous_state,
        reason,
        meta
      );
    }

    const after = await db.query<LoanAdjustmentRow>(
      `SELECT * FROM loan_adjustments WHERE id=$1`,
      [adjustmentId]
    );
    return after.rows[0]!;
  });
}

export async function listLoanAdjustments(
  actor: AdjustmentActor,
  loanId?: string
): Promise<LoanAdjustmentRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<LoanAdjustmentRow>(
      `SELECT * FROM loan_adjustments
        WHERE ($1::uuid IS NULL OR loan_id = $1)
        ORDER BY requested_at DESC`,
      [loanId ?? null]
    );
    return r.rows;
  });
}