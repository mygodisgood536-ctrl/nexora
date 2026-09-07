// Stage 7C - Lending domain REST endpoints (Part 1 Section 23).
// All endpoints are RLS-scoped via the caller's tenant session.
import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession } from "../../middleware/auth";
import {
  createApplication,
  createApprovalChain,
  createLoanProduct,
  decideApplication,
  disburse,
  getApplication,
  getApprovalChainSteps,
  listApplications,
  listApprovalChains,
  listLoanProducts,
  withdrawApplication,
} from "./service";

export const loansRouter = Router();
export const loanProductsRouter = Router();
export const approvalChainsRouter = Router();
export const loanApplicationsRouter = Router();
export const loanDisbursementsRouter = Router();

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

// Numeric field: accept either a JSON number or a numeric string,
// reject everything else. Schema-level transform is simpler than
// a top-level refine and matches the rest of the modules' style.
const numericString = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected a numeric value" });
    return z.NEVER;
  }
  return n;
});

const productSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).nullable().optional(),
  minPrincipal: numericString,
  maxPrincipal: numericString,
  interestRate: numericString,
  interestMethod: z.string().max(40).nullable().optional(),
  cycleDays: numericString,
  cycleCount: numericString,
  expectedRepaymentPerCycle: numericString,
  expectedSavingsPerCycle: numericString,
  approvalChainId: z.string().regex(UUID_RE, "approvalChainId must be a UUID"),
});

loanProductsRouter.post(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const parsed = productSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await createLoanProduct(actor(req), parsed.data, metaFrom(req)));
  })
);

loanProductsRouter.get(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const activeOnly = req.query.activeOnly === "true";
    res.json(await listLoanProducts(actor(req), { activeOnly }));
  })
);
const chainStepSchema = z.object({
  stageOrder: numericString,
  stepName: z.string().min(1).max(100),
  roleId: z.string().regex(UUID_RE, "roleId must be a UUID"),
});

const chainSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).nullable().optional(),
  onRejection: z.enum(["return_to_applicant", "previous_stage"]).optional(),
  steps: z.array(chainStepSchema).min(1),
});

approvalChainsRouter.post(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const parsed = chainSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await createApprovalChain(actor(req), parsed.data, metaFrom(req)));
  })
);

approvalChainsRouter.get(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    res.json(await listApprovalChains(actor(req)));
  })
);

approvalChainsRouter.get(
  "/:id/steps",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid chain id");
    res.json(await getApprovalChainSteps(actor(req), id));
  })
);

const applicationSchema = z.object({
  customerId: z.string().regex(UUID_RE, "customerId must be a UUID"),
  productId: z.string().regex(UUID_RE, "productId must be a UUID"),
  principalAmount: numericString,
});

loanApplicationsRouter.post(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const parsed = applicationSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await createApplication(actor(req), parsed.data, metaFrom(req)));
  })
);

loanApplicationsRouter.get(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listApplications(actor(req), { status, customerId, limit, offset }));
  })
);

loanApplicationsRouter.get(
  "/:id",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await getApplication(actor(req), id));
  })
);

const withdrawSchema = z.object({ reason: z.string().min(1).max(500) });

loanApplicationsRouter.post(
  "/:id/withdraw",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = withdrawSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await withdrawApplication(actor(req), id, parsed.data.reason, metaFrom(req)));
  })
);

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(1).max(500),
});

loanApplicationsRouter.post(
  "/:id/decide",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await decideApplication(actor(req), { applicationId: id, ...parsed.data }, metaFrom(req)));
  })
);

const disburseSchema = z.object({
  applicationId: z.string().regex(UUID_RE, "applicationId must be a UUID"),
  reason: z.string().min(1).max(500).optional(),
});

loanDisbursementsRouter.post(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const parsed = disburseSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await disburse(actor(req), parsed.data, metaFrom(req)));
  })
);
