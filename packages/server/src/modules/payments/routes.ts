// Stage 7D â€” Payment pipeline + webhooks HTTP routes (Part 1 Â§21).
import { Router, raw } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import {
  allocateVerifiedPayment,
  approveProviderChange,
  createProviderConfig,
  rejectProviderChange,
  updateProviderConfig,
  deactivateProviderConfig,
  dismissReconciliationItem,
  getActiveProviderConfig,
  getPayment,
  listPayments,
  getAllocationDetail,
  listPendingAllocations,
  listPendingProviderApprovals,
  listReconciliationItems,
  listUnallocatedPayments,
  listUnmatchedPayments,
  listWebhookExceptions,
  loadSigningSecret,
  listProviderRegistry,
  reconcileProviderTransactions,
  resolveReconciliationItem,
  runPaymentPipeline,
  testProviderConnection,
  listCorrections,
  requestCorrection,
  decideCorrection,
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

function metaFrom(req: Request): { ip: string | null; userAgent: string | null; requestId: string | null; roleUsed: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
    requestId: req.header("x-request-id") ?? null,
    roleUsed: (req.principal?.activeRoleKey ?? req.principal?.roles?.[0]?.roleKey ?? null)
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
  signingSecret: z.string().min(16).max(200),
  isSharedAccount: z.boolean().optional()
}).passthrough();

paymentProvidersRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("configure_providers"),
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
  requirePermission("view"),
  wrap(async (req, res) => {
    const cfg = await getActiveProviderConfig(actor(req));
    res.json({ provider: cfg });
  })
);

// Vision Part 8 â€” the data-driven provider registry read surface: which
// providers the platform ships with and what Nexora knows about each
// (name, transport, VA naming, webhook expectations, capability flags).
paymentProvidersRouter.get(
  "/registry",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json({ providers: await listProviderRegistry(actor(req)) });
  })
);

// Vision Part 8 â€” the MD's Approvals group: provider changes awaiting
// authorisation (registered before /:id-style routes).
paymentProvidersRouter.get(
  "/approvals",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json(await listPendingProviderApprovals(actor(req)));
  })
);

// Vision Part 8 â€” real connection test; activation requires it to pass.
paymentProvidersRouter.post(
  "/:id/test",
  requireCompleteSession,
  requirePermission(["configure_providers", "configure"]),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid provider config id");
    res.json(await testProviderConnection(actor(req), id, metaFrom(req)));
  })
);

// Vision Part 8 â€” the MD authorises a provider change made by a non-MD user.
paymentProvidersRouter.post(
  "/:id/approve",
  requireCompleteSession,
  requirePermission("configure"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid provider config id");
    res.json(await approveProviderChange(actor(req), id, metaFrom(req)));
  })
);

const providerDecisionSchema = z.object({
  reason: z.string().min(3).max(500)
});

// RULE 8.4.1 step 7 - the MD either approves or rejects. A rejection must keep
// the provider inactive WITH THE REASON RECORDED; the account on whose behalf
// the change was made is notified of the decision either way.
paymentProvidersRouter.post(
  "/:id/reject",
  requireCompleteSession,
  requirePermission("configure"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid provider config id");
    const parsed = providerDecisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("A reason is required to reject a provider change");
    res.json(await rejectProviderChange(actor(req), id, parsed.data.reason, metaFrom(req)));
  })
);

/**
 * RULE 8.4.2 - editing a provider follows the same flow with the same
 * authorisation rule: the MD's own edit applies immediately, anyone else's waits
 * for the MD. Already-stored secrets are never re-shown; the editor replaces
 * them only if new values are entered.
 */
paymentProvidersRouter.patch(
  "/:id",
  requireCompleteSession,
  requirePermission("configure_providers"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid provider config id");
    const parsed = providerConfigSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await updateProviderConfig(actor(req), id, parsed.data, metaFrom(req)));
  })
);

