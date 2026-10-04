// Stage 7E — Performance read surface (Part 1 §25-A/B/C) + Collection Officer
// assignment management.
//
// Read-only by design: performance endpoints expose exactly what the shared
// Performance Calculation Engine computes and never a write action of any
// kind (Part 1 §25-C(D)(4)). The only writes in this module are the
// customer_assignments relationship rows that scope the engine's staff view.
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import {
  getPerformanceSummary,
  getBranchPerformanceTable,
  getStaffPerformanceTable,
  createAssignment,
  endAssignment,
  listAssignments,
  type PerformanceActor
} from "./service";

export const performanceRouter = Router();
export const assignmentsRouter = Router();

function actor(req: Request): PerformanceActor {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function resolveMe(v: unknown, currentUserId: string): string | null {
  if (v === "me") return currentUserId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * RULE 11.3.1 — performance visibility is a shared capability granted by
 * scope and permission, never a separate calculation. The matrix is explicit
 * about the roles that must NOT see a performance surface at all:
 *
 *   - IT and System Administrator: "No performance view" (technical status only)
 *   - Collection Officer: "His own figures only" — no branch, no worker table
 *   - Senior Collection Officer: own figures plus juniors' open overdue cases
 *     — still no branch and no worker table
 *   - Recovery Officer: his own recovery figures only
 *   - Branch roles see their branch only (already enforced by branch scope).
 *
 * This gate refuses the surface; the service then applies the caller's own
 * branch scope to whatever remains.
 */
const NO_PERFORMANCE_VIEW = new Set(["it_system_administrator"]);

const OWN_FIGURES_ONLY = new Set([
  "collection_officer",
  "senior_collection_officer",
  "recovery_officer"
]);

function requirePerformanceView(surface: "company" | "branch" | "worker"): (req: Request, _res: Response, next: NextFunction) => void {
  return (req, _res, next) => {
    const roles = req.principal?.roles ?? [];
    if (roles.length === 0) {
      next(AppError.forbidden("No role assignment grants a performance view"));
      return;
    }
    // A single assignment anywhere in the union that forbids the view is enough
    // to refuse it: the matrix grants the least common denominator.
    if (roles.some((r) => NO_PERFORMANCE_VIEW.has(r.roleKey))) {
      next(AppError.forbidden("Your role has no performance view"));
      return;
    }
    if (surface !== "company") {
      const limited = roles.filter((r) => OWN_FIGURES_ONLY.has(r.roleKey));
      if (limited.length > 0 && limited.length === roles.length) {
        next(AppError.forbidden("Your role may see its own figures only, not this surface"));
        return;
      }
    }
    next();
  };
}

function requireDate(v: string | null, label: string): string | null {
  if (v === null) return null;
  if (!DATE_RE.test(v)) throw AppError.badRequest(`${label} must be YYYY-MM-DD`);
  return v;
}

/** from/to come from explicit range params or a single `date`. */
function period(query: Record<string, unknown>): { from: string; to: string } {
  const date = requireDate(str(query.date), "date");
  const from = requireDate(str(query.from), "from");
  const to = requireDate(str(query.to), "to");
  if (date !== null) {
    return { from: date, to: date };
  }
  if (from !== null || to !== null) {
    if (from === null || to === null) {
      throw AppError.badRequest("from and to must be provided together");
    }
    return { from, to };
  }
  const today = new Date().toISOString().slice(0, 10);
  return { from: today, to: today };
}

performanceRouter.get(
  "/summary",
  requireCompleteSession,
  requirePermission("view"),
  requirePerformanceView("company"),
  wrap(async (req, res) => {
    const p = period(req.query as Record<string, unknown>);
    const currentUserId = req.principal!.sub;
    const requestedStaff = resolveMe(req.query.staffId, currentUserId);
    // RULE 11.3.1 — a Collection Officer sees his OWN figures only, so a
    // request for another worker is refused rather than silently widened.
    const roles = req.principal!.roles.map((r) => r.roleKey);
    if (roles.length > 0 && roles.every((k) => OWN_FIGURES_ONLY.has(k)) &&
        requestedStaff !== null && requestedStaff !== currentUserId) {
      throw AppError.forbidden("Your role may view its own figures only");
    }
    res.json(
      await getPerformanceSummary(actor(req), {
        ...p,
        branchId: str(req.query.branchId),
        staffId: requestedStaff
      })
    );
  })
);

performanceRouter.get(
  "/branches",
  requireCompleteSession,
  requirePermission("view_performance"),
  requirePerformanceView("branch"),
  wrap(async (req, res) => {
    const p = period(req.query as Record<string, unknown>);
    res.json(
      await getBranchPerformanceTable(actor(req), {
        ...p,
        branchId: str(req.query.branchId)
      })
    );
  })
);

performanceRouter.get(
  "/staff",
  requireCompleteSession,
  requirePermission("view_performance"),
  requirePerformanceView("worker"),
  wrap(async (req, res) => {
    const p = period(req.query as Record<string, unknown>);
    res.json(
      await getStaffPerformanceTable(actor(req), {
        ...p,
        branchId: str(req.query.branchId)
      })
    );
  })
);

assignmentsRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const body = (req.body ?? {}) as {
      staffId?: string;
      customerId?: string;
      groupId?: string;
    };
    if (typeof body.staffId !== "string") {
      throw AppError.unprocessable("staffId is required");
    }
    const assignment = await createAssignment(actor(req), {
      staffId: body.staffId,
      customerId: typeof body.customerId === "string" ? body.customerId : null,
      groupId: typeof body.groupId === "string" ? body.groupId : null
    }, {
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : null
    });
    res.status(201).json(assignment);
  })
);

assignmentsRouter.post(
  "/:id/end",
  requireCompleteSession,
  requirePermission("manage_workers"),
  wrap(async (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
    if (!reason) throw AppError.unprocessable("reason is required");
    const id = (req.params as Record<string, string>).id ?? "";
    if (!id) throw AppError.badRequest("assignment id is required");
    res.json(
      await endAssignment(actor(req), id, reason, {
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : null
      })
    );
  })
);

assignmentsRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view_performance"),
  wrap(async (req, res) => {
    const currentUserId = req.principal!.sub;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
    res.json(
      await listAssignments(actor(req), {
        staffId: resolveMe(req.query.staffId, currentUserId),
        customerId: str(req.query.customerId),
        groupId: str(req.query.groupId),
        status: str(req.query.status),
        limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
        offset: offset !== undefined && Number.isFinite(offset) ? offset : undefined
      })
    );
  })
);
