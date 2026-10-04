// Stage 7E — Reports API (Part 2 §40–43).
//
// CSV export, filterable by date range/branch/role scope.
// Built on the shared Performance Calculation Engine (Part 1 §25-B).
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import {
  generateReport,
  branchPerformanceTable,
  staffPerformanceTable,
  toCsv,
  branchTableToCsv,
  staffTableToCsv,
  type ReportActor,
} from "./service";

export const reportsRouter = Router();

function actor(req: Request): ReportActor {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null, roles: p.roles };
}

function metaFrom(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.headers["user-agent"] as string | null, requestId: req.headers["x-request-id"] as string | null };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => { fn(req, res).catch(next); };
}

function period(query: Record<string, unknown>): { from: string; to: string } {
  const d = (v: unknown): string | null =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const from = d(query.from);
  const to = d(query.to);
  const date = d(query.date);
  if (date) return { from: date, to: date };
  if (from && to) return { from, to };
  const today = new Date().toISOString().slice(0, 10);
  return { from: today, to: today };
}

function formatParam(query: Record<string, unknown>): "json" | "csv" | undefined {
  const v = query.format;
  return v === "csv" ? "csv" : v === "json" ? "json" : undefined;
}

/** GET /api/v1/reports/summary — company/branch/worker performance summary */
reportsRouter.get(
  "/summary",
  requireCompleteSession,
  requirePermission("view_performance"),
  wrap(async (req, res) => {
    const { from, to } = period(req.query as Record<string, unknown>);
    const filters = { from, to, branchId: (req.query.branchId as string) ?? null, staffId: (req.query.staffId as string) ?? null, format: formatParam(req.query as Record<string, unknown>) };

    const result = await generateReport(actor(req), filters, metaFrom(req));
    if (result.format === "csv") {
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="performance-summary-${from}-to-${to}.csv"`);
      res.send(toCsv(result.data, "company"));
      return;
    }
    res.json(result.data);
  })
);

/** GET /api/v1/reports/branches — branch performance table */
reportsRouter.get(
  "/branches",
  requireCompleteSession,
  requirePermission("view_performance"),
  wrap(async (req, res) => {
    const { from, to } = period(req.query as Record<string, unknown>);
    const filters = { from, to, branchId: (req.query.branchId as string) ?? null, format: formatParam(req.query as Record<string, unknown>) };

    const result = await branchPerformanceTable(actor(req), filters, metaFrom(req));
    if (result.format === "csv") {
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="branch-performance-${from}-to-${to}.csv"`);
      res.send(branchTableToCsv(result.rows, result.total));
      return;
    }
    res.json({ rows: result.rows, total: result.total });
  })
);

/** GET /api/v1/reports/staff — collection officer / staff performance table */
reportsRouter.get(
  "/staff",
  requireCompleteSession,
  requirePermission("view_performance"),
  wrap(async (req, res) => {
    const { from, to } = period(req.query as Record<string, unknown>);
    const filters = { from, to, staffId: (req.query.staffId as string) ?? null, format: formatParam(req.query as Record<string, unknown>) };

    const result = await staffPerformanceTable(actor(req), filters, metaFrom(req));
    if (result.format === "csv") {
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="staff-performance-${from}-to-${to}.csv"`);
      res.send(staffTableToCsv(result.rows, result.total));
      return;
    }
    res.json({ rows: result.rows, total: result.total });
  })
);