// Stage 7D — Payment pipeline + webhooks HTTP routes (Part 1 §21).
import { Router, raw } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession } from "../../middleware/auth";
import {
  createProviderConfig,
  getActiveProviderConfig,
  getPayment,
  listPayments,
  listReconciliationItems,
  listUnallocatedPayments,
  listUnmatchedPayments,
  listWebhookExceptions,
  loadSigningSecret,
  manuallyAllocate,
  reconcileProviderTransactions,
  runPaymentPipeline,
  type NormalizedWebhookEvent
} from "./service";

export const paymentsRouter = Router();
export const paymentProvidersRouter = Router();
export const webhookRouter = Router();
export const reconciliationItemsRouter = Router();
export const webhookExceptionsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actor(req: Request): { sub: string; companyId: string; branchId: string | null } {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function metaFrom(req: Request): { ip: string | null; userAgent: string | null; requestId: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
    requestId: req.header("x-request-id") ?? null
  };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const numericString = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected a numeric value" });
    return z.NEVER;
  }
  return n;
});

const providerConfigSchema = z.object({
  branchId: z.string().regex(UUID_RE, "branchId must be a UUID"),
  provider: z.string().min(2).max(40),
  apiBaseUrl: z.string().url(),
  apiKey: z.string().min(8).max(200),
  signingSecret: z.string().min(16).max(200)
});

paymentProvidersRouter.post(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const parsed = providerConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(
      await createProviderConfig(actor(req), parsed.data, metaFrom(req))
    );
  })
);

paymentProvidersRouter.get(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const cfg = await getActiveProviderConfig(actor(req));
    res.json({ provider: cfg });
  })
);

paymentsRouter.get(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : null;
    const branchId = typeof req.query.branchId === "string" ? req.query.branchId : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listPayments(actor(req), { status, customerId, branchId, limit, offset }));
  })
);

paymentsRouter.get(
  "/unmatched",
  requireCompleteSession,
  wrap(async (req, res) => {
    const resolved = req.query.resolved === "true" ? true
      : req.query.resolved === "false" ? false : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listUnmatchedPayments(actor(req), { resolved, limit, offset }));
  })
);

paymentsRouter.get(
  "/unallocated",
  requireCompleteSession,
  wrap(async (req, res) => {
    const resolved = req.query.resolved === "true" ? true
      : req.query.resolved === "false" ? false : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listUnallocatedPayments(actor(req), { resolved, limit, offset }));
  })
);

const manualAllocateSchema = z.object({
  loanId: z.string().regex(UUID_RE, "loanId must be a UUID"),
  repaymentAmount: numericString,
  savingsAmount: numericString,
  note: z.string().min(1).max(500)
});

paymentsRouter.post(
  "/:id/allocate",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid payment id");
    const parsed = manualAllocateSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await manuallyAllocate(actor(req), {
      paymentId: id,
      loanId: parsed.data.loanId,
      repaymentAmount: String(parsed.data.repaymentAmount),
      savingsAmount: String(parsed.data.savingsAmount),
      note: parsed.data.note
    }, metaFrom(req)));
  })
);

const reconcileSchema = z.object({
  provider: z.string().min(1).max(40),
  providerTransactions: z.array(z.object({
    providerTxnRef: z.string().min(1).max(120),
    amount: numericString,
    valueDate: z.string().min(1)
  })).min(1).max(5000)
});

paymentsRouter.post(
  "/reconcile",
  requireCompleteSession,
  wrap(async (req, res) => {
    const parsed = reconcileSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await reconcileProviderTransactions(actor(req), {
      provider: parsed.data.provider,
      providerTransactions: parsed.data.providerTransactions.map((t) => ({
        providerTxnRef: t.providerTxnRef,
        amount: String(t.amount),
        valueDate: t.valueDate
      }))
    }));
  })
);

paymentsRouter.get(
  "/:id",
  requireCompleteSession,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid payment id");
    const p = await getPayment(actor(req), id);
    if (!p) throw AppError.notFound("Payment not found");
    res.json(p);
  })
);

reconciliationItemsRouter.get(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const status = req.query.status as "open" | "resolved" | "dismissed" | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listReconciliationItems(actor(req), { status, limit, offset }));
  })
);

webhookExceptionsRouter.get(
  "/",
  requireCompleteSession,
  wrap(async (req, res) => {
    const resolved = req.query.resolved === "true" ? true
      : req.query.resolved === "false" ? false : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listWebhookExceptions({ resolved, limit, offset }));
  })
);

// ----- signed webhook entry point -----

