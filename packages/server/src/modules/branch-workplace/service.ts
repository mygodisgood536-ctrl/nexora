import type pg from "pg";
import { withTenant, withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { calculatePerformanceSet, listPermittedBranches, type PerformanceSet } from "../performance/engine";

export interface BranchWorkplaceActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

/**
 * RULE 7.2.3 - Entering a Branch Workplace creates an audit entry naming the
 * user, the branch, the time, and the role assignment used. Leaving is logged
 * as well.
 */
export async function auditBranchWorkplaceEnter(
  actor: { sub: string; companyId: string; branchId: string; roleKey: string },
  direction: "enter" | "leave",
  meta: ActorMeta = {}
): Promise<void> {
  await withTenant(actor.companyId, actor.branchId, async (db) => {
    const branch = await db.query<{ name: string }>(
      `SELECT name FROM branches WHERE id=$1 AND company_id=$2`,
      [actor.branchId, actor.companyId]
    );
    if ((branch.rowCount ?? 0) === 0) {
      throw AppError.notFound("Branch not found in this company");
    }
    await db.query(
      `INSERT INTO audit_logs
         (company_id, branch_id, actor_user_id, role_used, action,
          entity_type, entity_id, reason, ip_address, user_agent, request_id)
       VALUES ($1, $2, $3, $4, $5, 'branches', $2, $6, $7, $8, $9)`,
      [
        actor.companyId,
        actor.branchId,
        actor.sub,
        actor.roleKey,
        `branch_workplace.${direction}`,
        `${direction === "enter" ? "Entered" : "Left"} Branch Workplace for branch ${branch.rows[0]!.name} using role ${actor.roleKey}`,
        meta.ip ?? null,
        meta.userAgent ?? null,
        meta.requestId ?? null
      ]
    );
  });
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

interface PerfQuery {
  from: string;
  to: string;
}

async function graceDays(db: pg.PoolClient, companyId: string): Promise<number> {
  const r = await db.query<{ overdue_grace_days: number }>(
    `SELECT overdue_grace_days FROM company_settings WHERE company_id=$1`,
    [companyId]
  );
  return r.rows[0]?.overdue_grace_days ?? 0;
}

interface PerfQuery {
  from: string;
  to: string;
}

async function getBranchOverview(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  from: string,
  to: string,
  graceDaysVal: number
) {
  const r = await db.query<{
    branch_id: string;
    branch_code: string;
    branch_name: string;
    branch_status: string;
    portal_url: string;
    created_at: string;
    closed_at: string | null;
    loan_count: string;
    customer_count: string;
    active_loan_count: string;
    active_customer_count: string;
  }>(
    `SELECT 
      b.id AS branch_id,
      b.code AS branch_code,
      b.name AS branch_name,
      b.status AS branch_status,
      b.portal_url,
      b.created_at,
      b.closed_at,
      COUNT(l.id) FILTER (WHERE l.status IN ('active','overdue'))::text AS loan_count,
      COUNT(DISTINCT c.id) FILTER (WHERE l.status IN ('active','overdue'))::text AS customer_count,
      COUNT(l.id) FILTER (WHERE l.status IN ('active','overdue'))::text AS active_loan_count,
      COUNT(DISTINCT c.id) FILTER (WHERE l.status IN ('active','overdue'))::text AS active_customer_count
    FROM branches b
    LEFT JOIN loans l ON l.branch_id = b.id
    LEFT JOIN customers c ON c.id = l.customer_id
    WHERE b.id = $1
    GROUP BY b.id`,
    [branchId]
  );
  return r.rows[0] ?? null;
}

async function getBranchFinancials(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  from: string,
  to: string,
  graceDaysVal: number
) {
  const perf = await calculatePerformanceSet(db, {
    graceDays: graceDaysVal,
    query: { from, to },
    scope: { branchId }
  });
  return perf;
}

async function getBranchSavings(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  from: string,
  to: string,
  graceDaysVal: number
) {
  const r = await db.query<{
    total_savings: string;
    active_accounts: string;
  }>(
    `SELECT 
      COALESCE(SUM(sa.balance) FILTER (WHERE sa.status = 'active'), 0)::text AS total_savings,
      COUNT(DISTINCT sa.id) FILTER (WHERE sa.status = 'active')::text AS active_accounts
    FROM savings_accounts sa
    JOIN customers c ON c.id = sa.customer_id
    WHERE sa.company_id = $1 AND sa.branch_id = $2`,
    [companyId, branchId]
  );
  return r.rows[0] ?? { total_savings: "0.00", active_accounts: "0" };
}

async function getBranchLoans(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  from: string,
  to: string,
  graceDaysVal: number
) {
  const r = await db.query<{
    id: string;
    customer_id: string;
    customer_name: string;
    customer_code: string;
    product_name: string;
    principal_amount: string;
    outstanding_principal: string;
    interest_rate: string;
    cycle_days: number;
    cycle_count: number;
    expected_repayment_per_cycle: string;
    expected_savings_per_cycle: string;
    status: string;
    disbursed_at: string | null;
  }>(
    `SELECT 
      l.id,
      l.customer_id,
      CONCAT(c.first_name, ' ', COALESCE(c.middle_name || ' ', ''), c.last_name) AS customer_name,
      c.customer_code,
      lp.name AS product_name,
      l.principal_amount,
      l.outstanding_principal,
      l.interest_rate,
      l.cycle_days,
      l.cycle_count,
      l.expected_repayment_per_cycle,
      l.expected_savings_per_cycle,
      l.status,
      l.disbursed_at
    FROM loans l
    JOIN customers c ON c.id = l.customer_id
    JOIN loan_products lp ON lp.id = l.product_id
    WHERE l.branch_id = $1 AND l.status IN ('active','overdue')
    ORDER BY l.disbursed_at DESC NULLS LAST`,
    [branchId]
  );
  return r.rows;
}

async function getBranchWorkers(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  from: string,
  to: string,
  graceDaysVal: number
) {
  const r = await db.query<{
    staff_id: string;
    username: string;
    first_name: string;
    last_name: string;
    role_keys: string[];
    branch_id: string | null;
    assigned_customers: string;
    assigned_groups: string;
  }>(
    `SELECT u.id AS staff_id, u.username, u.first_name, u.last_name,
            COALESCE((
              SELECT array_agg(DISTINCT r.role_key)
                FROM role_assignments ra
                JOIN roles r ON r.id = ra.role_id
               WHERE ra.user_id = u.id AND ra.status = 'active'
            ), ARRAY[]::text[]) AS role_keys,
            u.branch_id,
            (SELECT count(DISTINCT ca.customer_id)::int FROM customer_assignments ca
              WHERE ca.staff_id=u.id AND ca.status='active' AND ca.customer_id IS NOT NULL) AS assigned_customers,
            (SELECT count(DISTINCT ca.group_id)::int FROM customer_assignments ca
              WHERE ca.staff_id=u.id AND ca.status='active' AND ca.group_id IS NOT NULL) AS assigned_groups
     FROM users u
      JOIN customer_assignments b ON b.staff_id = u.id AND b.status='active'
     WHERE u.company_id = $1 AND u.status = 'active' AND b.branch_id = $2
     GROUP BY u.id, u.username, u.first_name, u.last_name, u.branch_id
     ORDER BY u.username`,
    [companyId, branchId]
  );

  const workers: Array<{
    staffId: string;
    username: string;
    firstName: string;
    lastName: string;
    roleKeys: string[];
    branchId: string | null;
    assignedCustomers: number;
    assignedGroups: number;
    performance: any;
  }> = [];

  for (const row of r.rows) {
    // RULE 7.8 — the worker's figures honour the requested period.
    const perf = await calculatePerformanceSet(db, {
      graceDays: graceDaysVal,
      query: { from, to },
      scope: { staffId: row.staff_id, branchId }
    });
    workers.push({
      staffId: row.staff_id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      roleKeys: row.role_keys ?? [],
      branchId: row.branch_id,
      assignedCustomers: Number(row.assigned_customers ?? 0),
      assignedGroups: Number(row.assigned_groups ?? 0),
      performance: {
        expected: perf.expected,
        actual: perf.actual,
        outstanding: perf.outstanding,
        overdue: perf.overdue,
        collectionRate: perf.collectionRate,
        noCollectionsDue: perf.noCollectionsDue,
        expectedSavings: perf.expectedSavings,
        actualSavings: perf.actualSavings,
        savingsVariance: perf.savingsVariance,
        customersExpected: perf.customersExpected,
        customersPaid: perf.customersPaid,
        customersMissed: perf.customersMissed,
        activeCustomers: perf.activeCustomers,
        activeLoans: perf.activeLoans,
        overdueCustomers: perf.overdueCustomers
      }
    });
  }
  return workers;
}

async function getBranchVirtualAccounts(
  db: pg.PoolClient,
  companyId: string,
  branchId: string
) {
  const r = await db.query<{
    id: string;
    customer_id: string;
    customer_name: string;
    customer_code: string;
    provider: string;
    bank_name: string | null;
    account_name: string | null;
    account_number: string | null;
    provider_reference: string | null;
    status: string;
    created_at: string;
  }>(
    `SELECT 
      va.id,
      va.customer_id,
      CONCAT(c.first_name, ' ', COALESCE(c.middle_name || ' ', ''), c.last_name) AS customer_name,
      c.customer_code,
      va.provider,
      va.bank_name,
      va.account_name,
      va.account_number,
      va.provider_reference,
      va.status,
      va.created_at
    FROM virtual_accounts va
    JOIN customers c ON c.id = va.customer_id
    WHERE va.company_id = $1 AND va.branch_id = $2
    ORDER BY va.created_at DESC`,
    [companyId, branchId]
  );
  return r.rows;
}

async function getBranchRepaymentSchedule(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  from: string,
  to: string,
  graceDaysVal: number
) {
  const r = await db.query<{
    id: string;
    loan_id: string;
    customer_id: string;
    customer_name: string;
    cycle_number: number;
    due_date: string;
    expected_repayment: string;
    expected_savings: string;
    actual_repayment: string;
    actual_savings: string;
    paid_at: string | null;
    loan_status: string;
    outstanding_principal: string;
  }>(
    `SELECT 
      rsr.id,
      rsr.loan_id,
      l.customer_id,
      CONCAT(c.first_name, ' ', COALESCE(c.middle_name || ' ', ''), c.last_name) AS customer_name,
      rsr.cycle_number,
      rsr.due_date,
      rsr.expected_repayment,
      rsr.expected_savings,
      rsr.actual_repayment,
      rsr.actual_savings,
      rsr.paid_at,
      l.status AS loan_status,
      l.outstanding_principal
    FROM repayment_schedule_rows rsr
    JOIN loans l ON l.id = rsr.loan_id
    JOIN customers c ON c.id = l.customer_id
    WHERE l.branch_id = $1 AND rsr.due_date BETWEEN $2 AND $3
    ORDER BY rsr.due_date ASC`,
    [branchId, from, to]
  );
  return r.rows;
}

export async function getBranchWorkplaceOverview(
  actor: { companyId: string; branchId: string; sub: string },
  from: string,
  to: string
) {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const graceDaysVal = await (async () => {
      const r = await db.query<{ overdue_grace_days: number }>(
        `SELECT overdue_grace_days FROM company_settings WHERE company_id=$1`,
        [actor.companyId]
      );
      return r.rows[0]?.overdue_grace_days ?? 0;
    })();

    const today = new Date().toISOString().slice(0, 10);
    // RULE 7.8 — the workplace is a period view (today / this week / this
    // month / a chosen period). The requested range must actually drive the
    // figures, not be discarded in favour of a fixed historical window.
    const fromDate = from || "2020-01-01";
    const toDate = to || today;

    const [overview, financials, savings, loans, workers, virtualAccounts, repaymentSchedule] = await Promise.all([
      getBranchOverview(db, actor.companyId, actor.branchId, fromDate, toDate, graceDaysVal),
      getBranchFinancials(db, actor.companyId, actor.branchId, fromDate, toDate, graceDaysVal),
      getBranchSavings(db, actor.companyId, actor.branchId, fromDate, toDate, graceDaysVal),
      getBranchLoans(db, actor.companyId, actor.branchId, fromDate, toDate, graceDaysVal),
      getBranchWorkers(db, actor.companyId, actor.branchId, fromDate, toDate, graceDaysVal),
      getBranchVirtualAccounts(db, actor.companyId, actor.branchId),
      getBranchRepaymentSchedule(db, actor.companyId, actor.branchId, fromDate, toDate, graceDaysVal)
    ]);

    return {
      period: { from: fromDate, to: toDate, grace_days: graceDaysVal },
      branch: overview,
      financials,
      savings,
      loans,
      workers,
      virtualAccounts,
      repaymentSchedule
    };
  });
}