/**
 * RULE 8.4.3 - removing or deactivating a provider follows the same
 * authorisation rule and must warn explicitly, in the confirmation, what will
 * stop working: no new virtual accounts can be created for that branch, and
 * existing customer accounts with that provider may stop receiving payments.
 *
 * RULE 8.7.1 - existing virtual accounts are never deleted by this; they remain
 * valid and recorded against their customers.
 */
paymentProvidersRouter.post(
  "/:id/deactivate",
  requireCompleteSession,
  requirePermission("configure_providers"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid provider config id");
    const parsed = providerDecisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("A reason is required to deactivate a provider");
    res.json(await deactivateProviderConfig(actor(req), id, parsed.data.reason, metaFrom(req)));
  })
);

paymentsRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
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
  requirePermission("view"),
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
  requirePermission("view"),
  wrap(async (req, res) => {
    const resolved = req.query.resolved === "true" ? true
      : req.query.resolved === "false" ? false : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listUnallocatedPayments(actor(req), { resolved, limit, offset }));
  })
);

// VERSION 3.2 â€” the C.O. Payment Allocation Queue: verified payments
// awaiting manual allocation. Registered before the /:id route.
paymentsRouter.get(
  "/pending",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listPendingAllocations(actor(req), { limit, offset }));
  })
);

// RULE 10.5.3B â€” opening a pending payment shows the locked verified amount,
// the allocation inputs, the running total, what remains, and the financial
// context. It is a read model: opening it never changes the payment.
paymentsRouter.get(
  "/pending/:id",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid payment id");
    res.json(await getAllocationDetail(actor(req), id));
  })
);

const allocateVerifiedSchema = z.object({
  loanId: z.string().regex(UUID_RE, "loanId must be a UUID"),
  repaymentAmount: numericString,
  savingsAmount: numericString,
  note: z.string().max(500).optional().default("")
});

// VERSION 3.2 â€” the C.O. manually allocates an already-verified payment.
// The verified amount is immutable; the submission must satisfy
// Loan Repayment + Savings = Verified Payment exactly. There is no
// endpoint anywhere that lets any human create or alter a payment.
paymentsRouter.post(
  "/:id/allocate",
  requireCompleteSession,
  requirePermission("allocate"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid payment id");
    const parsed = allocateVerifiedSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await allocateVerifiedPayment(actor(req), {
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
  requirePermission("edit"),
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

// Controlled financial correction workflow (RULE 5.6.3 / 11.4.3).
// Finance prepares; only MD, GM or an authorised Auditor approves; the system
// then posts a new linked reversal. No person ever edits a financial record.
const correctionRequestSchema = z.object({
  paymentId: z.string().regex(UUID_RE, "paymentId must be a UUID"),
  reason: z.string().min(10).max(500),
  kind: z.enum(["reversal", "correction"]).optional()
});

paymentsRouter.get(
  "/corrections",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ corrections: await listCorrections(actor(req), status) });
  })
);

paymentsRouter.post(
  "/corrections",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const parsed = correctionRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await requestCorrection(actor(req), parsed.data, metaFrom(req)));
  })
);

const correctionDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(5).max(500)
});

paymentsRouter.post(
  "/corrections/:id/decision",
  requireCompleteSession,
  requirePermission("approve"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid correction request id");
    const parsed = correctionDecisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await decideCorrection(
      actor(req), id, parsed.data.decision, parsed.data.reason, metaFrom(req)
    ));
  })
);

paymentsRouter.get(
  "/:id",
  requireCompleteSession,
  requirePermission("view"),
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
  requirePermission("view"),
  wrap(async (req, res) => {
    const status = req.query.status as "open" | "resolved" | "dismissed" | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listReconciliationItems(actor(req), { status, limit, offset }));
  })
);

const reconciliationActionSchema = z.object({
  note: z.string().max(500).nullable().optional(),
});

