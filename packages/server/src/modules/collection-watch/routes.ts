import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {  requireCompleteSession, requirePermission  } from "../../middleware/auth";
import {
  listCollectionWatchAlerts,
  resolveCollectionWatchAlert,
  runCollectionWatch
} from "./service";

export const collectionWatchRouter = Router();

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
  limit: z.coerce.number().int().min(1).max(200).optional(),
  includeResolved: z.coerce.boolean().optional()
});

const runSchema = z.object({
  allocationWindowHours: z.number().int().min(1).max(720).optional(),
  fullCycleDays: z.number().int().min(1).max(365).optional(),
  belowTargetRate: z.number().min(0).max(100).optional()
});

const resolveSchema = z.object({ note: z.string().min(3).max(500) });

collectionWatchRouter.get(
  "/alerts",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const parsed = listSchema.safeParse(req.query ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json({ alerts: await listCollectionWatchAlerts(actor(req), parsed.data) });
  })
);

collectionWatchRouter.post(
  "/alerts/:id/resolve",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    const parsed = resolveSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await resolveCollectionWatchAlert(actor(req), id, parsed.data.note));
  })
);

// The run writes standing alerts, so it is an edit action, not a read.
collectionWatchRouter.post(
  "/run",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await runCollectionWatch(actor(req), parsed.data));
  })
);
