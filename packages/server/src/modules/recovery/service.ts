import { randomUUID } from "node:crypto";
import type pg from "pg";
import { withTenant } from "../../db/repo";
import { verifyEvidenceObject } from "../../lib/evidence-storage";
import { AppError } from "../../lib/errors";
import { notifyAuditors } from "../notifications/service";

export interface RecoveryActor {
  userId: string;
  companyId: string;
  branchId: string | null;
  meta?: { ip?: string | null; userAgent?: string | null; requestId?: string | null };
}

export interface RecoveryException {
  check: string;
  rowCount: number;
  sample: unknown[];
}

export interface RecoveryCheckResult {
  runId: string;
  checkType: "referential_integrity" | "evidence_hash_verification" | "restore_verification" | "payment_reconciliation";
  status: "passed" | "exceptions_found";
  checkedRowCount: number;
  exceptionsFound: number;
  exceptions: RecoveryException[];
  detail: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
}

interface CheckDefinition {
  name: string;
  sql: string;
}

const REFERENTIAL_CHECKS: CheckDefinition[] = [
  {
    name: "loan_applications_missing_customer",
    sql: `SELECT a.id FROM loan_applications a
            LEFT JOIN customers c ON c.id = a.customer_id
           WHERE c.id IS NULL LIMIT 50`
  },
  {
    name: "loan_applications_missing_product",
    sql: `SELECT a.id FROM loan_applications a
            LEFT JOIN loan_products p ON p.id = a.product_id
           WHERE p.id IS NULL LIMIT 50`
  },
  {
    name: "loan_applications_missing_chain",
    sql: `SELECT a.id FROM loan_applications a
            LEFT JOIN approval_chains c ON c.id = a.chain_id
           WHERE c.id IS NULL LIMIT 50`
  },
  {
    name: "loans_missing_application",
    sql: `SELECT l.id FROM loans l
            LEFT JOIN loan_applications a ON a.id = l.application_id
           WHERE a.id IS NULL LIMIT 50`
  },
  {
    name: "loans_missing_customer",
    sql: `SELECT l.id FROM loans l
            LEFT JOIN customers c ON c.id = l.customer_id
           WHERE c.id IS NULL LIMIT 50`
  },
  {
    name: "loans_missing_product",
    sql: `SELECT l.id FROM loans l
            LEFT JOIN loan_products p ON p.id = l.product_id
           WHERE p.id IS NULL LIMIT 50`
  },
  {
    name: "schedule_rows_missing_loan",
    sql: `SELECT s.id FROM repayment_schedule_rows s
            LEFT JOIN loans l ON l.id = s.loan_id
           WHERE l.id IS NULL LIMIT 50`
  },
  {
    name: "payment_allocations_missing_schedule_row",
    sql: `SELECT pa.id FROM payment_allocations pa
            LEFT JOIN repayment_schedule_rows s ON s.id = pa.schedule_row_id
           WHERE pa.schedule_row_id IS NOT NULL AND s.id IS NULL LIMIT 50`
  },
  {
    name: "payment_allocations_missing_loan",
    sql: `SELECT pa.id FROM payment_allocations pa
            LEFT JOIN loans l ON l.id = pa.loan_id
           WHERE pa.loan_id IS NOT NULL AND l.id IS NULL LIMIT 50`
  },
  {
    name: "payment_allocations_missing_payment",
    sql: `SELECT pa.id FROM payment_allocations pa
            LEFT JOIN payments p ON p.id = pa.payment_id
           WHERE p.id IS NULL LIMIT 50`
  },
  {
    name: "savings_transactions_missing_account",
    sql: `SELECT t.id FROM savings_transactions t
            LEFT JOIN savings_accounts a ON a.id = t.savings_account_id
           WHERE a.id IS NULL LIMIT 50`
  },
  {
    name: "loan_application_evidence_missing_application",
    sql: `SELECT e.id FROM loan_application_evidence e
            LEFT JOIN loan_applications a ON a.id = e.loan_application_id
           WHERE a.id IS NULL LIMIT 50`
  },
  {
    name: "loan_application_evidence_missing_customer",
    sql: `SELECT e.id FROM loan_application_evidence e
            LEFT JOIN customers c ON c.id = e.customer_id
           WHERE c.id IS NULL LIMIT 50`
  },
  {
    name: "face_captures_missing_customer",
    sql: `SELECT f.id FROM face_captures f
            LEFT JOIN customers c ON c.id = f.customer_id
           WHERE c.id IS NULL LIMIT 50`
  },
  {
    name: "bank_details_missing_application",
    sql: `SELECT b.application_id FROM loan_application_bank_details b
            LEFT JOIN loan_applications a ON a.id = b.application_id
           WHERE a.id IS NULL LIMIT 50`
  },
  {
    name: "loan_application_terms_missing_application",
    sql: `SELECT t.application_id FROM loan_application_terms t
            LEFT JOIN loan_applications a ON a.id = t.application_id
           WHERE a.id IS NULL LIMIT 50`
  },
  {
    name: "loan_application_fees_missing_application",
    sql: `SELECT f.id FROM loan_application_fees f
            LEFT JOIN loan_applications a ON a.id = f.application_id
           WHERE a.id IS NULL LIMIT 50`
  },
  {
    name: "pending_uploads_missing_application",
    sql: `SELECT p.id FROM pending_evidence_uploads p
            LEFT JOIN loan_applications a ON a.id = p.loan_application_id
           WHERE a.id IS NULL LIMIT 50`
  },
  {
    name: "schedule_rows_without_application_terms",
    sql: `SELECT s.id FROM repayment_schedule_rows s
            JOIN loans l ON l.id = s.loan_id
            LEFT JOIN loan_application_terms t ON t.application_id = l.application_id
           WHERE t.application_id IS NULL LIMIT 50`
  },
  {
    // A NOT TALLY record is a real integrity exception. Remediation may fill a
    // missing terms row, but it may never make a schedule that does not add up
    // read as matched, so the un-tallied state stays visible here.
    name: "application_terms_not_tally",
    sql: `SELECT t.application_id FROM loan_application_terms t
           WHERE t.tally_status <> 'matched' LIMIT 50`
  }
];