// VISION V3.2 â€” Finance / MD group resolves an open exception (Part 2 Â§39).
reconciliationItemsRouter.post(
  "/:id/resolve",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid reconciliation item id");
    const parsed = reconciliationActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await resolveReconciliationItem(actor(req), id, parsed.data.note ?? null, metaFrom(req)));
  })
);

// VISION V3.2 â€” Finance / MD group dismisses an open exception as benign.
reconciliationItemsRouter.post(
  "/:id/dismiss",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid reconciliation item id");
    const parsed = reconciliationActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await dismissReconciliationItem(actor(req), id, parsed.data.note ?? null, metaFrom(req)));
  })
);

webhookExceptionsRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
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
    const { withTenant } = await import("../../db/repo");
  const { insertNotificationsToMds } = await import("../notifications/service");
    const { resolveWebhookEndpoint } = await import("./service");

    const endpointToken = req.params.token ? String(req.params.token) : null;
    let endpointBranchId: string | null = null;

    // RULE 8.6.1-1 - "a manually typed webhook URL, or a screen that lets a
    // person choose which branch a webhook belongs to" is a hard prohibition.
    //
    // This route used to accept /payments/{provider} with the tenant chosen by
    // an X-Nexora-Company header, which is exactly that prohibition: the caller
    // named the tenant. Migration 0090 issued a real non-guessable endpoint to
    // EVERY provider configuration including all pre-existing rows, so no
    // legitimate integration was ever dependent on the header form. The header
    // path is removed rather than deprecated: leaving a caller-selectable tenant
    // reachable is the vulnerability, not the feature.
    if (!endpointToken) {
      res.status(404).json({
        error:
          "unknown webhook endpoint. Webhooks are accepted only at the system-generated " +
          "endpoint configured on the payment provider, never at a provider-named path."
      });
      return;
    }

    // RULE 8.5.1 / 8.5.2 - the endpoint resolves the tenant, branch and
    // provider. A caller cannot name any of them.
    const endpoint = await resolveWebhookEndpoint(endpointToken);
    if (!endpoint) {
      res.status(404).json({ error: "unknown webhook endpoint" });
      return;
    }
    const companyId: string = endpoint.companyId;
    endpointBranchId = endpoint.branchId;
    const provider: string = endpoint.provider;

    const signature = req.header("x-nexora-signature") ?? "";
    if (!signature) {
      res.status(401).json({ error: "missing signature" });
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
        // RULE 4.7.1 â€” a webhook failure is an MD-level event.
        await insertNotificationsToMds(db, companyId, "webhook.failure", {
          provider,
          exception_type: "invalid_signature",
          reason: "signature mismatch"
        });
      });
      res.status(401).json({ error: "invalid signature" });
      return;
    }
return await dispatchVerifiedWebhook(req, res, companyId, provider, bodyString, endpointBranchId);
  } catch (err) {
    next(err);
  }
}

