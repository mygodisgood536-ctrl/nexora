// Stage 7F — Customer Portal HTTP routes (Part 2 §25). The enabled-check and
// login entry points are public/pre-auth; every /me-style read is guarded by
// the customer-scoped portal token.
import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {
  isPortalEnabled,
  loginCustomerPortal,
  portalLoanDetail,
  portalLoans,
  portalMe,
  portalPayments,
  portalReceipts,
  portalSavings,
  portalVirtualAccount,
  verifyPortalToken,
  type PortalPrincipal,
} from "./service";

export const customerPortalRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module "express-serve-static-core" {
  interface Request {
    portal?: PortalPrincipal;
  }
}

function requirePortal(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(AppError.unauthorized());
    return;
  }
  try {
    req.portal = verifyPortalToken(header.slice("Bearer ".length).trim());
  } catch (err) {
    next(err);
    return;
  }
  next();
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

customerPortalRouter.get(
  "/enabled",
  wrap(async (req, res) => {
    const company = typeof req.query.company === "string" ? req.query.company : "";
    if (!company) throw AppError.badRequest("company is required");
    res.json({ enabled: await isPortalEnabled(company) });
  })
);

const loginSchema = z.object({
  company: z.string().min(1).max(120),
  identifier: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
});

customerPortalRouter.post(
  "/login",
  wrap(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await loginCustomerPortal(parsed.data));
  })
);

customerPortalRouter.get(
  "/me",
  requirePortal,
  wrap(async (req, res) => {
    res.json(await portalMe(req.portal!));
  })
);

customerPortalRouter.get(
  "/loans",
  requirePortal,
  wrap(async (req, res) => {
    res.json(await portalLoans(req.portal!));
  })
);

customerPortalRouter.get(
  "/loans/:id",
  requirePortal,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid loan id");
    res.json(await portalLoanDetail(req.portal!, id));
  })
);

customerPortalRouter.get(
  "/savings",
  requirePortal,
  wrap(async (req, res) => {
    res.json(await portalSavings(req.portal!));
  })
);

customerPortalRouter.get(
  "/virtual-account",
  requirePortal,
  wrap(async (req, res) => {
    res.json(await portalVirtualAccount(req.portal!));
  })
);

customerPortalRouter.get(
  "/payments",
  requirePortal,
  wrap(async (req, res) => {
    res.json(await portalPayments(req.portal!));
  })
);

customerPortalRouter.get(
  "/receipts",
  requirePortal,
  wrap(async (req, res) => {
    res.json(await portalReceipts(req.portal!));
  })
);