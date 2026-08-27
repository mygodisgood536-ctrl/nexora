import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import {
  assignRole,
  createCustomRole,
  createWorker,
  endAssignment,
  getRoleCatalogue,
  getRolePermissions,
  getWorker,
  listAssignments,
  listEnabledRoles,
  listWorkers,
  resetWorkerPassword,
  setRoleEnabled,
  setRolePermissions,
  setWorkerStatus
} from "./service";

/**
 * Stage 6 — Worker / role / custom-role / enabled-role routes.
 *
 * Verb-level permission gating is attached at the route level. Most
 * worker-management operations require `create`, `assign`, `suspend`,
 * or `configure`; the assignment model merges across a worker's
 * multiple active role grants.
 */
export const workersRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actor(req: Request): { sub: string; companyId: string } {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId };
}

function metaFrom(req: Request): { ip: string | null; userAgent: string | null; requestId: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
    requestId: (req.headers["x-request-id"] as string | undefined) ?? null
  };
}

function wrap(
  fn: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const scopeEnum = z.enum([
  "company_wide",
  "head_office",
  "multi_branch",
  "single_branch",
  "assigned_customers_groups_loans"
]);

const createWorkerSchema = z.object({
  firstName: z.string().min(1).max(100),
  middleName: z.string().max(100).nullable().optional(),
  lastName: z.string().min(1).max(100),
  username: z.string().min(3).max(80).regex(/^[a-z0-9._-]+$/i),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  birthDay: z.number().int().min(1).max(31).nullable().optional(),
  birthMonth: z.number().int().min(1).max(12).nullable().optional(),
  branchId: z.string().regex(UUID_RE, "Invalid branchId"),
  roleKey: z.string().min(1).max(80),
  scopeType: scopeEnum,
workersRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const opts: Parameters<typeof listWorkers>[1] = {};
    if (typeof req.query.branchId === "string") opts.branchId = req.query.branchId;
    if (typeof req.query.status === "string") opts.status = req.query.status;
    if (typeof req.query.search === "string") opts.search = req.query.search;
    if (typeof req.query.limit === "string") opts.limit = parseInt(req.query.limit, 10);
    if (typeof req.query.offset === "string") opts.offset = parseInt(req.query.offset, 10);
    res.json(await listWorkers(actor(req), opts));
  })
);

workersRouter.get(
  "/:id",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid worker id");
    res.json(await getWorker(actor(req), id));
  })
);

workersRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const parsed = createWorkerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Validation failed",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
      );
    }
    const created = await createWorker(actor(req), parsed.data, metaFrom(req));
    res.status(201).json(created);
  })
);

const statusSchema = z.object({
  action: z.enum(["activate", "suspend", "reactivate", "terminate"]),
  reason: z.string().max(500).optional()
});

workersRouter.post(
  "/:id/status",
  requireCompleteSession,
  requirePermission("suspend"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid worker id");
    const parsed = statusSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const result = await setWorkerStatus(
      actor(req),
      id,
      parsed.data.action,
      parsed.data.reason,
      metaFrom(req)
    );
    res.json(result);
  })
);

const resetPasswordSchema = z.object({
  reason: z.string().min(1).max(500)
});

workersRouter.post(
  "/:id/reset-password",
  requireCompleteSession,
  requirePermission("configure"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid worker id");
    const parsed = resetPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const result = await resetWorkerPassword(
      actor(req),
      id,
      parsed.data.reason,
      metaFrom(req)
    );
    res.status(200).json(result);
  })
);

workersRouter.get(
  "/:id/assignments",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid worker id");
    res.json(await listAssignments(actor(req), id));
  })
);

const assignSchema = z.object({
  roleKey: z.string().min(1).max(80),
  scopeType: scopeEnum,
  branchIds: z.array(z.string().regex(UUID_RE)).optional(),
  assignmentType: z.enum(["permanent", "temporary"]).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  reason: z.string().max(500).optional()
});
export const rolesRouter = Router();

rolesRouter.get(
  "/catalogue",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (_req, res) => {
    res.json(await getRoleCatalogue());
  })
);

rolesRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json(await listEnabledRoles(actor(req)));
  })
);

const createCustomSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  sourceRoleKey: z.string().min(1).max(80)
});

rolesRouter.post(
  "/custom",
  requireCompleteSession,
  requirePermission("configure"),
  wrap(async (req, res) => {
    const parsed = createCustomSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await createCustomRole(actor(req), parsed.data, metaFrom(req)));
  })
);

const setPermissionsSchema = z.object({
  verbs: z.array(z.string().min(1).max(40))
});

rolesRouter.put(
  "/:roleId/permissions",
  requireCompleteSession,
  requirePermission("configure"),
  wrap(async (req, res) => {
    const roleId = String(req.params.roleId);
    if (!UUID_RE.test(roleId)) throw AppError.badRequest("Invalid role id");
    const parsed = setPermissionsSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await setRolePermissions(actor(req), roleId, parsed.data.verbs, metaFrom(req)));
  })
);

rolesRouter.get(
  "/:roleId/permissions",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const roleId = String(req.params.roleId);
    if (!UUID_RE.test(roleId)) throw AppError.badRequest("Invalid role id");
    res.json(await getRolePermissions(actor(req), roleId));
  })
);

const setEnabledSchema = z.object({
  roleKey: z.string().min(1).max(80),
  enabled: z.boolean()
});

rolesRouter.post(
  "/enabled",
  requireCompleteSession,
  requirePermission("configure"),
  wrap(async (req, res) => {
    const parsed = setEnabledSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await setRoleEnabled(actor(req), parsed.data.roleKey, parsed.data.enabled, metaFrom(req)));
  })
);

workersRouter.post(
  "/:id/assignments",
  requireCompleteSession,
  requirePermission("assign"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid worker id");
    const parsed = assignSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const result = await assignRole(
      actor(req),
      { ...parsed.data, workerId: id },
      metaFrom(req)
    );
    res.status(201).json(result);
  })
);

const endSchema = z.object({ reason: z.string().min(1).max(500) });

workersRouter.post(
  "/assignments/:assignmentId/end",
  requireCompleteSession,
  requirePermission("assign"),
  wrap(async (req, res) => {
    const assignmentId = String(req.params.assignmentId);
    if (!UUID_RE.test(assignmentId)) throw AppError.badRequest("Invalid assignment id");
    const parsed = endSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await endAssignment(actor(req), assignmentId, parsed.data.reason, metaFrom(req)));
  })
);
  branchIds: z.array(z.string().regex(UUID_RE)).optional(),
  assignmentType: z.enum(["permanent", "temporary"]).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  reason: z.string().max(500).optional()
});