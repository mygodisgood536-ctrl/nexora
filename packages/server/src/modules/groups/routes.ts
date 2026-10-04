// Stage 7B - Group management endpoints (Part 2 Section 27).
// All endpoints are RLS-scoped via the caller's tenant session.
// Branch-scoped sessions are restricted to their own branch by
// the rls_branch_scope policy.
import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {  requireCompleteSession, requirePermission  } from "../../middleware/auth";
import {
  addGroupMember,
  closeGroup,
  createGroup,
  getGroup,
  getGroupLedger,
  listGroupMembers,
  listGroupOptions,
  listGroups,
  removeGroupMember,
  renameGroup,
  replaceGroupOptions,
} from "./service";

export const groupsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actor(req: Request): { sub: string; companyId: string; branchId: string | null } {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function metaFrom(req: Request): { ip: string | null; userAgent: string | null; requestId: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
    requestId: req.header("x-request-id") ?? null,
  };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const createSchema = z.object({
  branchId: z.string().regex(UUID_RE, "branchId must be a UUID"),
  name: z.string().min(2).max(100),
  groupNumber: z.string().min(1).max(80),
  groupAddress: z.string().min(2).max(300),
  dateCreated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateCreated must be YYYY-MM-DD"),
  description: z.string().max(500).nullable().optional(),
});

groupsRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await createGroup(actor(req), parsed.data, metaFrom(req)));
  })
);

groupsRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const branchId = typeof req.query.branchId === "string" ? req.query.branchId : null;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const search = typeof req.query.search === "string" ? req.query.search : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listGroups(actor(req), { branchId, status, search, limit, offset }));
  })
);

groupsRouter.get(
  "/:id",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid group id");
    res.json(await getGroup(actor(req), id));
  })
);

const renameSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});

groupsRouter.put(
  "/:id",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid group id");
    const parsed = renameSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await renameGroup(actor(req), { groupId: id, ...parsed.data }, metaFrom(req)));
  })
);

groupsRouter.post(
  "/:id/close",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid group id");
    const reason = String((req.body ?? {}).reason ?? "");
    res.json(await closeGroup(actor(req), id, reason, metaFrom(req)));
  })
);

const memberSchema = z.object({
  customerId: z.string().regex(UUID_RE, "customerId must be a UUID"),
  fullName: z.string().min(2).max(200),
  fatherHusbandName: z.string().min(1).max(120),
  maritalStatus: z.string().min(1).max(80),
  phone: z.string().min(1).max(40),
  groupRole: z.string().min(1).max(80),
});

groupsRouter.post(
  "/:id/members",
  requireCompleteSession,
  // RULE 9.3.1 - groups are "created and managed by Collection Officers", and
  // Part 12.27 gives the Collection Officer "assign customers and groups".
  // Membership is an assignment duty, so it is gated on "assign" rather than the
  // broader "edit", which keeps customers/loans/settings outside his reach.
  requirePermission("assign"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid group id");
    const parsed = memberSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const { customerId, ...member } = parsed.data;
    res.status(201).json(await addGroupMember(actor(req), id, customerId, member, metaFrom(req)));
  })
);

groupsRouter.get(
  "/:id/ledger",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid group id");
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const fromValue = typeof req.query.from === "string" ? req.query.from : null;
    const toValue = typeof req.query.to === "string" ? req.query.to : null;
    if ((fromValue === null) !== (toValue === null)) {
      throw AppError.badRequest("from and to must be provided together");
    }
    if (fromValue !== null && (!datePattern.test(fromValue) || !datePattern.test(toValue!))) {
      throw AppError.badRequest("from and to must be YYYY-MM-DD");
    }
    const to = toValue ?? new Date().toISOString().slice(0, 10);
    const from = fromValue ?? "1900-01-01";
    res.json(await getGroupLedger(actor(req), id, from, to));
  })
);

groupsRouter.get(
  "/:id/members",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid group id");
    res.json(await listGroupMembers(actor(req), id));
  })
);

groupsRouter.delete(
  "/:id/members/:customerId",
  requireCompleteSession,
  // RULE 9.3.1 - the Collection Officer manages his group's membership.
  requirePermission("assign"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    const customerId = String(req.params.customerId);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid group id");
    if (!UUID_RE.test(customerId)) throw AppError.badRequest("Invalid customer id");
    res.json(await removeGroupMember(actor(req), id, customerId, metaFrom(req)));
  })
);
const groupOptionsSchema = z.object({
  groupRole: z.array(z.string().min(1).max(80)),
  maritalStatus: z.array(z.string().min(1).max(80))
});

groupsRouter.get(
  "/options/configured",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json(await listGroupOptions(actor(req)));
  })
);

// Replacing the configured option lists is a company setting change, so it
// requires the edit permission. Any authenticated session cannot rewrite them.
groupsRouter.put(
  "/options/configured",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const parsed = groupOptionsSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await replaceGroupOptions(actor(req), parsed.data, metaFrom(req)));
  })
);
