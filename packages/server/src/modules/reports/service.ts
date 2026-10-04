// Stage 7E — Reports System (Part 2 §40–43).
//
// The Reporting System draws exclusively from the verified payment pipeline
// (Part 1 §21) and the Performance Calculation Service (Part 1 §25-B).
// Every report is:
//   - exportable (CSV at minimum)
//   - filterable by date range, branch, role scope
//   - computed live from the same engine that powers dashboards
//   - never a manually maintained figure
import type pg from "pg";
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";
import {
  calculatePerformanceSet,
  listPermittedBranches,
  listAssignedStaff,
  type PerfScope,
  type PerformanceSet,
  type StaffPerformanceRow,
} from "../performance/engine";

export interface ReportActor {
  sub: string;
  companyId: string;
  branchId: string | null;
  roles: { roleKey: string; scopeType: string; branchIds: string[] }[];
}

export interface ReportMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface ReportFilters {
  from: string;
  to: string;
  branchId?: string | null;
  staffId?: string | null;
  format?: "json" | "csv";
}

function resolveScope(
  actor: ReportActor,
  query: Record<string, unknown>
): PerfScope {
  const branchId = typeof query.branchId === "string" && query.branchId.length > 0 ? query.branchId : null;
  const staffId = typeof query.staffId === "string" && query.staffId.length > 0 ? query.staffId : null;

  if (actor.branchId && branchId && branchId !== actor.branchId) {
    throw AppError.forbidden("Cannot view reports for a different branch");
  }
  const effectiveBranchId = branchId ?? actor.branchId ?? null;

  let effectiveStaffId: string | null = null;
  if (staffId) {
    const canViewStaff = actor.roles.some((r) =>
      ["md", "gm", "assistant_gm", "head_office_administrator", "operations_manager"]
        .includes(r.roleKey) ||
      (r.scopeType === "company_wide" && r.roleKey === "branch_manager") ||
      (r.roleKey === "collection_officer" && staffId === actor.sub)
    );
    if (!canViewStaff) {
      throw AppError.forbidden("Cannot view reports for another staff member");
    }
    effectiveStaffId = staffId;
  }

  return { branchId: effectiveBranchId, staffId: effectiveStaffId };
}

export async function generateReport(
  actor: ReportActor,
  filters: ReportFilters,
  meta: ReportMeta = {}
): Promise<{ data: PerformanceSet; format: "json" | "csv" }> {
  const { from, to } = filters;
  const scope = resolveScope(actor, { branchId: filters.branchId, staffId: filters.staffId });
  const grace = await withTenant(actor.companyId, null, async (db) => {
    const r = await db.query<{ overdue_grace_days: number }>(
      `SELECT COALESCE(overdue_grace_days,0) AS overdue_grace_days FROM company_settings WHERE company_id=$1`,
      [actor.companyId]
    );
    return r.rows[0]?.overdue_grace_days ?? 0;
  });

  return withTenant(actor.companyId, null, async (db) => {
    const perf = await calculatePerformanceSet(db, {
      graceDays: grace,
      query: { from, to },
      scope,
    });
    return { data: perf, format: filters.format ?? "json" };
  });
}

