// Branch Workplace read surface (Part 7 - "The Branch Workplace and the
// Branch Portal").
//
// Entry model (RULE 7.1.1/7.2.1): the Branch Workplace is the branch's
// operating console. It is entered by an authorised Head Office role from
// the caller's OWN portal, choosing the branch to inspect. No second
// password is used (RULE 7.1.1). Access is granted by role (RULE 7.2.1);
// roles not on that list never see the branch page (RULE 7.2.2).
//
// Read-only by design: exposes branch overview, workers, and performance
// for supervisory access. RULE 7.3.2 - this is not a "do the work" console.
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { PrincipalRoleRef } from "../../middleware/auth";
import { AppError } from "../../lib/errors";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import { auditBranchWorkplaceEnter } from "./service";
import {
  getBranchWorkplaceOverview,
  getBranchWorkersForSupervision,
  getWorkerBook
} from "./service";

/**
 * Roles that may enter a Branch Workplace (RULE 7.2.1, vision lines 938-983).
 *
 * RULE 7.2.2 — a role that is not on that list never sees the branch page at
 * all. The branch-world roles (area_manager, branch_manager,
 * deputy_branch_manager) are deliberately absent: the Branch Workplace is the
 * Head Office console that inspects a branch, and it is entered WITHOUT a
 * password, so a branch worker must never be admitted (prohibition #16).
 */
const BRANCH_WORKPLACE_ROLES = new Set([
  "md",
  "deputy_md",
  "gm",
  "assistant_gm",
  "operations_manager",
  "assistant_operations_manager",
  "internal_auditor",
  "audit_officer",
  "compliance_officer",
  "risk_officer",
  "hr_manager",
  "hr_officer",
  "finance_manager",
  "accountant",
  "assistant_accountant",
  "cash_bank_reconciliation_officer",
  "credit_manager",
  "credit_officer",
  "head_office_administrator",
  "mis_reporting_officer",
  "it_system_administrator"
]);

export const branchWorkplaceRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BranchActor = { sub: string; companyId: string; branchId: string; roleKey: string };

/** Scope gate: does this role assignment cover the target branch? */
function scopeCoversBranch(r: PrincipalRoleRef, branchId: string): boolean {
  switch (r.scopeType) {
    case "company_wide":
    case "head_office":
      return true;
    case "multi_branch":
    case "single_branch":
      return r.branchIds.includes(branchId);
    default:
      return false;
  }
}

/**
 * Resolves the Branch Workplace actor for `branch` (query param) against the
 * caller's role grants. RULE 7.2.1: access is by role; RULE 7.2.2: roles not
 * on the list never see the branch page.
 */
function branchActor(req: Request): BranchActor {
  const p = req.principal!;
  const branchId = str(req.query.branch ?? req.query.branchId);
  if (!branchId || !/^[0-9a-fA-F-]{36}$/.test(branchId)) {
    throw AppError.badRequest("branch is required and must be a valid UUID");
  }
  const granted = p.roles.find((r) => BRANCH_WORKPLACE_ROLES.has(r.roleKey) && scopeCoversBranch(r, branchId));
  if (!granted) {
    throw AppError.forbidden("Access to this Branch Workplace is not granted to your role");
  }
  return { sub: p.sub, companyId: p.companyId, branchId, roleKey: granted.roleKey };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(v: string | null, label: string): string | null {
  if (v === null) return null;
  if (!DATE_RE.test(v)) throw AppError.badRequest(`${label} must be YYYY-MM-DD`);
  return v;
}

function period(query: Record<string, unknown>): { from: string; to: string } {
  const date = requireDate(str(query.date), "date");
  const from = requireDate(str(query.from), "from");
  const to = requireDate(str(query.to), "to");
  if (date !== null) return { from: date, to: date };
  if (from !== null || to !== null) {
    if (from === null || to === null) {
      throw AppError.badRequest("from and to must be provided together");
    }
    return { from, to };
  }
  const today = new Date().toISOString().slice(0, 10);
  return { from: today, to: today };
}

function wrap(
  fn: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

function metaFrom(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] as string | null,
    requestId: req.headers["x-request-id"] as string | null
  };
}

// GET /api/v1/branch-workplace/overview
branchWorkplaceRouter.get(
  "/overview",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const actor = branchActor(req);
    const p = period(req.query as Record<string, unknown>);
    await auditBranchWorkplaceEnter(actor, "enter", metaFrom(req));
    res.json(
      await getBranchWorkplaceOverview(actor, p.from, p.to)
    );
  })
);

// GET /api/v1/branch-workplace/workers
branchWorkplaceRouter.get(
  "/workers",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const actor = branchActor(req);
    const p = period(req.query as Record<string, unknown>);
    await auditBranchWorkplaceEnter(actor, "enter", metaFrom(req));
    res.json({
      workers: await getBranchWorkersForSupervision(actor, p.from, p.to)
    });
  })
);

// RULE 7.6 — clicking a worker opens his full book: assigned customers and
// groups, loans, disbursements, expected/realised money, overdue position and
// performance for the requested period.
branchWorkplaceRouter.get(
  "/workers/:workerId",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const actor = branchActor(req);
    const workerId = String(req.params.workerId);
    if (!UUID_RE.test(workerId)) throw AppError.badRequest("Invalid worker id");
    const p = period(req.query as Record<string, unknown>);
    await auditBranchWorkplaceEnter(actor, "enter", metaFrom(req));
    res.json(await getWorkerBook(actor, workerId, p.from ?? "", p.to ?? ""));
  })
);