import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {  requireCompleteSession, requirePermission  } from "../../middleware/auth";
import {
  listOverdueEscalations,
  resolveOverdueEscalation,
  runOverdueEscalation
} from "./service";

export const overdueEscalationRouter = Router();

function actor(req: Request): { userId: string; companyId: string; branchId: string | null } {
  const p = req.principal!;
  return { userId: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const listSchema = z.object({
  status: z.enum(["open", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const runSchema = z.object({
  graceDays: z.number().int().min(0).max(365).optional(),
  limit: z.number().int().min(1).max(1000).optional()
});

const resolveSchema = z.object({ note: z.string().min(3).max(500) });

overdueEscalationRouter.get(
  "/escalations",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const parsed = listSchema.safeParse(req.query ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json({ escalations: await listOverdueEscalations(actor(req), parsed.data) });
  })
);

// The run raises escalations, so it is an edit action, not a read.
overdueEscalationRouter.post(
  "/escalations/run",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await runOverdueEscalation(actor(req), parsed.data));
  })
);

overdueEscalationRouter.post(
  "/escalations/:id/resolve",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const parsed = resolveSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await resolveOverdueEscalation(actor(req), String(req.params.id), parsed.data.note));
  })
);