export async function getBranchWorkersForSupervision(
  actor: { companyId: string; branchId: string; sub: string },
  from: string,
  to: string
) {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const graceDaysVal = await (async () => {
      const r = await db.query<{ overdue_grace_days: number }>(
        `SELECT overdue_grace_days FROM company_settings WHERE company_id=$1`,
        [actor.companyId]
      );
      return r.rows[0]?.overdue_grace_days ?? 0;
    })();

    const today = new Date().toISOString().slice(0, 10);
    const fromDate = from || "2020-01-01";
    const toDate = to || today;

    return getBranchWorkers(db, actor.companyId, actor.branchId, fromDate, toDate, graceDaysVal);
  });
}

/**
 * RULE 7.6 — "Everything one worker carries: assigned customers, groups,
 * loans, disbursements, expected money, realised money, overdue position and
 * performance." Clicking a worker in the Branch Workplace opens this book.
 */
export async function getWorkerBook(
  actor: { companyId: string; branchId: string; sub: string },
  workerId: string,
  from: string,
  to: string
) {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const worker = await db.query<{
      id: string; worker_code: string; username: string;
      first_name: string; middle_name: string | null; last_name: string;
      branch_id: string | null; status: string; credential_state: string;
    }>(
      `SELECT id, worker_code, username, first_name, middle_name, last_name,
              branch_id, status, credential_state
         FROM users WHERE id=$1 AND company_id=$2`,
      [workerId, actor.companyId]
    );
    if ((worker.rowCount ?? 0) === 0) throw AppError.notFound("Worker not found");
    const w = worker.rows[0]!;
    // The book belongs to one branch; another branch's worker is not visible.
    if (w.branch_id !== null && w.branch_id !== actor.branchId) {
      throw AppError.forbidden("That worker does not belong to this branch");
    }

    const roles = await db.query<{ role_key: string }>(
      `SELECT r.role_key FROM role_assignments ra
         JOIN roles r ON r.id = ra.role_id
        WHERE ra.user_id=$1 AND ra.status='active' ORDER BY r.role_key`,
      [workerId]
    );

    const customers = await db.query(
      `SELECT c.id, c.customer_code, c.first_name, c.last_name, c.status
         FROM customer_assignments ca
         JOIN customers c ON c.id = ca.customer_id
        WHERE ca.staff_id=$1 AND ca.status='active' AND ca.customer_id IS NOT NULL
        ORDER BY c.customer_code`,
      [workerId]
    );
    const groups = await db.query(
      `SELECT g.id, g.name, g.status
         FROM customer_assignments ca
         JOIN groups g ON g.id = ca.group_id
        WHERE ca.staff_id=$1 AND ca.status='active' AND ca.group_id IS NOT NULL
        ORDER BY g.name`,
      [workerId]
    );
    const loans = await db.query(
      `SELECT l.id, c.customer_code, l.principal_amount, l.outstanding_principal,
              l.status, l.disbursed_at
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
        WHERE l.company_id=$1
          AND EXISTS (SELECT 1 FROM customer_assignments ca
                       WHERE ca.staff_id=$2 AND ca.customer_id=l.customer_id
                         AND ca.status='active')
        ORDER BY l.disbursed_at DESC NULLS LAST`,
      [actor.companyId, workerId]
    );
    const disbursements = await db.query(
      `SELECT l.id AS loan_id, l.disbursed_at, l.principal_amount, c.customer_code
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
        WHERE l.company_id=$1 AND l.disbursed_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM customer_assignments ca
                       WHERE ca.staff_id=$2 AND ca.customer_id=l.customer_id
                         AND ca.status='active')
        ORDER BY l.disbursed_at DESC`,
      [actor.companyId, workerId]
    );

    const graceDaysVal = await (async () => {
      const r = await db.query<{ overdue_grace_days: number }>(
        `SELECT overdue_grace_days FROM company_settings WHERE company_id=$1`,
        [actor.companyId]
      );
      return r.rows[0]?.overdue_grace_days ?? 0;
    })();
    const today = new Date().toISOString().slice(0, 10);
    const performance = await calculatePerformanceSet(db, {
      graceDays: graceDaysVal,
      query: { from: from || "2020-01-01", to: to || today },
      scope: { staffId: workerId, branchId: actor.branchId }
    });

    return {
      worker: {
        id: w.id,
        workerCode: w.worker_code,
        username: w.username,
        fullName: [w.first_name, w.middle_name, w.last_name].filter(Boolean).join(" "),
        branchId: w.branch_id,
        status: w.status,
        credentialState: w.credential_state,
        roleKeys: roles.rows.map((r) => r.role_key)
      },
      period: { from: from || "2020-01-01", to: to || today },
      assignedCustomers: customers.rows,
      assignedGroups: groups.rows,
      loans: loans.rows,
      disbursements: disbursements.rows,
      performance: {
        expected: performance.expected,
        actual: performance.actual,
        outstanding: performance.outstanding,
        overdue: performance.overdue,
        collectionRate: performance.collectionRate,
        graceDays: graceDaysVal
      }
    };
  });
}