async function dispatchVerifiedWebhook(
  req: Request,
  res: Response,
  companyId: string,
  provider: string,
  bodyString: string,
  endpointBranchId: string | null
): Promise<void> {
  const { withTenant } = await import("../../db/repo");
  const { insertNotificationsToMds } = await import("../notifications/service");
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

// RULE 8.5.2 - the company is resolved from the endpoint (or the legacy header),
// never from a field the caller can choose. Resolving the slug from the
// already-resolved company id means the generated endpoint needs no header at
// all.
const companySlug = await withTenant(companyId, null, async (db) => {
    const r = await db.query<{ slug: string }>(`SELECT slug FROM companies WHERE id=$1`, [companyId]);
    return r.rows[0]?.slug ?? "";
  });

  // RULE 8.5.2 / RULE 8.5.4A - a payload that names a virtual account or
  // customer belonging to a DIFFERENT branch must be rejected as not belonging
  // to this endpoint, and no record may be written to that other branch. The
  // endpoint's branch is the fact; the payload is checked against it.
  if (endpointBranchId) {
    const accountNumber = String(body.transaction.account_number ?? "");
    if (accountNumber) {
      const vaOwner = await withTenant(companyId, null, async (db) => {
        const r = await db.query<{ branch_id: string }>(
          `SELECT branch_id FROM virtual_accounts
            WHERE company_id=$1 AND account_number=$2
            ORDER BY created_at DESC LIMIT 1`,
          [companyId, accountNumber]
        );
        return r.rows[0]?.branch_id ?? null;
      });
      if (vaOwner && vaOwner !== endpointBranchId) {
        await withTenant(companyId, null, async (db) => {
          await db.query(
            `INSERT INTO webhook_exceptions
               (company_id, branch_id, provider, exception_type, raw_payload, detail)
             VALUES ($1,$2,$3,'cross_branch_payload',$4::jsonb,$5::jsonb)`,
            [companyId, endpointBranchId, provider, bodyString,
             JSON.stringify({
               reason: "virtual account belongs to another branch than this webhook endpoint",
               endpoint_branch_id: endpointBranchId,
               account_branch_id: vaOwner
             })]
          );
          await db.query(
            `INSERT INTO audit_logs (company_id, branch_id, action, entity_type, reason)
             VALUES ($1,$2,'webhook.cross_branch_rejected','webhook_exceptions',$3)`,
            [companyId, endpointBranchId,
             `account ${accountNumber} belongs to branch ${vaOwner}`]
          );
          await insertNotificationsToMds(db, companyId, "webhook.failure", {
            provider,
            exception_type: "cross_branch_payload",
            reason: "virtual account belongs to another branch than this webhook endpoint"
          });
        });
        res.status(422).json({ error: "account does not belong to this webhook endpoint" });
        return;
      }
    }
  }

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
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO webhook_events
         (company_id, provider, provider_event_id, signature_valid, payload,
          processing_status)
       SELECT $1,$2,$3,true,$4::jsonb,'accepted'
       WHERE NOT EXISTS (
         SELECT 1 FROM webhook_events
          WHERE company_id=$1 AND provider=$2
            AND provider_event_id=$3
       )
       RETURNING id`,
      [companyId, provider, event.providerEventId, bodyString]
    );
    // Idempotent re-delivery: the event already exists, so reuse it.
    const eventId = inserted.rows[0]?.id ?? (
      await db.query<{ id: string }>(
        `SELECT id FROM webhook_events
          WHERE company_id=$1 AND provider=$2 AND provider_event_id=$3`,
        [companyId, provider, event.providerEventId]
      )
    ).rows[0]?.id;

    // The payment this webhook produced or acted on. A reversal links back to
    // the ORIGINAL payment; a forward/deduplicated event links to the payment
    // it created or matched.
    const targetPaymentId =
      (outcome && "paymentId" in outcome && outcome.paymentId) ||
      (outcome && "originalPaymentId" in outcome ? outcome.originalPaymentId : null);

    if (eventId && targetPaymentId) {
      // Link every money movement back through the webhook that triggered it
      // (traceability chain navigable from either end).
      await db.query(
        `UPDATE webhook_events SET payment_id=$1 WHERE id=$2`,
        [targetPaymentId, eventId]
      );
      await db.query(
        `UPDATE payments SET webhook_event_id=$1 WHERE id=$2`,
        [eventId, targetPaymentId]
      );
    }
  });

  res.status(200).json({ ok: true, outcome });
}

/**
 * RULE 8.5.1 - THE webhook endpoint. It carries an opaque token minted by the
 * system when the provider became Active; that token alone determines the
 * company, branch and provider. Nobody types it, nobody chooses the binding, and
 * it cannot be guessed (RULE 8.6.1-1).
 */
webhookRouter.post(
  "/payments/endpoint/:token",
  raw({ type: "*/*", limit: "1mb" }),
  handlePaymentWebhook
);
