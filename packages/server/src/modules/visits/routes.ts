// Field/collection activity notes (Role Specs ROLE 28–31). Visit notes are
// activity records, never money entries — every financial figure in the
// field-facing workspaces comes from the payment pipeline.
import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import { createVisit, listVisits, type VisitActor } from "./service";

export const visitsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actor(req: Request): VisitActor {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function metaFrom(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
    requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : null
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => { fn(req, res).catch(next); };
}

const createSchema = z.object({
  customerId: z.string().regex(UUID_RE).nullable().optional(),
  groupId: z.string().regex(UUID_RE).nullable().optional(),
  visitType: z.enum(["visited", "followed_up", "other"]),
  note: z.string().min(1).max(1000),
  visitedOn: z.string().datetime().nullable().optional()
});

visitsRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await createVisit(actor(req), parsed.data, metaFrom(req)));
  })
);

visitsRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(
      await listVisits(actor(req), {
        staffId: str(req.query.staffId),
        customerId: str(req.query.customerId),
        groupId: str(req.query.groupId),
        from: str(req.query.from),
        to: str(req.query.to),
        limit,
        offset
      })
    );
  })
);