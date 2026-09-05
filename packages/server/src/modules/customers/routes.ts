import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession } from "../../middleware/auth";
import {
  createCustomer,
  getCustomer,
  listCustomers,
  setCustomerStatus,
  updateCustomerKyc,
} from "./service";

/**
 * Customer endpoints (Part 1 §22, Part 2 §26). All endpoints run inside
 * the caller's tenant session so RLS enforces company + branch isolation
 * automatically. Branch-scoped sessions are limited to their own branch
 * by the `rls_branch_scope` policy; explicit branch filters are honoured
 * for company-wide (head office) sessions.
 */

export const customersRouter = Router();

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

const kycDocSchema = z.object({
  type: z.string().min(1).max(50),
  reference: z.string().min(1).max(200),
  confirmed: z.boolean().optional(),
});

const createSchema = z.object({
  branchId: z.string().regex(UUID_RE, "branchId must be a UUID"),
  firstName: z.string().min(1).max(80),
  middleName: z.string().max(80).nullable().optional(),
  lastName: z.string().min(1).max(80),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  address: z.string().min(4).max(300),
  kycDocuments: z.array(kycDocSchema).max(20).optional(),
});

customersRouter.post(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const created = await createCustomer(actor(req), parsed.data, metaFrom(req));
    res.status(201).json(created);
  })
);

customersRouter.get(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const branchId = typeof req.query.branchId === "string" ? req.query.branchId : null;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const search = typeof req.query.search === "string" ? req.query.search : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const result = await listCustomers(actor(req), { branchId, status, search, limit, offset });
    res.json(result);
  })
);

customersRouter.get(
  "/:id",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    res.json(await getCustomer(actor(req), id));
  })
);

const kycUpdateSchema = z.object({
  kycDocuments: z.array(kycDocSchema).max(20).optional(),
  kycComplete: z.boolean(),
  reason: z.string().max(500).nullable().optional(),
});

customersRouter.put(
  "/:id/kyc",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    const parsed = kycUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(
      await updateCustomerKyc(
        actor(req),
        { customerId: id, ...parsed.data },
        metaFrom(req)
      )
    );
  })
);

const statusSchema = z.object({
  action: z.enum(["suspend", "reactivate", "close"]),
  reason: z.string().min(1).max(500),
});

customersRouter.post(
  "/:id/status",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    const parsed = statusSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(
      await setCustomerStatus(
        actor(req),
        { customerId: id, ...parsed.data },
        metaFrom(req)
      )
    );
  })
);
