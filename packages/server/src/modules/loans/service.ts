// Stage 7C - Lending domain (Part 1 Section 23 - application, approval,
// disbursement) + Part 1 Section 22 disburse-on-active-customer rule.
//
// Scope of this commit:
//   - Loan product + approval chain management (CRUD + listing)
//   - Loan application lifecycle: submit / list / get / withdraw
//   - Approval / rejection (single-decision for now; multi-stage chain
//     advancement follows the same pattern in a follow-up)
//   - Disbursement: creates a `loans` row + `repayment_schedule_rows`
//     when the application is approved and the customer is `active`
//     (Part 1 Section 22: disbursement blocked while va_pending)
//
// All writes append to the tenant audit trail.
import type pg from "pg";
import { withTenant, withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";

export interface LoanActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface CreateLoanProductInput {
  name: string;
  description?: string | null;
  minPrincipal: number;
  maxPrincipal: number;
  interestRate: number;
  interestMethod?: string | null;
  cycleDays: number;
  cycleCount: number;
  expectedRepaymentPerCycle: number;
  expectedSavingsPerCycle: number;
  approvalChainId: string;
}

export interface LoanProductRow {
  id: string;
  name: string;
  description: string | null;
  min_principal: string;
  max_principal: string;
  interest_rate: string;
  interest_method: string | null;
  cycle_days: number;
  cycle_count: number;
  expected_repayment_per_cycle: string;
  expected_savings_per_cycle: string;
  approval_chain_id: string;
  is_active: boolean;
  created_at: Date;
}

export interface CreateApprovalChainInput {
  name: string;
  description?: string | null;
  onRejection?: "return_to_applicant" | "previous_stage";
  steps: { stageOrder: number; stepName: string; roleId: string }[];
}

export interface ApprovalChainRow {
  id: string;
  name: string;
  description: string | null;
  on_rejection: string;
  created_at: Date;
}

export interface CreateApplicationInput {
  customerId: string;
  productId: string;
  principalAmount: number;
}

export interface ApplicationRow {
  id: string;
  branch_id: string;
  customer_id: string;
  product_id: string;
  chain_id: string;
  principal_amount: string;
  status: string;
  current_stage_order: number | null;
  submitted_by: string;
  decided_by: string | null;
  decided_at: Date | null;
  rejection_reason: string | null;
  disbursed_at: Date | null;
  created_at: Date;
}

async function auditLoan(
  db: pg.PoolClient,
  companyId: string,
  branchId: string | null,
  actorUserId: string,
  action: string,
  entityType: "loan_products" | "approval_chains" | "loan_applications" | "loans",
  entityId: string,
  previousValue: unknown,
  newValue: unknown,
  reason: string | null,
  meta: ActorMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
    [
      companyId, branchId, actorUserId, action, entityType, entityId,
      previousValue === undefined ? null : JSON.stringify(previousValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      reason,
      meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null,
    ]
  );
}
// ============================================================
// Loan products
// ============================================================

export async function createLoanProduct(
  actor: LoanActor,
  input: CreateLoanProductInput,
  meta: ActorMeta = {}
): Promise<LoanProductRow> {
  if (!input.name || input.name.trim().length < 2) {
    throw AppError.unprocessable("name must be at least 2 characters");
  }
  if (input.minPrincipal <= 0) {
    throw AppError.unprocessable("minPrincipal must be > 0");
  }
  if (input.maxPrincipal < input.minPrincipal) {
    throw AppError.unprocessable("maxPrincipal must be >= minPrincipal");
  }
  if (input.interestRate < 0) {
    throw AppError.unprocessable("interestRate must be >= 0");
  }
  if (input.cycleDays <= 0 || input.cycleCount <= 0) {
    throw AppError.unprocessable("cycleDays and cycleCount must be > 0");
  }
  if (input.expectedRepaymentPerCycle < 0 || input.expectedSavingsPerCycle < 0) {
    throw AppError.unprocessable("expectedRepaymentPerCycle and expectedSavingsPerCycle must be >= 0");
  }

  return withTenant(actor.companyId, null, async (db) => {
    // Verify the approval chain belongs to this company.
    const ch = await db.query<{ id: string }>(
      `SELECT id FROM approval_chains WHERE id=$1 AND company_id=$2`,
      [input.approvalChainId, actor.companyId]
    );
    if ((ch.rowCount ?? 0) === 0) {
      throw AppError.notFound("Approval chain not found in this company");
    }

    const inserted = await db.query<LoanProductRow>(
      `INSERT INTO loan_products (company_id, name, description, min_principal, max_principal,
                                 interest_rate, interest_method, cycle_days, cycle_count,
                                 expected_repayment_per_cycle, expected_savings_per_cycle,
                                 approval_chain_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, name, description, min_principal, max_principal,
                 interest_rate, interest_method, cycle_days, cycle_count,
                 expected_repayment_per_cycle, expected_savings_per_cycle,
                 approval_chain_id, is_active, created_at`,
      [
        actor.companyId, input.name.trim(), input.description ?? null,
        input.minPrincipal, input.maxPrincipal, input.interestRate,
        input.interestMethod ?? null, input.cycleDays, input.cycleCount,
        input.expectedRepaymentPerCycle, input.expectedSavingsPerCycle,
        input.approvalChainId, actor.sub,
      ]
    );
    const product = inserted.rows[0]!;
    await auditLoan(
      db, actor.companyId, actor.branchId, actor.sub,
      "loan_product.created", "loan_products", product.id,
      null,
      { name: product.name, min_principal: product.min_principal,
        max_principal: product.max_principal, interest_rate: product.interest_rate,
        cycle_days: product.cycle_days, cycle_count: product.cycle_count,
        approval_chain_id: product.approval_chain_id },
      null, meta
    );
    return product;
  });
}

export async function listLoanProducts(
  actor: LoanActor,
  options: { activeOnly?: boolean } = {}
): Promise<LoanProductRow[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const where = options.activeOnly ? "WHERE is_active=true" : "";
    const r = await db.query<LoanProductRow>(
      `SELECT id, name, description, min_principal, max_principal,
              interest_rate, interest_method, cycle_days, cycle_count,
              expected_repayment_per_cycle, expected_savings_per_cycle,
              approval_chain_id, is_active, created_at
         FROM loan_products ${where}
        ORDER BY name`,
      []
    );
    return r.rows;
  });
}

