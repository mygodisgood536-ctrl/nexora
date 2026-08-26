import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession } from "../../middleware/auth";
import { createBranch, listBranches, setBranchStatus } from "./service";

/**
 * Branch lifecycle endpoints (Part 1 §7–9). Scoped by the caller's principal
 * (companyId from the verified token) and executed inside the tenant's
 * fail-closed RLS session. Verb-level permission gating lands with the
 * role-architecture stage; sessions must at least be fully established.
 */
export const branchesRouter = Router();

function actor(req: Request): { sub: string; companyId: string } {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const createSchema = z.object({
  name: z.string().min(2).max(100),
  address: z.string().min(4).max(300),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(200).nullable().optional()
});

branchesRouter.post("/", requireCompleteSession, wrap(async (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", "Validation failed",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const branch = await createBranch(actor(req), parsed.data, {
    ip: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
    requestId: req.headers["x-request-id"] as string | undefined ?? null
  });
  res.status(201).json(branch);
}));

branchesRouter.get("/", requireCompleteSession, wrap(async (req, res) => {
  res.json(await listBranches(actor(req)));
}));

const statusSchema = z.object({
  action: z.enum(["suspend", "reactivate", "close"]),
  reason: z.string().max(500).optional()
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

branchesRouter.post("/:id/status", requireCompleteSession, wrap(async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid branch id");
  const parsed = statusSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  res.json(await setBranchStatus(actor(req), id, parsed.data.action, parsed.data.reason, {
    ip: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
    requestId: req.headers["x-request-id"] as string | undefined ?? null
  }));
}));
