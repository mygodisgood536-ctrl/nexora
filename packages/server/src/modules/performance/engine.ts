// Stage 7E — Performance Calculation Engine (Part 1 §25-A/25-B).
//
// This is THE one performance engine in Nexora. Every performance surface
// (company panel, branch table, worker/CO table, Central Command Dashboard,
// every role's Performance Information, Digital Collection Ledger rollups)
// must call this service; none may derive Expected/Actual/Outstanding/Overdue
// independently (Part 1 §25-B reconciliation + "no independent derivation"
// rules).
//
// All figures are computed live from the verified payment pipeline's trace:
// repayment_schedule_rows (Actual is written there by the pipeline; the
// pipeline itself is the only writer) joined to loans. Nothing is batched and
// nothing is manually entered — the pipeline's step-13 update is the write
// that this engine reads back, so performance recalculation is real-time by
// construction (Part 1 §25-B).
//
// Definitions (Part 1 §25-A), applied identically at every level:
//   Expected     = schedule amount due in [from,to]
//   Actual       = verified amount received & recognized on rows due in [from,to]
//   Outstanding  = Expected − Actual on in-period rows that have NOT yet
//                  crossed the company's overdue threshold ("current,
//                  not-yet-overdue period")
//   Overdue      = unpaid on ANY row that HAS crossed the threshold as of now
//   Collection % = Actual ÷ Expected × 100 (null => "No Collections Due")
//   Savings      = the savings component of the same schedule rows
//   Customers Expected/Paid/Missed = distinct customers per above sets
import type pg from "pg";

export interface PerfScope {
  branchId?: string | null;
  staffId?: string | null;
}

export interface PerfQuery {
  from: string;
  to: string;
}

export interface PerformanceSet {
  /** Amounts are exact numeric strings (2dp), matching the accounting module. */
  expected: string;
  actual: string;
  outstanding: string;
  overdue: string;
  /** null when there is nothing due in the period => "No Collections Due". */
  collectionRate: string | null;
  noCollectionsDue: boolean;
  expectedSavings: string;
  actualSavings: string;
  savingsVariance: string;
  customersExpected: number;
  customersPaid: number;
  customersMissed: number;
  activeCustomers: number;
  activeLoans: number;
  overdueCustomers: number;
}

export function fmt2(v: string | null | undefined): string {
  if (v === null || v === undefined) return "0.00";
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

/** Local (server) date in YYYY-MM-DD. */
export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Adds (or subtracts, for negative) whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/**
 * The one performance query. Scoping composes onto the tenant session:
 * loans/schedules/assignments are already bounded to the caller's tenant (and
 * branch, when the session is branch-restricted); the scope parameters here
 * narrow (never widen) that book: a branchId restricts to one branch, a
 * staffId restricts to the staff member's live customer/group assignments.
 */
export async function calculatePerformanceSet(
  db: pg.PoolClient | pg.Client,
  input: { graceDays: number; query: PerfQuery; scope?: PerfScope }
): Promise<PerformanceSet> {
  const { graceDays, query, scope } = input;
  const cutoff = addDays(isoDate(), -graceDays);

  const params: unknown[] = [query.from, query.to, cutoff];
  const conds: string[] = [];

  if (scope?.branchId) {
    params.push(scope.branchId);
    conds.push(`l.branch_id = $${params.length}`);
  }
  if (scope?.staffId) {
    params.push(scope.staffId, scope.staffId);
    conds.push(`(
      l.customer_id IN (
        SELECT ca.customer_id FROM customer_assignments ca
         WHERE ca.staff_id = $${params.length - 1}
           AND ca.status = 'active'
           AND ca.customer_id IS NOT NULL
      )
      OR l.customer_id IN (
        SELECT gm.customer_id FROM group_members gm
          JOIN customer_assignments ca ON ca.group_id = gm.group_id
         WHERE ca.staff_id = $${params.length}
           AND ca.status = 'active'
           AND ca.group_id IS NOT NULL
      )
    )`);
  }

  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  // A completed loan keeps its historically settled rows (they were real
  // schedules) but its unsettled remainder is never a future liability: rows
  // a completed loan never reached must not inflate Expected/Overdue.
  const completed = `NOT (l.status = 'completed'
     AND (rsr.actual_repayment < rsr.expected_repayment
       OR rsr.actual_savings < rsr.expected_savings))`;

  const sql = `
    SELECT
      COALESCE(SUM(rsr.expected_repayment) FILTER (WHERE rsr.due_date BETWEEN $1 AND $2 AND ${completed}), 0)::text AS expected,
      COALESCE(SUM(rsr.actual_repayment)    FILTER (WHERE rsr.due_date BETWEEN $1 AND $2 AND ${completed}), 0)::text AS actual,
      COALESCE(SUM(rsr.expected_savings)    FILTER (WHERE rsr.due_date BETWEEN $1 AND $2 AND ${completed}), 0)::text AS expected_savings,
      COALESCE(SUM(rsr.actual_savings)      FILTER (WHERE rsr.due_date BETWEEN $1 AND $2 AND ${completed}), 0)::text AS actual_savings,
      COALESCE(SUM(rsr.expected_repayment - rsr.actual_repayment)
        FILTER (WHERE rsr.due_date BETWEEN $1 AND $2
                  AND rsr.due_date >= $3
                  AND rsr.expected_repayment > rsr.actual_repayment
                  AND ${completed}), 0)::text AS outstanding,
      COALESCE(SUM(rsr.expected_repayment - rsr.actual_repayment)
        FILTER (WHERE rsr.due_date < $3
                  AND rsr.expected_repayment > rsr.actual_repayment
                  AND ${completed}), 0)::text AS overdue,
      ROUND((SUM(rsr.actual_repayment) FILTER (WHERE rsr.due_date BETWEEN $1 AND $2 AND ${completed})::numeric
             / NULLIF(SUM(rsr.expected_repayment) FILTER (WHERE rsr.due_date BETWEEN $1 AND $2 AND ${completed})::numeric, 0))
            * 100, 2)::text AS collection_rate,
      COUNT(DISTINCT c.id)
        FILTER (WHERE rsr.due_date BETWEEN $1 AND $2
                  AND (rsr.expected_repayment > 0 OR rsr.expected_savings > 0)
                  AND ${completed})::int AS customers_expected,
      COUNT(DISTINCT c.id)
        FILTER (WHERE rsr.due_date BETWEEN $1 AND $2
                  AND (rsr.expected_repayment > 0 OR rsr.expected_savings > 0)
                  AND (rsr.actual_repayment > 0 OR rsr.actual_savings > 0)
                  AND ${completed})::int AS customers_paid,
      COUNT(DISTINCT c.id)
        FILTER (WHERE rsr.due_date < $3
                  AND rsr.expected_repayment > rsr.actual_repayment
                  AND ${completed})::int AS overdue_customers,
      COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('active','overdue'))::int AS active_loans,
      COUNT(DISTINCT c.id) FILTER (WHERE l.status IN ('active','overdue'))::int AS active_customers
    FROM repayment_schedule_rows rsr
    JOIN loans l ON l.id = rsr.loan_id
    JOIN customers c ON c.id = l.customer_id
    ${where}`;

  const r = await db.query<{
    expected: string;
    actual: string;
    expected_savings: string;
    actual_savings: string;
    outstanding: string;
    overdue: string;
    collection_rate: string;
    customers_expected: string;
    customers_paid: string;
    overdue_customers: string;
    active_loans: string;
    active_customers: string;
  }>(sql, params);

  const row = r.rows[0]!;
  const expected = fmt2(row.expected);
  const actual = fmt2(row.actual);
  const expectedSavings = fmt2(row.expected_savings);
  const actualSavings = fmt2(row.actual_savings);
  const customersExpected = Number(row.customers_expected ?? 0);
  const customersPaid = Number(row.customers_paid ?? 0);

  return {
    expected,
    actual,
    outstanding: fmt2(row.outstanding),
    overdue: fmt2(row.overdue),
    collectionRate:
      Number(expected) > 0 ? fmt2(row.collection_rate) : null,
    noCollectionsDue: Number(expected) === 0,
    expectedSavings,
    actualSavings,
    savingsVariance: fmt2(String(Number(actualSavings) - Number(expectedSavings))),
    customersExpected,
    customersPaid,
    customersMissed: customersExpected - customersPaid,
    activeCustomers: Number(row.active_customers ?? 0),
    activeLoans: Number(row.active_loans ?? 0),
    overdueCustomers: Number(row.overdue_customers ?? 0)
  };
}

export interface BranchPerformanceRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  collectionOfficers: number;
  performance: PerformanceSet;
}

