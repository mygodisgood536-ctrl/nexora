// Audit Trail explorer routes (Part 1 §25): read-only list/detail over the
// tenant audit trail, filterable by actor, branch, action, entity, and the
// transaction reference that links financial actions back to their source
// payment/webhook.
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import { z } from "zod";
import { listAuditEntries, getAuditEntry, type AuditActor } from "./service";
import {
  listFindings,
  listFindingEvents,
  progressFinding,
  raiseFinding,
  type FindingActor,
  type FindingSeverity,
  type FindingStatus
} from "./findings";

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

// ---------------------------------------------------------------------------
// PART 12 §12.14/§12.15 — "record findings and annotations".
//
// Findings are a separate surface from the trail itself: the trail records what
// the system did, a finding records what an auditor concluded. They are mounted
// on the same company-scoped router, so RLS applies identically.
// ---------------------------------------------------------------------------

const findingSeverity = z.enum(["observation", "low", "medium", "high", "critical"]);
const findingStatus = z.enum(["open", "acknowledged", "closed"]);

function findingActor(req: Request): FindingActor {
  const p = req.principal!;
  return {
    userId: p.sub,
    companyId: p.companyId,
    branchId: p.branchId ?? null,
    roleKey: p.activeRoleKey ?? p.roles[0]?.roleKey ?? null
  };
}

auditRouter.get(
  "/findings/list",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const status = str(req.query.status);
    const severity = str(req.query.severity);
    res.json(
      await listFindings(findingActor(req), {
        status: (status as FindingStatus | null) ?? null,
        severity: (severity as FindingSeverity | null) ?? null,
        limit: num(req.query.limit),
        offset: num(req.query.offset)
      })
    );
  })
);

const raiseFindingSchema = z.object({
  reference: z.string().min(1).max(40),
  title: z.string().min(3).max(200),
  observation: z.string().min(10).max(4000),
  severity: findingSeverity,
  entityType: z.string().max(60).optional().nullable(),
  entityId: z.string().uuid().optional().nullable()
});

auditRouter.post(
  "/findings",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const parsed = raiseFindingSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await raiseFinding(findingActor(req), parsed.data));
  })
);

const progressFindingSchema = z.object({
  status: findingStatus,
  note: z.string().max(2000).optional().nullable()
});

auditRouter.post(
  "/findings/:id/progress",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid finding id");
    const parsed = progressFindingSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await progressFinding(findingActor(req), id, parsed.data.status, parsed.data.note ?? null));
  })
);

auditRouter.get(
  "/findings/:id/events",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid finding id");
    res.json({ events: await listFindingEvents(findingActor(req), id) });
  })
);