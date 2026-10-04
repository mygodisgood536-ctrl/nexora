import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {  requireCompleteSession, requirePermission  } from "../../middleware/auth";
import { answerCompanyQuestion, companyAiCapabilities, buildGroundingFor } from "./service";
import {
  describeActiveConfiguration,
  listFreeModels,
  listProviderModels,
  runCompanyAi,
  AI_MODEL_INTERFACE
} from "./config-service";

export const companyAiRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const querySchema = z.object({
  intent: z.enum(["customer_loan_history", "overdue_summary", "branch_collection_summary"]),
  question: z.string().min(1).max(1000),
  customerId: z.string().regex(UUID_RE).nullable().optional(),
  branchId: z.string().regex(UUID_RE).nullable().optional(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional()
});

function actor(req: Request): { sub: string; companyId: string; branchId: string | null } {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function metaFrom(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
    requestId: req.header("x-request-id") ?? null
  };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

companyAiRouter.get(
  "/capabilities",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (_req, res) => {
    res.json(companyAiCapabilities());
  })
);

companyAiRouter.post(
  "/query",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const parsed = querySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await answerCompanyQuestion(actor(req), parsed.data, metaFrom(req)));
  })
);

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  /** The same authorisation the deterministic intents use. */
  intent: z.enum(["customer_loan_history", "overdue_summary", "branch_collection_summary"]),
  customerId: z.string().regex(UUID_RE).nullable().optional(),
  branchId: z.string().regex(UUID_RE).nullable().optional(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional()
});

/**
 * RULE 21.2.8 - the AI MODEL interface is connected to this execution path.
 * The selection made in the interface is the configuration this call uses, and
 * the answer is produced by the real OpenCode execution layer.
 */
companyAiRouter.post(
  "/ask",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const parsed = askSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const who = actor(req);
    // RULE 21.3.2 - the grounding is built only from records this user is
    // authorised to reach, inside this company's tenant scope.
    const grounding = await buildGroundingFor(who, parsed.data);
    res.json(await runCompanyAi(who, { question: parsed.data.question, context: grounding }, metaFrom(req)));
  })
);

/**
 * RULE 21.2.1 - the exact interface the screen renders, with the two lists that
 * must stay dynamic taken live from OpenCode at the moment of the request.
 */
companyAiRouter.get(
  "/interface",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const who = actor(req);
    const [freeModels, providers, configuration] = await Promise.all([
      listFreeModels(),
      (await import("./config-service")).listProviders(),
      describeActiveConfiguration(who)
    ]);
    res.json({
      interface: AI_MODEL_INTERFACE,
      freeModels: freeModels.models,
      providers: providers.providers,
      configuration
    });
  })
);

/**
 * RULE 21.2.2 / 21.2.3 / 21.2.4 - the live catalogue that fills the interface.
 * Nothing here is stored: every list is what OpenCode reports right now.
 */
companyAiRouter.get(
  "/free-models",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (_req, res) => {
    res.json(await listFreeModels());
  })
);

companyAiRouter.get(
  "/providers",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (_req, res) => {
    const { listProviders } = await import("./config-service");
    res.json(await listProviders());
  })
);

companyAiRouter.get(
  "/providers/:providerId/models",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json(await listProviderModels(String(req.params.providerId)));
  })
);

/**
 * RULE 21.2.9 - the company's persisted configuration, so the interface shows
 * the real state after any reload and after a server restart.
 */
companyAiRouter.get(
  "/configuration",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json({ configuration: await describeActiveConfiguration(actor(req)) });
  })
);