// We accept a raw body so the signature can be computed against the
// exact bytes the provider sent. The pipeline itself uses the
// per-company signing secret + the X-Nexora-Company header to scope
// every operation to the right tenant.
export async function handlePaymentWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provider = String(req.params.provider ?? "");
    if (!/^[a-z0-9_-]{2,40}$/i.test(provider)) {
      res.status(400).json({ error: "invalid provider name" });
      return;
    }
    const companySlug = req.header("x-nexora-company");
    if (!companySlug) {
      res.status(400).json({ error: "missing X-Nexora-Company header" });
      return;
    }
    const signature = req.header("x-nexora-signature") ?? "";
    if (!signature) {
      res.status(401).json({ error: "missing signature" });
      return;
    }
    const { withBypass, withTenant } = await import("../../db/repo");
    const companyId = await withBypass(async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT id FROM companies WHERE slug=$1`, [companySlug]
      );
      return (r.rowCount ?? 0) > 0 ? r.rows[0]!.id : null;
    });
    if (!companyId) {
      res.status(400).json({ error: "unknown company" });
      return;
    }
    const secret = await loadSigningSecret(companyId, provider);
    if (!secret) {
      res.status(401).json({ error: "no signing secret for provider" });
      return;
    }
    const ts = req.header("x-nexora-timestamp") ?? "";
    const bodyString =
      Buffer.isBuffer(req.body) ? req.body.toString("utf8") :
      typeof req.body === "string" ? req.body :
      JSON.stringify(req.body ?? {});
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${ts}.${bodyString}`)
      .digest("hex");
    const provided = signature.toLowerCase();
    if (provided.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      await withTenant(companyId, null, async (db) => {
        await db.query(
          `INSERT INTO webhook_exceptions
             (company_id, provider, exception_type, raw_payload, detail)
           VALUES ($1,$2,'invalid_signature',$3::jsonb,$4::jsonb)`,
          [companyId, provider, bodyString,
           JSON.stringify({ reason: "signature mismatch" })]
        );
        await db.query(
          `INSERT INTO audit_logs (company_id, action, entity_type, entity_id,
                                   reason)
           VALUES ($1, 'webhook.invalid_signature', 'webhook_exceptions',
                   NULL, $2)`,
          [companyId, `provider=${provider} from ${req.ip ?? "unknown"}`]
        );
      });
      res.status(401).json({ error: "invalid signature" });
      return;
    }
    return await dispatchVerifiedWebhook(req, res, companyId, provider, bodyString);
  } catch (err) {
    next(err);
  }
}

async function dispatchVerifiedWebhook(
  req: Request,
  res: Response,
  companyId: string,
  provider: string,
  bodyString: string
): Promise<void> {
  const { withTenant } = await import("../../db/repo");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyString);
  } catch {
    await withTenant(companyId, null, async (db) => {
      await db.query(
        `INSERT INTO webhook_exceptions
           (company_id, provider, exception_type, raw_payload, detail)
         VALUES ($1,$2,'malformed',$3::jsonb,$4::jsonb)`,
        [companyId, provider, bodyString,
         JSON.stringify({ reason: "could not parse JSON body" })]
      );
    });
    res.status(422).json({ error: "malformed body" });
    return;
  }

  const body = parsed as {
    event?: string;
    event_id?: string;
    transaction?: {
      reference?: string;
      account_number?: string;
      amount?: string | number;
      timestamp?: string;
    };
    reversal?: {
      original_reference?: string;
      reason?: string;
    };
  };

  if (!body.transaction || !body.transaction.reference) {
    await withTenant(companyId, null, async (db) => {
      await db.query(
        `INSERT INTO webhook_exceptions
           (company_id, provider, exception_type, raw_payload, detail)
         VALUES ($1,$2,'malformed',$3::jsonb,$4::jsonb)`,
        [companyId, provider, bodyString,
         JSON.stringify({ reason: "missing transaction.reference" })]
      );
    });
    res.status(422).json({ error: "missing transaction.reference" });
    return;
  }

  const kind: "payment.received" | "payment.reversed" =
    body.event === "payment.reversed" ? "payment.reversed" : "payment.received";

  const companySlug = req.header("x-nexora-company")!;
  const event: NormalizedWebhookEvent = {
    provider,
    providerEventId: body.event_id ?? body.transaction.reference,
    providerTxnRef: kind === "payment.reversed"
      ? (body.reversal?.original_reference ?? body.transaction.reference)
      : body.transaction.reference,
    companySlug,
    accountNumber: body.transaction.account_number ?? "",
    amount: String(body.transaction.amount ?? "0"),
    valueDate: body.transaction.timestamp ?? new Date().toISOString(),
    rawPayload: parsed,
    kind,
    reason: body.reversal?.reason
  };

  const outcome = await runPaymentPipeline(event);

  await withTenant(companyId, null, async (db) => {
    await db.query(
      `INSERT INTO webhook_events
         (provider, provider_event_id, signature_valid, payload,
          processing_status)
       VALUES ($1,$2,true,$3::jsonb,'accepted')
       ON CONFLICT (provider, provider_event_id)
         WHERE provider_event_id IS NOT NULL
       DO NOTHING`,
      [provider, event.providerEventId, bodyString]
    );
  });

  res.status(200).json({ ok: true, outcome });
}

webhookRouter.post(
  "/payments/:provider",
  raw({ type: "*/*", limit: "1mb" }),
  handlePaymentWebhook
);