export interface StaffPerformanceRow {
  staffId: string;
  username: string;
  firstName: string;
  lastName: string;
  roleKeys: string[];
  branchId: string | null;
  assignedCustomers: number;
  assignedGroups: number;
  performance: PerformanceSet;
}

/** Branches within the caller's (RLS-resolved) scope. */
export async function listPermittedBranches(
  db: pg.PoolClient | pg.Client,
  companyId: string
): Promise<{ branchId: string; branchName: string; branchCode: string }[]> {
  const r = await db.query<{ id: string; name: string; code: string }>(
    `SELECT id, name, code FROM branches WHERE company_id=$1 ORDER BY code`,
    [companyId]
  );
  return r.rows.map((row) => ({
    branchId: row.id,
    branchName: row.name,
    branchCode: row.code
  }));
}

/**
 * Staff members that hold at least one live customer/group assignment within
 * the caller's scope. The Worker Performance table only lists staff who carry
 * assigned customers/groups (Part 1 §25-C(C)); staff without assignments have
 * no personal book to measure.
 */
export async function listAssignedStaff(
  db: pg.PoolClient | pg.Client,
  companyId: string,
  branchId: string | null
): Promise<StaffPerformanceRow[]> {
  const branchCond = branchId ? `AND b.branch_id = $2` : "";
  const staffParams = branchId ? [companyId, branchId] : [companyId];
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
     WHERE u.company_id = $1 AND u.status = 'active' ${branchCond}
     GROUP BY u.id, u.username, u.first_name, u.last_name, u.branch_id
     ORDER BY u.username`,
    staffParams
  );
  return r.rows.map((row) => ({
    staffId: row.staff_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    roleKeys: row.role_keys ?? [],
    branchId: row.branch_id,
    assignedCustomers: Number(row.assigned_customers ?? 0),
    assignedGroups: Number(row.assigned_groups ?? 0),
    performance: {
      expected: "0.00",
      actual: "0.00",
      outstanding: "0.00",
      overdue: "0.00",
      collectionRate: null,
      noCollectionsDue: true,
      expectedSavings: "0.00",
      actualSavings: "0.00",
      savingsVariance: "0.00",
      customersExpected: 0,
      customersPaid: 0,
      customersMissed: 0,
      activeCustomers: 0,
      activeLoans: 0,
      overdueCustomers: 0
    }
  }));
}