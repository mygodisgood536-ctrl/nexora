import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {  requireCompleteSession, requirePermission  } from "../../middleware/auth";
import {
  listRecoveryCheckRuns,
  remediateApplicationTerms,
  runEvidenceHashVerification,
  runRestoreVerification,
  runPaymentReconciliation,
  runReferentialIntegrityCheck
} from "./service";
import { listSessions } from "./sessions";

export const recoveryRouter = Router();

function actor(req: Request): {
  userId: string;
  companyId: string;
  branchId: string | null;
  meta: { ip: string | null; userAgent: string | null; requestId: string | null };
} {
  const p = req.principal!;
  return {
    userId: p.sub,
    companyId: p.companyId,
    branchId: p.branchId ?? null,
    meta: {
      ip: req.ip ?? null,
      userAgent: req.header("user-agent") ?? null,
      requestId: req.header("x-request-id") ?? null
    }
  };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const hashSchema = z.object({ limit: z.number().int().min(1).max(5000).optional() });

const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });

const remediationSchema = z.object({
  applicationId: z.string().uuid(),
  reason: z.string().min(10).max(500)
});

recoveryRouter.post(
  "/checks/payment-reconciliation",
  requireCompleteSession,
  requirePermission("view_performance"),
  wrap(async (req, res) => {
    res.json(await runPaymentReconciliation(actor(req)));
  })
);

recoveryRouter.post(
  "/remediate/terms",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const parsed = remediationSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await remediateApplicationTerms(actor(req), parsed.data));
  })
);

recoveryRouter.get(
  "/checks",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const parsed = listSchema.safeParse(req.query ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json({ runs: await listRecoveryCheckRuns(actor(req), parsed.data.limit) });
  })
);

recoveryRouter.post(
  "/checks/referential-integrity",
  requireCompleteSession,
  requirePermission("view_performance"),
  wrap(async (req, res) => {
    res.json(await runReferentialIntegrityCheck(actor(req)));
  })
);

recoveryRouter.post(
  "/checks/evidence-hashes",
  requireCompleteSession,
  requirePermission("view_performance"),
  wrap(async (req, res) => {
    const parsed = hashSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await runEvidenceHashVerification(actor(req), parsed.data));
  })
);

// RULE 20.5 - the post-restore drill. RPO/RTO are engineering acceptance
// criteria, so they are declared with the run rather than assumed.
const restoreSchema = z.object({
  rpoMinutes: z.number().int().positive().optional(),
  rtoMinutes: z.number().int().positive().optional(),
  evidenceLimit: z.number().int().min(1).max(5000).optional()
});

recoveryRouter.post(
  "/checks/restore-verification",
  requireCompleteSession,
  requirePermission("view_performance"),
  wrap(async (req, res) => {
    const parsed = restoreSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await runRestoreVerification(actor(req), parsed.data));
  })
);

/**
 * Part 12 §12.31 Technical hub — "Sessions". Read-only and company-scoped.
 * Requires the technical role to be present: RLS alone bounds the rows to this
 * company, and the `configure` verb is what the IT / System Administrator role
 * carries for technical surfaces.
 */
recoveryRouter.get(
  "/sessions",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const p = req.principal!;
    const roles = p.roles.map((r) => r.roleKey);
    if (!roles.includes("it_system_administrator") && !roles.includes("head_office_administrator")) {
      throw AppError.forbidden("The sessions surface is restricted to technical administration");
    }
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const includeExpired = req.query.includeExpired === "true";
    const sessions = await listSessions(
      { userId: p.sub, companyId: p.companyId, branchId: p.branchId ?? null },
      { limit, includeExpired }
    );
    res.json({ sessions });
  })
);
