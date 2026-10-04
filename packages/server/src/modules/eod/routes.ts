// Stage 7E — End-of-day trigger + last-run read (Part 1 §17 / §23 / §42).
//
// The trigger is an operator/admin call: the deployment scheduler (cron,
// serverless) invokes it once per day per company so the §17 auto-expiry and
// §23 overdue transitions happen "at end-of-day in the company's configured
// timezone" without human steps. The read surface lets an operator confirm
// the last run without changing anything.
//
// The trigger changes financial state company-wide, so it is gated to
// company-level operating roles (MD/Deputy/GM/Operations/Head Office
// Administrator); an ordinary branch worker may not run it.
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import { runEndOfDay, lastEndOfDay, type EodActor } from "./service";

export const eodRouter = Router();

/** Roles permitted to run/read company-wide end-of-day operations. */
const EOD_OPERATOR_ROLES = new Set([
  "md",
  "deputy_md",
  "gm",
  "assistant_gm",
  "operations_manager",
  "assistant_operations_manager",
  "head_office_administrator",
  "finance_manager",
  "internal_auditor",
  "audit_officer"
]);

function actor(req: Request): EodActor {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function requireEodOperator(req: Request): void {
  const p = req.principal!;
  const granted = p.roles.some((r) => EOD_OPERATOR_ROLES.has(r.roleKey));
  if (!granted) {
    throw AppError.forbidden("End-of-day operations require a Head Office operating role");
  }
}

function metaFrom(req: Request): { ip: string | null; userAgent: string | null; requestId: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : null,
  };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

eodRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("approve"),
  wrap(async (req, res) => {
    requireEodOperator(req);
    res.json(await runEndOfDay(actor(req), metaFrom(req)));
  })
);

eodRouter.get(
  "/last",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    requireEodOperator(req);
    const result = await lastEndOfDay(actor(req));
    res.json(result);
  })
);