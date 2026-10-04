import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {  requireCompleteSession, requirePermission  } from "../../middleware/auth";
import { getTraceabilityChain } from "./service";

export const traceabilityRouter = Router();

// RULE 10.9.1 - the walk can start from ANY node in the chain, so every node
// type the service can return is also a valid anchor.
const NODE_TYPES = [
  "payment",
  "webhook",
  "virtual_account",
  "customer",
  "loan",
  "schedule_row",
  "allocation",
  "journal_entry",
  "branch",
  "collection_officer",
  "audit_entry"
] as const;

const chainSchema = z.object({
  type: z.enum(NODE_TYPES),
  id: z.string().uuid()
});

traceabilityRouter.get(
  "/chain",
  requireCompleteSession,
  requirePermission("view"),
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = chainSchema.safeParse(req.query ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const p = req.principal!;
    getTraceabilityChain(
      { userId: p.sub, companyId: p.companyId, branchId: p.branchId ?? null },
      parsed.data.type,
      parsed.data.id
    )
      .then((chain) => res.json(chain))
      .catch(next);
  }
);
