// Audit Trail explorer routes (Part 1 §25): read-only list/detail over the
// tenant audit trail, filterable by actor, branch, action, entity, and the
// transaction reference that links financial actions back to their source
// payment/webhook.
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import { listAuditEntries, getAuditEntry, type AuditActor } from "./service";

export const auditRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actor(req: Request): AuditActor {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | undefined {
  if (typeof v === "undefined") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

auditRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json(
      await listAuditEntries(actor(req), {
        actorUserId: str(req.query.actorUserId),
        branchId: str(req.query.branchId),
        action: str(req.query.action),
        entityType: str(req.query.entityType),
        entityId: str(req.query.entityId),
        transactionRef: str(req.query.transactionRef) ?? str(req.query.ref),
        from: str(req.query.from),
        to: str(req.query.to),
        limit: num(req.query.limit),
        offset: num(req.query.offset)
      })
    );
  })
);

auditRouter.get(
  "/:id",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid audit entry id");
    const entry = await getAuditEntry(actor(req), id);
    if (!entry) throw AppError.notFound("Audit entry not found");
    res.json(entry);
  })
);