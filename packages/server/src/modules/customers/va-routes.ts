// Virtual Account lifecycle endpoints (RULE 9.5.1 — VAs are a disbursement
// artifact; RULE 5.6.1 — only MD/Finance/IT may adjust them). List/read stay
// open to the branch dashboard per Part 1 §22.
import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession } from "../../middleware/auth";
import {
  activateVirtualAccount,
  closeVirtualAccount,
  getVirtualAccount,
  listVirtualAccounts,
  replaceVirtualAccount,
} from "./service";

export const virtualAccountsRouter = Router();

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

virtualAccountsRouter.get(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : null;
    if (customerId && !UUID_RE.test(customerId)) {
      throw AppError.badRequest("Invalid customerId");
    }
    res.json(await listVirtualAccounts(actor(req), customerId));
  })
);

const replaceSchema = z.object({
  customerId: z.string().regex(UUID_RE, "customerId must be a UUID"),
});

virtualAccountsRouter.post(
  "/replace",
  requireCompleteSession,
  wrap(async (req, res) => {
    const parsed = replaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await replaceVirtualAccount(actor(req), parsed.data.customerId, metaFrom(req)));
  })
);

virtualAccountsRouter.get(
  "/:id",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid virtual account id");
    res.json(await getVirtualAccount(actor(req), id));
  })
);

virtualAccountsRouter.post(
  "/:id/activate",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid virtual account id");
    res.json(await activateVirtualAccount(actor(req), id, metaFrom(req)));
  })
);

const closeSchema = z.object({
  reason: z.string().min(1).max(500),
});

virtualAccountsRouter.post(
  "/:id/close",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid virtual account id");
    const parsed = closeSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await closeVirtualAccount(actor(req), id, parsed.data.reason, metaFrom(req)));
  })
);