// ============================================================
// Approval chains
// ============================================================

export async function createApprovalChain(
  actor: LoanActor,
  input: CreateApprovalChainInput,
  meta: ActorMeta = {}
): Promise<ApprovalChainRow> {
  if (!input.name || input.name.trim().length < 2) {
    throw AppError.unprocessable("name must be at least 2 characters");
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw AppError.unprocessable("At least one approval step is required");
  }
  // Validate stage orders are unique and positive.
  const orders = input.steps.map((s) => s.stageOrder);
  if (orders.some((o) => o <= 0)) {
    throw AppError.unprocessable("stageOrder must be > 0");
  }
  if (new Set(orders).size !== orders.length) {
    throw AppError.unprocessable("stageOrder values must be unique");
  }
  // Validate all role IDs belong to this company.
  return withTenant(actor.companyId, null, async (db) => {
    for (const step of input.steps) {
      const r = await db.query<{ id: string }>(
        `SELECT id FROM roles WHERE id=$1 AND company_id=$2`,
        [step.roleId, actor.companyId]
      );
      if ((r.rowCount ?? 0) === 0) {
        throw AppError.unprocessable(`Role not found in this company: ${step.roleId}`);
      }
    }

    const onRejection = input.onRejection ?? "return_to_applicant";

    const chain = await db.query<ApprovalChainRow>(
      `INSERT INTO approval_chains (company_id, name, description, on_rejection, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, description, on_rejection, created_at`,
      [actor.companyId, input.name.trim(), input.description ?? null, onRejection, actor.sub]
    );
    const chainRow = chain.rows[0]!;

    for (const step of input.steps) {
      await db.query(
        `INSERT INTO approval_chain_steps (company_id, chain_id, stage_order, step_name, role_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [actor.companyId, chainRow.id, step.stageOrder, step.stepName, step.roleId]
      );
    }

    await auditLoan(
      db, actor.companyId, actor.branchId, actor.sub,
      "approval_chain.created", "approval_chains", chainRow.id,
      null,
      { name: chainRow.name, steps: input.steps.length, on_rejection: onRejection },
      null, meta
    );
    return chainRow;
  });
}

export async function listApprovalChains(
  actor: LoanActor
): Promise<ApprovalChainRow[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const r = await db.query<ApprovalChainRow>(
      `SELECT id, name, description, on_rejection, created_at
         FROM approval_chains ORDER BY name`,
      []
    );
    return r.rows;
  });
}

export interface ApprovalChainStepRow {
  id: string;
  stage_order: number;
  step_name: string;
  role_id: string;
}

export async function getApprovalChainSteps(
  actor: LoanActor,
  chainId: string
): Promise<ApprovalChainStepRow[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const r = await db.query<ApprovalChainStepRow>(
      `SELECT id, stage_order, step_name, role_id
         FROM approval_chain_steps
        WHERE chain_id=$1
        ORDER BY stage_order`,
      [chainId]
    );
    return r.rows;
  });
}

// ============================================================
// Loan applications
// ============================================================

export async function createApplication(
  actor: LoanActor,
  input: CreateApplicationInput,
  meta: ActorMeta = {}
): Promise<ApplicationRow> {
  if (!input.customerId) throw AppError.unprocessable("customerId is required");
  if (!input.productId) throw AppError.unprocessable("productId is required");
  if (input.principalAmount <= 0) {
    throw AppError.unprocessable("principalAmount must be > 0");
  }

  return withTenant(actor.companyId, null, async (db) => {
    const cust = await db.query<{ id: string; branch_id: string; status: string }>(
      `SELECT id, branch_id, status FROM customers WHERE id=$1`,
      [input.customerId]
    );
    if ((cust.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const customer = cust.rows[0]!;

    if (actor.branchId !== null && actor.branchId !== customer.branch_id) {
      throw AppError.forbidden(
        "A branch-scoped session cannot submit an application for a customer in a different branch"
      );
    }

    const product = await db.query<{
      id: string;
      min_principal: string;
      max_principal: string;
      approval_chain_id: string;
      is_active: boolean;
    }>(
      `SELECT id, min_principal, max_principal, approval_chain_id, is_active
         FROM loan_products WHERE id=$1`,
      [input.productId]
    );
    if ((product.rowCount ?? 0) === 0) throw AppError.notFound("Loan product not found");
    const p = product.rows[0]!;
    if (!p.is_active) throw AppError.unprocessable("Loan product is not active");
    if (input.principalAmount < Number(p.min_principal) ||
        input.principalAmount > Number(p.max_principal)) {
      throw AppError.unprocessable(
        `principalAmount must be between ${p.min_principal} and ${p.max_principal}`
      );
    }

    const firstStage = await db.query<{ stage_order: number }>(
      `SELECT MIN(stage_order) AS stage_order FROM approval_chain_steps WHERE chain_id=$1`,
      [p.approval_chain_id]
    );
    const currentStage = firstStage.rows[0]?.stage_order ?? null;

    const inserted = await db.query<ApplicationRow>(
      `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                     principal_amount, status, current_stage_order, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,'in_review',$7,$8)
       RETURNING id, branch_id, customer_id, product_id, chain_id, principal_amount,
                 status, current_stage_order, submitted_by, decided_by, decided_at,
                 rejection_reason, disbursed_at, created_at`,
      [
        actor.companyId, customer.branch_id, customer.id, p.id, p.approval_chain_id,
        input.principalAmount, currentStage, actor.sub,
      ]
    );
    const appRow = inserted.rows[0]!;
    await auditLoan(
      db, actor.companyId, customer.branch_id, actor.sub,
      "loan_application.submitted", "loan_applications", appRow.id,
      null,
      { customer_id: customer.id, product_id: p.id,
        principal_amount: appRow.principal_amount, status: "in_review",
        current_stage_order: currentStage },
      null, meta
    );
    return appRow;
  });
}

export async function getApplication(
  actor: LoanActor,
  applicationId: string
): Promise<ApplicationRow> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    if ((r.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    return r.rows[0]!;
  });
}

export interface ListApplicationsInput {
  status?: string | null;
  customerId?: string | null;
  limit?: number;
  offset?: number;
}

export async function listApplications(
  actor: LoanActor,
  input: ListApplicationsInput = {}
): Promise<{ items: ApplicationRow[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.status) {
      const allowed = ["submitted", "in_review", "approved", "rejected", "disbursed", "withdrawn"];
      if (!allowed.includes(input.status)) throw AppError.unprocessable("invalid status");
      params.push(input.status);
      conditions.push(`status=$${params.length}`);
    }
    if (input.customerId) {
      params.push(input.customerId);
      conditions.push(`customer_id=$${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalRow = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM loan_applications ${where}`,
      params
    );
    params.push(limit);
    params.push(offset);
    const items = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: parseInt(totalRow.rows[0]?.count ?? "0", 10) };
  });
}

export async function withdrawApplication(
  actor: LoanActor,
  applicationId: string,
  reason: string,
  meta: ActorMeta = {}
): Promise<ApplicationRow> {
  if (!reason || reason.trim().length === 0) {
    throw AppError.unprocessable("reason is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const existing = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications WHERE id=$1 FOR UPDATE`,
      [applicationId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const prev = existing.rows[0]!;
    if (!["submitted", "in_review"].includes(prev.status)) {
      throw AppError.conflict(`Cannot withdraw an application in status '${prev.status}'`);
    }
    if (actor.sub !== prev.submitted_by) {
      throw AppError.forbidden("Only the applicant can withdraw their own application");
    }
    const updated = await db.query<ApplicationRow>(
      `UPDATE loan_applications SET status='withdrawn' WHERE id=$1
        RETURNING id, branch_id, customer_id, product_id, chain_id, principal_amount,
                  status, current_stage_order, submitted_by, decided_by, decided_at,
                  rejection_reason, disbursed_at, created_at`,
      [applicationId]
    );
    const next = updated.rows[0]!;
    await auditLoan(
      db, actor.companyId, next.branch_id, actor.sub,
      "loan_application.withdrawn", "loan_applications", applicationId,
      { status: prev.status }, { status: "withdrawn" },
      reason, meta
    );
    return next;
  });
}

// ============================================================
// Application decision + disbursement
// ============================================================

export interface DecideApplicationInput {
  applicationId: string;
  decision: "approve" | "reject";
  reason: string;
}

/**
 * Single-decision approve/reject. For a multi-stage chain, an
 * authorized role at the current stage_order may approve; this moves
 * the application to either the next stage_order (in_review) or
 * 'approved' if the current stage was the last. Reject is terminal.
 * Permission check: caller must hold a role whose role_id is bound to
 * the current stage_order's role_id (verified via the join to
 * approval_chain_steps).
 */
export async function decideApplication(
  actor: LoanActor,
  input: DecideApplicationInput,
  meta: ActorMeta = {}
): Promise<ApplicationRow> {
  if (!["approve", "reject"].includes(input.decision)) {
    throw AppError.unprocessable(`unknown decision: ${input.decision}`);
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw AppError.unprocessable("reason is required");
  }

  return withTenant(actor.companyId, null, async (db) => {
    const existing = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications WHERE id=$1 FOR UPDATE`,
      [input.applicationId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const prev = existing.rows[0]!;
    if (prev.status !== "in_review" && prev.status !== "submitted") {
      throw AppError.conflict(`Cannot decide an application in status '${prev.status}'`);
    }

    // Authorize: caller must hold a role that maps to the current stage.
    // The simplest check: the caller's role_assignments must include
    // a role that matches approval_chain_steps.role_id for chain_id,
    // stage_order=current_stage_order.
    if (prev.current_stage_order === null) {
      throw AppError.conflict("Application has no current stage to decide");
    }
    const auth = await db.query<{ id: string }>(
      `SELECT DISTINCT ra.id
         FROM role_assignments ra
         JOIN approval_chain_steps acs
              ON acs.chain_id = $1 AND acs.stage_order = $2
              AND acs.role_id = ra.role_id
        WHERE ra.user_id = $3
          AND ra.company_id = $4
          AND ra.status = 'active'
          AND (ra.assignment_type = 'permanent'
               OR (ra.starts_at <= now() AND (ra.ends_at IS NULL OR ra.ends_at > now())))`,
      [prev.chain_id, prev.current_stage_order, actor.sub, actor.companyId]
    );
    if ((auth.rowCount ?? 0) === 0) {
      throw AppError.forbidden(
        "You do not hold the role required to decide this application at its current stage"
      );
    }

    let nextStatus: string;
    let nextStage: number | null = prev.current_stage_order;
    if (input.decision === "reject") {
      nextStatus = "rejected";
      nextStage = null;
    } else {
      // Find the next stage; if none, mark 'approved'.
      const next = await db.query<{ stage_order: number }>(
        `SELECT MIN(stage_order) AS stage_order FROM approval_chain_steps
          WHERE chain_id=$1 AND stage_order > $2`,
        [prev.chain_id, prev.current_stage_order]
      );
      const ns = next.rows[0]?.stage_order ?? null;
      if (ns === null) {
        nextStatus = "approved";
        nextStage = null;
      } else {
        nextStatus = "in_review";
        nextStage = ns;
      }
    }

    const updated = await db.query<ApplicationRow>(
      `UPDATE loan_applications
          SET status=$2, current_stage_order=$3, decided_by=$4, decided_at=now(),
              rejection_reason=CASE WHEN $2='rejected' THEN $5 ELSE NULL END
        WHERE id=$1
        RETURNING id, branch_id, customer_id, product_id, chain_id, principal_amount,
                  status, current_stage_order, submitted_by, decided_by, decided_at,
                  rejection_reason, disbursed_at, created_at`,
      [input.applicationId, nextStatus, nextStage, actor.sub, input.reason]
    );
    const nextRow = updated.rows[0]!;
    await auditLoan(
      db, actor.companyId, nextRow.branch_id, actor.sub,
      `loan_application.${input.decision === "approve" ? "stage_approved" : "rejected"}`,
      "loan_applications", input.applicationId,
      { status: prev.status, current_stage_order: prev.current_stage_order },
      { status: nextRow.status, current_stage_order: nextRow.current_stage_order },
      input.reason, meta
    );
    return nextRow;
  });
}

export interface LoanRow {
  id: string;
  branch_id: string;
  customer_id: string;
  application_id: string;
  product_id: string;
  principal_amount: string;
  interest_rate: string;
  cycle_days: number;
  cycle_count: number;
  expected_repayment_per_cycle: string;
  expected_savings_per_cycle: string;
  outstanding_principal: string;
  status: string;
  disbursed_by: string;
  disbursed_at: Date;
  completed_at: Date | null;
}

export interface ScheduleRow {
  id: string;
  loan_id: string;
  cycle_number: number;
  due_date: string;
  expected_repayment: string;
  expected_savings: string;
  actual_repayment: string;
  actual_savings: string;
  paid_at: Date | null;
}

export interface DisburseInput {
  applicationId: string;
  reason?: string | null;
}

/**
 * Disburse an approved application:
 *  - Part 1 Section 22: customer must be `active` (not va_pending) at
 *    disbursement time. Disbursement is blocked while va_pending.
 *  - Creates a `loans` row + `repayment_schedule_rows` (one row per cycle,
 *    spaced `cycle_days` apart from the disbursement date).
 *  - Flips the application to 'disbursed' with `disbursed_at = now()`.
 */
export async function disburse(
  actor: LoanActor,
  input: DisburseInput,
  meta: ActorMeta = {}
): Promise<{ loan: LoanRow; schedule: ScheduleRow[] }> {
  return withTenant(actor.companyId, null, async (db) => {
    const existing = await db.query<ApplicationRow>(
      `SELECT id, branch_id, customer_id, product_id, chain_id, principal_amount,
              status, current_stage_order, submitted_by, decided_by, decided_at,
              rejection_reason, disbursed_at, created_at
         FROM loan_applications WHERE id=$1 FOR UPDATE`,
      [input.applicationId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const app = existing.rows[0]!;
    if (app.status !== "approved") {
      throw AppError.conflict(`Cannot disburse an application in status '${app.status}'`);
    }
    if (app.disbursed_at !== null) {
      throw AppError.conflict("Application is already disbursed");
    }

    const cust = await db.query<{ status: string }>(
      `SELECT status FROM customers WHERE id=$1`,
      [app.customer_id]
    );
    if ((cust.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    if (cust.rows[0]!.status !== "active") {
      throw AppError.conflict(
        `Disbursement is blocked while the customer status is '${cust.rows[0]!.status}'; ` +
        `customer must be 'active' (Part 1 Section 22)`
      );
    }

    const product = await db.query<{
      id: string;
      interest_rate: string;
      interest_method: string | null;
      cycle_days: number;
      cycle_count: number;
      expected_repayment_per_cycle: string;
      expected_savings_per_cycle: string;
    }>(
      `SELECT id, interest_rate, interest_method, cycle_days, cycle_count,
              expected_repayment_per_cycle, expected_savings_per_cycle
         FROM loan_products WHERE id=$1`,
      [app.product_id]
    );
    if ((product.rowCount ?? 0) === 0) throw AppError.notFound("Loan product not found");
    const p = product.rows[0]!;

    const loanInserted = await db.query<LoanRow>(
      `INSERT INTO loans (company_id, branch_id, customer_id, application_id, product_id,
                          principal_amount, interest_rate, interest_method, cycle_days,
                          cycle_count, expected_repayment_per_cycle,
                          expected_savings_per_cycle, outstanding_principal, status,
                          disbursed_by, disbursed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14, now())
       RETURNING id, branch_id, customer_id, application_id, product_id,
                 principal_amount, interest_rate, cycle_days, cycle_count,
                 expected_repayment_per_cycle, expected_savings_per_cycle,
                 outstanding_principal, status, disbursed_by, disbursed_at, completed_at`,
      [
        actor.companyId, app.branch_id, app.customer_id, app.id, app.product_id,
        app.principal_amount, p.interest_rate, p.interest_method, p.cycle_days,
        p.cycle_count, p.expected_repayment_per_cycle, p.expected_savings_per_cycle,
        app.principal_amount, actor.sub,
      ]
    );
    const loan = loanInserted.rows[0]!;

    const schedule: ScheduleRow[] = [];
    for (let cycle = 1; cycle <= p.cycle_count; cycle++) {
      const due = new Date(Date.now() + cycle * p.cycle_days * 24 * 60 * 60 * 1000);
      const dueDate = due.toISOString().slice(0, 10);
      const row = await db.query<ScheduleRow>(
        `INSERT INTO repayment_schedule_rows (company_id, loan_id, cycle_number, due_date,
                                              expected_repayment, expected_savings)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, loan_id, cycle_number, due_date, expected_repayment,
                   expected_savings, actual_repayment, actual_savings, paid_at`,
        [
          actor.companyId, loan.id, cycle, dueDate,
          p.expected_repayment_per_cycle, p.expected_savings_per_cycle,
        ]
      );
      schedule.push(row.rows[0]!);
    }

    await db.query(
      `UPDATE loan_applications SET status='disbursed', disbursed_at=now() WHERE id=$1`,
      [app.id]
    );

    await auditLoan(
      db, actor.companyId, app.branch_id, actor.sub,
      "loan.disbursed", "loans", loan.id,
      { application_id: app.id, status: "approved" },
      { principal_amount: loan.principal_amount, schedule_rows: schedule.length,
        outstanding_principal: loan.outstanding_principal },
      input.reason ?? null, meta
    );
    return { loan, schedule };
  });
}

export interface PlatformLoanRow {
  id: string;
  applicationId: string;
  branchCode: string;
  customerCode: string;
  principalAmount: string;
  outstandingPrincipal: string;
  status: string;
  disbursedAt: Date;
}

export async function listPlatformLoansForCompany(
  companyId: string
): Promise<PlatformLoanRow[]> {
  return withBypass(async (db) => {
    const r = await db.query<PlatformLoanRow>(
      `SELECT l.id, l.application_id, b.code AS branch_code,
              c.customer_code, l.principal_amount, l.outstanding_principal,
              l.status, l.disbursed_at
         FROM loans l
         JOIN branches b ON b.id = l.branch_id
         JOIN customers c ON c.id = l.customer_id
        WHERE l.company_id=$1
        ORDER BY l.disbursed_at DESC
        LIMIT 500`,
      [companyId]
    );
    return r.rows;
  });
}