async function recordRun(
  db: pg.PoolClient,
  actor: RecoveryActor,
  input: Omit<RecoveryCheckResult, "runId" | "completedAt">
): Promise<RecoveryCheckResult> {
  const runId = randomUUID();
  const completedAt = new Date().toISOString();
  await db.query(
    `INSERT INTO recovery_check_runs
       (id, company_id, check_type, status, exceptions_found, detail,
        checked_row_count, requested_by, started_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      runId,
      actor.companyId,
      input.checkType,
      input.status,
      input.exceptionsFound,
      JSON.stringify(input.detail),
      input.checkedRowCount,
      actor.userId,
      input.startedAt,
      completedAt
    ]
  );
  return { runId, ...input, completedAt };
}

/**
 * RULE 20.5.3 — a restore drill has to prove that every record type the system
 * relies on actually came back and is internally consistent. Counting rows is
 * not proof, so each type is verified against the relationship that must hold
 * after a restore, and any failure is an explicit exception.
 */
const RESTORE_VERIFICATION_CHECKS: CheckDefinition[] = [
  {
    // A check returns rows only when something is wrong, so the company check
    // asks whether the restored company row is actually usable.
    name: "companies_restored",
    sql: `SELECT c.id FROM companies c
           WHERE c.id = app_current_company()
             AND (c.slug IS NULL OR c.slug = '' OR c.name IS NULL OR c.name = '')
           LIMIT 50`
  },
  {
    name: "branches_without_company",
    sql: `SELECT b.id FROM branches b
            LEFT JOIN companies c ON c.id = b.company_id
           WHERE b.company_id = app_current_company() AND c.id IS NULL LIMIT 50`
  },
  {
    name: "customers_without_branch",
    sql: `SELECT c.id FROM customers c
            LEFT JOIN branches b ON b.id = c.branch_id
           WHERE c.company_id = app_current_company() AND b.id IS NULL LIMIT 50`
  },
  {
    name: "groups_without_branch",
    sql: `SELECT g.id FROM groups g
            LEFT JOIN branches b ON b.id = g.branch_id
           WHERE g.company_id = app_current_company() AND b.id IS NULL LIMIT 50`
  },
  {
    name: "group_members_without_group",
    sql: `SELECT m.customer_id AS customer_id FROM group_members m
            LEFT JOIN groups g ON g.id = m.group_id
           WHERE m.company_id = app_current_company() AND g.id IS NULL LIMIT 50`
  },
  {
    name: "loans_without_customer",
    sql: `SELECT l.id FROM loans l
            LEFT JOIN customers c ON c.id = l.customer_id
           WHERE l.company_id = app_current_company() AND c.id IS NULL LIMIT 50`
  },
  {
    name: "loan_cycles_without_schedule",
    sql: `SELECT l.id FROM loans l
            LEFT JOIN repayment_schedule_rows s ON s.loan_id = l.id
           WHERE l.company_id = app_current_company() AND s.id IS NULL LIMIT 50`
  },
  {
    name: "schedules_without_loan",
    sql: `SELECT s.id FROM repayment_schedule_rows s
            LEFT JOIN loans l ON l.id = s.loan_id
           WHERE s.company_id = app_current_company() AND l.id IS NULL LIMIT 50`
  },
  {
    name: "payments_without_customer",
    sql: `SELECT p.id FROM payments p
            LEFT JOIN customers c ON c.id = p.customer_id
           WHERE p.company_id = app_current_company() AND c.id IS NULL LIMIT 50`
  },
  {
    name: "allocations_without_payment",
    sql: `SELECT a.id FROM payment_allocations a
            LEFT JOIN payments p ON p.id = a.payment_id
           WHERE p.company_id = app_current_company() AND p.id IS NULL LIMIT 50`
  },
  {
    name: "savings_accounts_without_customer",
    sql: `SELECT s.id FROM savings_accounts s
            LEFT JOIN customers c ON c.id = s.customer_id
           WHERE s.company_id = app_current_company() AND c.id IS NULL LIMIT 50`
  },
  {
    name: "savings_transactions_without_account",
    sql: `SELECT t.id FROM savings_transactions t
            LEFT JOIN savings_accounts a ON a.id = t.savings_account_id
           WHERE a.company_id = app_current_company() AND a.id IS NULL LIMIT 50`
  },
  {
    name: "accounting_entries_without_payment",
    sql: `SELECT e.id FROM journal_entries e
            LEFT JOIN payments p ON p.id = e.payment_id
           WHERE e.company_id = app_current_company()
             AND e.payment_id IS NOT NULL AND p.id IS NULL LIMIT 50`
  },
  {
    name: "approval_chain_steps_without_chain",
    sql: `SELECT s.id FROM approval_chain_steps s
            LEFT JOIN approval_chains c ON c.id = s.chain_id
           WHERE s.company_id = app_current_company() AND c.id IS NULL LIMIT 50`
  },
  {
    name: "applications_decided_by_unknown_user",
    sql: `SELECT a.id FROM loan_applications a
            LEFT JOIN users u ON u.id = a.decided_by
           WHERE a.company_id = app_current_company()
             AND a.decided_by IS NOT NULL AND u.id IS NULL LIMIT 50`
  },
  {
    name: "stage_checkpoints_without_application",
    sql: `SELECT s.id FROM loan_application_stages s
            LEFT JOIN loan_applications a ON a.id = s.application_id
           WHERE s.company_id = app_current_company() AND a.id IS NULL LIMIT 50`
  },
  {
    name: "audit_records_without_actor",
    sql: `SELECT l.id FROM audit_logs l
            LEFT JOIN users u ON u.id = l.actor_user_id
           WHERE l.company_id = app_current_company() AND l.actor_user_id IS NOT NULL AND u.id IS NULL
           LIMIT 50`
  },
  {
    name: "provider_transactions_without_provider_config",
    sql: `SELECT p.id FROM payments p
            LEFT JOIN payment_provider_configs c
              ON c.company_id = p.company_id AND c.provider = p.provider
           WHERE p.company_id = app_current_company()
             AND p.status = 'verified' AND c.id IS NULL LIMIT 50`
  },
  {
    name: "evidence_without_storage_object",
    sql: `SELECT e.id FROM loan_application_evidence e
           WHERE e.company_id = app_current_company()
             AND (e.storage_object_ref IS NULL OR e.storage_object_ref = '') LIMIT 50`
  },
  {
    name: "evidence_without_hash",
    sql: `SELECT e.id FROM loan_application_evidence e
           WHERE e.company_id = app_current_company()
             AND (e.image_sha256 IS NULL OR e.image_sha256 = '') LIMIT 50`
  }
];

/**
 * RULE 20.5.1 / 20.5.2 / 20.5.3 / 20.5.4 — a post-restore drill. The RPO and
 * RTO are engineering acceptance criteria declared by configuration, and the
 * record types plus evidence integrity are verified here so an environment is
 * only declared recovered on evidence rather than on hope.
 */
export async function runRestoreVerification(
  actor: RecoveryActor,
  options: { rpoMinutes?: number; rtoMinutes?: number; evidenceLimit?: number } = {}
): Promise<RecoveryCheckResult> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  const rpoMinutes = options.rpoMinutes ?? Number(process.env.NEXORA_RPO_MINUTES ?? 15);
  const rtoMinutes = options.rtoMinutes ?? Number(process.env.NEXORA_RTO_MINUTES ?? 240);
  if (!Number.isFinite(rpoMinutes) || rpoMinutes <= 0 || !Number.isFinite(rtoMinutes) || rtoMinutes <= 0) {
    throw AppError.unprocessable("RPO and RTO must be positive minutes");
  }
  const startedAt = new Date().toISOString();
  const evidenceLimit = Math.min(Math.max(options.evidenceLimit ?? 500, 1), 5000);

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const exceptions: RecoveryException[] = [];
    const verifiedTypes: string[] = [];
    let checkedRowCount = 0;
    for (const check of RESTORE_VERIFICATION_CHECKS) {
      const result = await db.query<Record<string, unknown>>(check.sql);
      checkedRowCount += result.rowCount ?? 0;
      if ((result.rowCount ?? 0) > 0) {
        exceptions.push({ check: check.name, rowCount: result.rowCount ?? 0, sample: result.rows });
      } else {
        verifiedTypes.push(check.name);
      }
    }

    // RULE 20.5.4 - evidence integrity is verified during recovery, so a
    // corrupted or mismatched object is detected rather than accepted.
    const evidence = await runEvidenceHashVerification(actor, { limit: evidenceLimit });
    const evidenceExceptions = evidence.exceptions.filter(
      (e) => e.check === "evidence_object_hash_mismatch"
    );
    exceptions.push(...evidenceExceptions);
    checkedRowCount += evidence.checkedRowCount;

    const status = exceptions.length === 0 ? "passed" : "exceptions_found";
    return recordRun(db, actor, {
      checkType: "restore_verification",
      status,
      checkedRowCount,
      exceptionsFound: exceptions.length,
      exceptions,
      detail: {
        rpoMinutes,
        rtoMinutes,
        recordTypesVerified: verifiedTypes,
        recordTypesRequired: RESTORE_VERIFICATION_CHECKS.map((c) => c.name),
        evidenceObjectsChecked: evidence.checkedRowCount,
        evidenceExceptions: evidenceExceptions.length
      },
      startedAt
    });
  });
}

export async function runReferentialIntegrityCheck(actor: RecoveryActor): Promise<RecoveryCheckResult> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  const startedAt = new Date().toISOString();
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const exceptions: RecoveryException[] = [];
    let checkedRowCount = 0;
    for (const check of REFERENTIAL_CHECKS) {
      const result = await db.query<Record<string, unknown>>(check.sql);
      checkedRowCount += result.rowCount ?? 0;
      if ((result.rowCount ?? 0) > 0) {
        exceptions.push({ check: check.name, rowCount: result.rowCount ?? 0, sample: result.rows });
      }
    }
    const status = exceptions.length === 0 ? "passed" : "exceptions_found";
    const run = await recordRun(db, actor, {
      checkType: "referential_integrity",
      status,
      checkedRowCount,
      exceptionsFound: exceptions.length,
      exceptions,
      detail: { checksRun: REFERENTIAL_CHECKS.length },
      startedAt
    });
    await notifyAuditorsOfInconsistency(db, actor, run.runId, "referential_integrity", exceptions);
    return run;
  });
}

export async function runEvidenceHashVerification(
  actor: RecoveryActor,
  options: { limit?: number } = {}
): Promise<RecoveryCheckResult> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000);
  const startedAt = new Date().toISOString();
  const exceptions: RecoveryException[] = [];
  let checkedRowCount = 0;

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const { rows } = await db.query<{
      id: string;
      source_table: string;
      storage_object_ref: string;
      image_sha256: string;
      file_size_bytes: number;
    }>(
      `SELECT id, 'loan_application_evidence' AS source_table, storage_object_ref,
              image_sha256, file_size_bytes
         FROM loan_application_evidence
        WHERE storage_object_ref IS NOT NULL
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    );

    for (const row of rows) {
      checkedRowCount += 1;
      const result = await verifyEvidenceObject(
        row.storage_object_ref,
        row.image_sha256,
        Number(row.file_size_bytes)
      );
      if (!result.valid) {
        exceptions.push({
          check: "evidence_object_hash_mismatch",
          rowCount: 1,
          sample: [
            {
              evidenceId: row.id,
              storageObjectRef: row.storage_object_ref,
              error: result.error,
              expectedSha256: row.image_sha256,
              actualSha256: result.actualSha256
            }
          ]
        });
      }
    }

    const status = exceptions.length === 0 ? "passed" : "exceptions_found";
    return recordRun(db, actor, {
      checkType: "evidence_hash_verification",
      status,
      checkedRowCount,
      exceptionsFound: exceptions.length,
      exceptions,
      detail: { limit },
      startedAt
    });
  });
}