export async function branchPerformanceTable(
  actor: ReportActor,
  filters: ReportFilters,
  meta: ReportMeta = {}
): Promise<{ rows: (PerformanceSet & { branchId: string; branchCode: string; collectionOfficers: number })[]; total: PerformanceSet; format: "json" | "csv" }> {
  const { from, to } = filters;
  const grace = await withTenant(actor.companyId, null, async (db) => {
    const r = await db.query<{ overdue_grace_days: number }>(
      `SELECT COALESCE(overdue_grace_days,0) AS overdue_grace_days FROM company_settings WHERE company_id=$1`,
      [actor.companyId]
    );
    return r.rows[0]?.overdue_grace_days ?? 0;
  });

  return withTenant(actor.companyId, null, async (db) => {
    const allowed = await listPermittedBranches(db, actor.companyId);
    const rows: (PerformanceSet & { branchId: string; branchCode: string; collectionOfficers: number })[] = [];
    for (const b of allowed) {
      const perf = await calculatePerformanceSet(db, {
        graceDays: grace,
        query: { from, to },
        scope: { branchId: b.branchId },
      });
      const coCount = await db.query<{ count: string }>(
        `SELECT COUNT(DISTINCT ra.user_id)::text AS count
           FROM role_assignments ra
           JOIN roles r ON r.id = ra.role_id
           JOIN role_assignment_branches rab ON rab.assignment_id = ra.id
          WHERE ra.company_id=$1 AND ra.status='active'
            AND r.role_key='collection_officer'
            AND ra.scope_type IN ('single_branch','multi_branch')
            AND rab.branch_id = $2`,
        [actor.companyId, b.branchId]
      );
      rows.push({ ...perf, branchId: b.branchId, branchCode: b.branchCode, collectionOfficers: Number(coCount.rows[0]?.count ?? 0) });
    }

    const total = await calculatePerformanceSet(db, {
      graceDays: grace,
      query: { from, to },
      scope: { branchId: actor.branchId ?? null },
    });

    return { rows, total, format: filters.format ?? "json" };
  });
}

export async function staffPerformanceTable(
  actor: ReportActor,
  filters: ReportFilters,
  meta: ReportMeta = {}
): Promise<{ rows: (PerformanceSet & { staffId: string; workerCode: string; roleKey: string })[]; total: PerformanceSet; format: "json" | "csv" }> {
  const { from, to } = filters;
  const grace = await withTenant(actor.companyId, null, async (db) => {
    const r = await db.query<{ overdue_grace_days: number }>(
      `SELECT COALESCE(overdue_grace_days,0) AS overdue_grace_days FROM company_settings WHERE company_id=$1`,
      [actor.companyId]
    );
    return r.rows[0]?.overdue_grace_days ?? 0;
  });

  return withTenant(actor.companyId, null, async (db) => {
    const allowed = await listAssignedStaff(db, actor.companyId, actor.branchId);
    const filtered = actor.branchId ? allowed.filter((s) => s.branchId === actor.branchId) : allowed;
    return buildStaffTable(db, grace, { from, to }, filtered, filters.format ?? "json");
  });
}

async function buildStaffTable(
  db: pg.PoolClient,
  graceDays: number,
  query: { from: string; to: string },
  staffList: StaffPerformanceRow[],
  format: "json" | "csv"
) {
  const rows: (PerformanceSet & { staffId: string; workerCode: string; roleKey: string })[] = [];
  for (const s of staffList) {
    const perf = await calculatePerformanceSet(db, {
      graceDays,
      query,
      scope: { staffId: s.staffId },
    });
    rows.push({ ...perf, staffId: s.staffId, workerCode: `W${s.staffId.slice(0, 4)}`, roleKey: s.roleKeys[0] ?? "collection_officer" });
  }

  const total = await calculatePerformanceSet(db, {
    graceDays,
    query,
    scope: { staffId: undefined },
  });

  return { rows, total, format };
}

function perfToCsvRow(obj: PerformanceSet, scopeLabel: string): string[] {
  const escape = (v: unknown): string => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    escape(scopeLabel),
    escape(obj.expected),
    escape(obj.actual),
    escape(obj.outstanding),
    escape(obj.overdue),
    escape(obj.collectionRate ?? "N/A"),
    escape(obj.expectedSavings),
    escape(obj.actualSavings),
    escape(obj.savingsVariance),
    escape(obj.customersExpected ?? ""),
    escape(obj.customersPaid ?? ""),
    escape(obj.customersMissed ?? ""),
    escape(obj.activeCustomers ?? ""),
    escape(obj.activeLoans ?? ""),
    escape(obj.overdueCustomers ?? ""),
  ];
}

