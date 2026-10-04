// Accounting statement routes (Part 1 §21 step [9]; Part 2 §38–39):
// read-only statements derived from the posted double-entry journal —
// General Ledger, Trial Balance, Cash Book, Cash Flow. No write surface:
// money movement enters the ledger exclusively through the verified payment
// pipeline, never through these endpoints.
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import {
  getTrialBalance,
  getGeneralLedger,
  getCashBook,
  getCashFlowStatement,
  getIncomeStatement,
  getFinancialPosition,
  type StatementActor
} from "./service";

export const accountingRouter = Router();

function actor(req: Request): StatementActor {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/**
 * Part 12 role duties + RULE 11.3.1 — financial statements are granted by role
 * duty. The IT/System Administrator's duty is technical (pipeline, integration
 * and webhook health) and the matrix records "No customer financial detail"
 * and "No performance view", so IT is refused the statements entirely. Every
 * other authenticated role keeps its scoped statement access; the service then
 * applies the caller's own branch scope.
 */
const STATEMENT_ROLES_WITHOUT_FINANCIAL_ACCESS = new Set(["it_system_administrator"]);

function requireFinancialStatements(req: Request, _res: Response, next: NextFunction): void {
  const roles = req.principal?.roles ?? [];
  if (roles.length === 0) {
    next(AppError.forbidden("No role assignment grants financial statement access"));
    return;
  }
  if (roles.some((r) => STATEMENT_ROLES_WITHOUT_FINANCIAL_ACCESS.has(r.roleKey))) {
    next(AppError.forbidden("Your role has no financial statement access"));
    return;
  }
  next();
}

// Defaults keep the statements useful unparameterized: the Trial Balance is
// as-of today, the period views default to the full ledger history.
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(v: string | null, label: string): string | null {
  if (v === null) return null;
  if (!DATE_RE.test(v)) throw AppError.badRequest(`${label} must be YYYY-MM-DD`);
  return v;
}

accountingRouter.get(
  "/trial-balance",
  requireCompleteSession,
  requirePermission("view_performance"),
  requireFinancialStatements,
  wrap(async (req, res) => {
    const asOf = requireDate(str(req.query.asOf), "asOf") ?? today();
    res.json(await getTrialBalance(actor(req), asOf));
  })
);

accountingRouter.get(
  "/ledger",
  requireCompleteSession,
  requirePermission("view_performance"),
  requireFinancialStatements,
  wrap(async (req, res) => {
    res.json(
      await getGeneralLedger(actor(req), {
        from: requireDate(str(req.query.from), "from"),
        to: requireDate(str(req.query.to), "to"),
        accountCode: str(req.query.accountCode)
      })
    );
  })
);

accountingRouter.get(
  "/cash-book",
  requireCompleteSession,
  requirePermission("view_performance"),
  requireFinancialStatements,
  wrap(async (req, res) => {
    res.json(
      await getCashBook(actor(req), {
        from: requireDate(str(req.query.from), "from"),
        to: requireDate(str(req.query.to), "to")
      })
    );
  })
);

accountingRouter.get(
  "/cash-flow",
  requireCompleteSession,
  requirePermission("view_performance"),
  requireFinancialStatements,
  wrap(async (req, res) => {
    res.json(
      await getCashFlowStatement(actor(req), {
        from: requireDate(str(req.query.from), "from"),
        to: requireDate(str(req.query.to), "to")
      })
    );
  })
);

// RULE 11.6.1 — the standard statement set includes the Income Statement and
// the Financial Position; both are derived from the posted journal.
accountingRouter.get(
  "/income-statement",
  requireCompleteSession,
  requirePermission("view_performance"),
  requireFinancialStatements,
  wrap(async (req, res) => {
    res.json(
      await getIncomeStatement(actor(req), {
        from: requireDate(str(req.query.from), "from"),
        to: requireDate(str(req.query.to), "to")
      })
    );
  })
);

accountingRouter.get(
  "/financial-position",
  requireCompleteSession,
  requirePermission("view_performance"),
  requireFinancialStatements,
  wrap(async (req, res) => {
    res.json(
      await getFinancialPosition(actor(req), {
        to: requireDate(str(req.query.to), "to")
      })
    );
  })
);