export interface TermsRemediationResult {
  applicationId: string;
  repaymentMode: "weekly" | "daily";
  repaymentWeekday: number | null;
  repaymentPeriods: number;
  interestPercentage: string;
  repaymentAmount: string;
  calculatedInterest: string;
  calculatedTotalRepayment: string;
  /** What the recorded schedule actually adds up to. */
  recordedTotalRepayment: string;
  tallyStatus: "matched" | "not_tally";
}

export async function remediateApplicationTerms(
  actor: RecoveryActor,
  input: { applicationId: string; reason: string }
): Promise<TermsRemediationResult> {
  if (!input.reason || input.reason.trim().length < 10) {
    throw AppError.unprocessable("A remediation reason of at least 10 characters is required");
  }
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const application = await db.query<{
      id: string;
      principal_amount: string;
      branch_id: string;
      has_terms: boolean;
      loan_id: string | null;
      interest_rate: string | null;
      cycle_days: number | null;
      cycle_count: number | null;
      expected_repayment_per_cycle: string | null;
    }>(
      `SELECT a.id, a.principal_amount, a.branch_id,
              (t.application_id IS NOT NULL) AS has_terms,
              l.id AS loan_id, l.interest_rate, l.cycle_days, l.cycle_count,
              l.expected_repayment_per_cycle
         FROM loan_applications a
         LEFT JOIN loan_application_terms t ON t.application_id = a.id
         LEFT JOIN loans l ON l.application_id = a.id
        WHERE a.id=$1
        FOR UPDATE OF a`,
      [input.applicationId]
    );
    if ((application.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const app = application.rows[0]!;
    if (app.has_terms) {
      throw AppError.conflict(
        "This application already has recorded loan terms; remediation only fills a missing record"
      );
    }
    if (app.loan_id === null || app.cycle_days === null || app.cycle_count === null ||
        app.expected_repayment_per_cycle === null || app.interest_rate === null) {
      throw AppError.conflict(
        "Terms can only be remediated from a disbursed loan's own recorded terms"
      );
    }

    const principal = Number(app.principal_amount);
    const interestPercentage = Number(app.interest_rate);
    const calculatedInterest = Math.round(principal * (interestPercentage / 100) * 100) / 100;
    const calculatedTotal = Math.round((principal + calculatedInterest) * 100) / 100;
    const repaymentMode: "weekly" | "daily" = app.cycle_days === 1 ? "daily" : "weekly";

    // The weekday is read from the loan's own recorded first due date. It is
    // never assumed: a weekly loan whose first due date is not on record is
    // stored with no weekday rather than given an invented one.
    let repaymentWeekday: number | null = null;
    if (repaymentMode === "weekly") {
      const firstDue = await db.query<{ weekday: number }>(
        `SELECT EXTRACT(DOW FROM due_date)::int AS weekday
           FROM repayment_schedule_rows
          WHERE loan_id=$1
          ORDER BY cycle_number ASC
          LIMIT 1`,
        [app.loan_id]
      );
      repaymentWeekday =
        (firstDue.rowCount ?? 0) > 0 ? firstDue.rows[0]!.weekday : null;
    }

    // The tally is verified, never asserted. The recorded schedule must add up
    // to principal plus interest, or the record is stored as NOT TALLY and the
    // disbursement gate keeps refusing it until it is genuinely resolved.
    const perCycle = Number(app.expected_repayment_per_cycle);
    const recordedTotal =
      Math.round(perCycle * app.cycle_count * 100) / 100;
    const expectedTotal = Math.round((principal + calculatedInterest) * 100) / 100;
    const tallyStatus: "matched" | "not_tally" =
      Math.abs(recordedTotal - expectedTotal) < 0.01 ? "matched" : "not_tally";

    await db.query(
      `INSERT INTO loan_application_terms
         (application_id, company_id, branch_id, repayment_mode, repayment_weekday,
          repayment_periods, interest_percentage, repayment_amount,
          calculated_interest, calculated_total_repayment, tally_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        app.id,
        actor.companyId,
        app.branch_id,
        repaymentMode,
        repaymentWeekday,
        app.cycle_count,
        interestPercentage,
        app.expected_repayment_per_cycle,
        calculatedInterest,
        calculatedTotal,
        tallyStatus
      ]
    );

    await db.query(
      `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                               entity_id, previous_value, new_value, reason, ip_address, user_agent)
       VALUES ($1,$2,$3,'recovery.terms_remediated','loan_applications',$4,$5,$6,$7,$8,$9)`,
      [
        actor.companyId,
        app.branch_id,
        actor.userId,
        app.id,
        JSON.stringify({ loan_application_terms: null }),
        JSON.stringify({
          repayment_mode: repaymentMode,
          repayment_weekday: repaymentWeekday,
          repayment_periods: app.cycle_count,
          interest_percentage: interestPercentage,
          repayment_amount: app.expected_repayment_per_cycle,
          recorded_total_repayment: String(recordedTotal),
          tally_status: tallyStatus,
          source: "loan_disbursement_record"
        }),
        input.reason,
        actor.meta?.ip ?? null,
        actor.meta?.userAgent ?? null
      ]
    );

    return {
      applicationId: app.id,
      repaymentMode,
      repaymentWeekday,
      repaymentPeriods: app.cycle_count,
      interestPercentage: String(interestPercentage),
      repaymentAmount: app.expected_repayment_per_cycle,
      calculatedInterest: String(calculatedInterest),
      calculatedTotalRepayment: String(calculatedTotal),
      recordedTotalRepayment: String(recordedTotal),
      tallyStatus
    };
  });
}

export interface PaymentReconciliationResult {
  runId: string;
  checkType: "payment_reconciliation";
  status: "passed" | "exceptions_found";
  checkedRowCount: number;
  exceptionsFound: number;
  exceptions: RecoveryException[];
  detail: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
}

const ALLOCATION_RECONCILIATION_CHECKS: CheckDefinition[] = [
  {
    name: "verified_payment_not_fully_allocated",
    sql: `SELECT p.id, p.amount::text AS verified_amount,
                 COALESCE(SUM(pa.repayment_amount + pa.savings_amount), 0)::text
                   AS allocated_amount
            FROM payments p
            LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
           WHERE p.status IN ('allocated','posted')
           GROUP BY p.id, p.amount
          HAVING COALESCE(SUM(pa.repayment_amount + pa.savings_amount), 0)
                 <> p.amount
           LIMIT 50`
  },
  {
    name: "payment_allocated_beyond_verified_amount",
    sql: `SELECT p.id, p.amount::text AS verified_amount,
                 COALESCE(SUM(pa.repayment_amount + pa.savings_amount), 0)::text
                   AS allocated_amount
            FROM payments p
            JOIN payment_allocations pa ON pa.payment_id = p.id
           GROUP BY p.id, p.amount
          HAVING COALESCE(SUM(pa.repayment_amount + pa.savings_amount), 0)
                 > p.amount
           LIMIT 50`
  },
  {
    name: "loan_balance_does_not_match_allocations",
    sql: `SELECT l.id, l.principal_amount::text AS principal,
                 l.outstanding_principal::text AS outstanding,
                 GREATEST(l.principal_amount - COALESCE(SUM(pa.repayment_amount), 0), 0)::text
                   AS expected_outstanding
            FROM loans l
            LEFT JOIN payment_allocations pa ON pa.loan_id = l.id
           WHERE l.status IN ('active','overdue','completed')
           GROUP BY l.id, l.principal_amount, l.outstanding_principal
          HAVING ROUND(GREATEST(l.principal_amount - COALESCE(SUM(pa.repayment_amount), 0), 0), 2)
                 <> ROUND(l.outstanding_principal, 2)
           LIMIT 50`
  },
  {
    name: "savings_balance_does_not_match_allocations",
    sql: `SELECT sa.id, sa.balance::text AS balance,
                 COALESCE(SUM(pa.savings_amount), 0)::text AS allocated_savings
            FROM savings_accounts sa
            LEFT JOIN payment_allocations pa
              ON pa.loan_id IN (
                SELECT l.id FROM loans l WHERE l.customer_id = sa.customer_id
              )
           GROUP BY sa.id, sa.balance
          HAVING ROUND(sa.balance, 2) <> ROUND(COALESCE(SUM(pa.savings_amount), 0), 2)
           LIMIT 50`
  },
  {
    name: "verified_webhook_without_payment",
    sql: `SELECT we.id, we.provider, we.provider_event_id
            FROM webhook_events we
           WHERE we.signature_valid = true
             AND NOT EXISTS (
               SELECT 1 FROM payments p WHERE p.webhook_event_id = we.id
             )
           LIMIT 50`
  }
];

/**
 * RULE 20.6.2 / 20.6.3 — after a restore or major incident, payment allocation
 * must reconcile exactly (verified payment = loan allocation + savings
 * allocation), loan and savings balances must reconcile from actual posted
 * records, and provider transactions must reconcile to recorded payments.
 * Anything that does not reconcile becomes an explicit exception; money is
 * never invented or silently adjusted to make a total look right.
 */
export async function runPaymentReconciliation(
  actor: RecoveryActor & { meta?: { ip?: string | null; userAgent?: string | null; requestId?: string | null } }
): Promise<PaymentReconciliationResult> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  const startedAt = new Date().toISOString();
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const exceptions: RecoveryException[] = [];
    let checkedRowCount = 0;
    for (const check of ALLOCATION_RECONCILIATION_CHECKS) {
      const result = await db.query<Record<string, unknown>>(check.sql);
      checkedRowCount += result.rowCount ?? 0;
      if ((result.rowCount ?? 0) > 0) {
        exceptions.push({ check: check.name, rowCount: result.rowCount ?? 0, sample: result.rows });
      }
    }
    const status = exceptions.length === 0 ? "passed" : "exceptions_found";
    const runId = randomUUID();
    const completedAt = new Date().toISOString();
    await db.query(
      `INSERT INTO recovery_check_runs
         (id, company_id, check_type, status, exceptions_found, detail,
          checked_row_count, requested_by, started_at, completed_at)
       VALUES ($1,$2,'payment_reconciliation',$3,$4,$5,$6,$7,$8,$9)`,
      [
        runId, actor.companyId, status, exceptions.length,
        JSON.stringify({ checksRun: ALLOCATION_RECONCILIATION_CHECKS.length }),
        checkedRowCount, actor.userId, startedAt, completedAt
      ]
    );
    await notifyAuditorsOfInconsistency(db, actor, runId, "payment_reconciliation", exceptions);
    return {
      runId,
      checkType: "payment_reconciliation",
      status,
      checkedRowCount,
      exceptionsFound: exceptions.length,
      exceptions,
      detail: { checksRun: ALLOCATION_RECONCILIATION_CHECKS.length },
      startedAt,
      completedAt
    };
  });
}

/**
 * RULE 6.5.5 - a financial-history inconsistency found by a reconciliation run
 * is an Auditor-level event. The Auditor reads it; they never resolve it.
 */
async function notifyAuditorsOfInconsistency(
  db: pg.PoolClient,
  actor: RecoveryActor,
  runId: string,
  checkType: string,
  exceptions: RecoveryException[]
): Promise<void> {
  if (exceptions.length === 0) return;
  await notifyAuditors(db, {
    companyId: actor.companyId,
    branchId: actor.branchId,
    kind: "audit.financial_history_inconsistency",
    payload: {
      run_id: runId,
      check_type: checkType,
      exceptions_found: exceptions.length,
      checks: exceptions.map((e) => ({ check: e.check, row_count: e.rowCount }))
    }
  });
}

export async function listRecoveryCheckRuns(
  actor: RecoveryActor,
  limit = 20
): Promise<
  Array<{
    id: string;
    checkType: string;
    status: string;
    exceptionsFound: number;
    checkedRowCount: number;
    completedAt: string;
  }>
> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const { rows } = await db.query<{
      id: string;
      check_type: string;
      status: string;
      exceptions_found: number;
      checked_row_count: number;
      completed_at: Date;
    }>(
      `SELECT id, check_type, status, exceptions_found, checked_row_count, completed_at
         FROM recovery_check_runs
        ORDER BY completed_at DESC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)]
    );
    return rows.map((row) => ({
      id: row.id,
      checkType: row.check_type,
      status: row.status,
      exceptionsFound: row.exceptions_found,
      checkedRowCount: row.checked_row_count,
      completedAt: row.completed_at.toISOString()
    }));
  });
}