export function toCsv(data: PerformanceSet, scopeLabel: string): string {
  const header = [
    "scope",
    "expected",
    "actual",
    "outstanding",
    "overdue",
    "collectionRate",
    "expectedSavings",
    "actualSavings",
    "savingsVariance",
    "customersExpected",
    "customersPaid",
    "customersMissed",
    "activeCustomers",
    "activeLoans",
    "overdueCustomers",
  ];
  return [header.join(","), perfToCsvRow(data, scopeLabel).join(",")].join("\n");
}

export function branchTableToCsv(
  rows: (PerformanceSet & { branchId: string; branchCode: string; collectionOfficers: number })[],
  total: PerformanceSet
): string {
  const header = [
    "branchCode",
    "collectionOfficers",
    "expected",
    "actual",
    "outstanding",
    "overdue",
    "collectionRate",
    "expectedSavings",
    "actualSavings",
    "savingsVariance",
    "customersExpected",
    "customersPaid",
    "customersMissed",
    "activeCustomers",
    "activeLoans",
    "overdueCustomers",
  ].join(",");
  const lines = rows.map((r) => [
    r.branchCode,
    String(r.collectionOfficers),
    r.expected,
    r.actual,
    r.outstanding,
    r.overdue,
    r.collectionRate ?? "N/A",
    r.expectedSavings,
    r.actualSavings,
    r.savingsVariance,
    r.customersExpected ?? "",
    r.customersPaid ?? "",
    r.customersMissed ?? "",
    r.activeCustomers ?? "",
    r.activeLoans ?? "",
    r.overdueCustomers ?? "",
  ].join(","));
  const totalLine = [
    "TOTAL",
    "",
    total.expected,
    total.actual,
    total.outstanding,
    total.overdue,
    total.collectionRate ?? "N/A",
    total.expectedSavings,
    total.actualSavings,
    total.savingsVariance,
    total.customersExpected ?? "",
    total.customersPaid ?? "",
    total.customersMissed ?? "",
    total.activeCustomers ?? "",
    total.activeLoans ?? "",
    total.overdueCustomers ?? "",
  ].join(",");
  return [header, ...lines, totalLine].join("\n");
}

export function staffTableToCsv(
  rows: (PerformanceSet & { staffId: string; workerCode: string; roleKey: string })[],
  total: PerformanceSet
): string {
  const header = [
    "workerCode",
    "roleKey",
    "expected",
    "actual",
    "outstanding",
    "overdue",
    "collectionRate",
    "expectedSavings",
    "actualSavings",
    "savingsVariance",
    "customersExpected",
    "customersPaid",
    "customersMissed",
    "activeCustomers",
    "activeLoans",
    "overdueCustomers",
  ].join(",");
  const lines = rows.map((r) => [
    r.workerCode,
    r.roleKey,
    r.expected,
    r.actual,
    r.outstanding,
    r.overdue,
    r.collectionRate ?? "N/A",
    r.expectedSavings,
    r.actualSavings,
    r.savingsVariance,
    r.customersExpected ?? "",
    r.customersPaid ?? "",
    r.customersMissed ?? "",
    r.activeCustomers ?? "",
    r.activeLoans ?? "",
    r.overdueCustomers ?? "",
  ].join(","));
  const totalLine = [
    "TOTAL",
    "",
    total.expected,
    total.actual,
    total.outstanding,
    total.overdue,
    total.collectionRate ?? "N/A",
    total.expectedSavings,
    total.actualSavings,
    total.savingsVariance,
    total.customersExpected ?? "",
    total.customersPaid ?? "",
    total.customersMissed ?? "",
    total.activeCustomers ?? "",
    total.activeLoans ?? "",
    total.overdueCustomers ?? "",
  ].join(",");
  return [header, ...lines, totalLine].join("\n");
}