import type pg from "pg";
import { withBypass, withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { decryptCompanySecret, encryptCompanySecret, maskSecret } from "../../lib/ai-secret-vault";
import {
  executeThroughOpenCode,
  openCodeFreeModels,
  openCodeProviderModels,
  secretFingerprint,
  verifyThroughOpenCode,
  type OpenCodeModelRef,
  type OpenCodeProviderRef
} from "../../lib/opencode";
import { TenantExecutionContext, tenantLimiter } from "../../lib/tenant-execution";

/**
 * RULE 21.1.9 - 21.1.13: the company AI configuration lifecycle.
 *
 * A configuration is created unverified, is verified for real, and only then
 * may be activated. Until it is activated the previously active verified
 * configuration remains active, so a failed attempt can never take a company
 * offline. The active configuration is the only thing the company-side
 * execution path reads, which is what makes the selection real rather than
 * decorative.
 */

export type VerificationState = "unverified" | "verified" | "failed" | "revoked";

export interface CompanyAiConfigurationRow {
  id: string;
  company_id: string;
  provider_id: string;
  model_id: string;
  api_key_encrypted: string | null;
  api_key_fingerprint: string | null;
  verification_state: VerificationState;
  verification_detail: Record<string, unknown>;
  verified_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** The shape any API returns. The secret itself is never part of it. */
export interface CompanyAiConfigurationView {
  id: string;
  companyId: string;
  provider: string;
  model: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  verificationState: VerificationState;
  verificationFailure: string | null;
  verifiedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function toView(row: CompanyAiConfigurationRow): CompanyAiConfigurationView {
  const detail = row.verification_detail ?? {};
  return {
    id: row.id,
    companyId: row.company_id,
    provider: row.provider_id,
    model: row.model_id,
    hasApiKey: row.api_key_encrypted !== null,
    apiKeyMasked: maskSecret(row.api_key_fingerprint ? "configured-secret" : null),
    verificationState: row.verification_state,
    verificationFailure:
      typeof detail.failure === "string" ? detail.failure : null,
    verifiedAt: row.verified_at ? row.verified_at.toISOString() : null,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

async function loadActiveConfiguration(
  db: pg.PoolClient,
  companyId: string
): Promise<CompanyAiConfigurationRow | null> {
  const row = await db.query<CompanyAiConfigurationRow>(
    `SELECT * FROM company_ai_configurations
      WHERE company_id=$1 AND is_active
      LIMIT 1`,
    [companyId]
  );
  return row.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Platform Owner surfaces
// ---------------------------------------------------------------------------

/** RULE 21.2.2 - the live free-model list, straight from OpenCode. */
export async function listFreeModels(): Promise<{
  models: OpenCodeModelRef[];
  fetchedAt: string;
  source: "opencode";
}> {
  const models = await openCodeFreeModels();
  return { models, fetchedAt: new Date().toISOString(), source: "opencode" };
}

/** RULE 21.2.3 - the live provider catalogue, straight from OpenCode. */
export async function listProviders(): Promise<{
  providers: OpenCodeProviderRef[];
  fetchedAt: string;
  source: "opencode";
}> {
  const { openCodeCatalogue } = await import("../../lib/opencode");
  const catalogue = await openCodeCatalogue();
  return { providers: catalogue.providers, fetchedAt: catalogue.fetchedAt, source: "opencode" };
}

/** RULE 21.2.4 - the live model list for the selected provider. */
export async function listProviderModels(
  provider: string
): Promise<{ provider: string; models: OpenCodeModelRef[]; fetchedAt: string; source: "opencode" }> {
  const result = await openCodeProviderModels(provider);
  return { ...result, source: "opencode" };
}

/**
 * RULE 21.2.1 - the exact AI MODEL interface contract.
 *
 * The labels and explanatory text are fixed by the Vision and are served from
 * here so a screen cannot rename, reorder or reword them, while the contents
 * of the two lists behind them stay dynamic (RULE 21.2.2, 21.2.3, 21.2.4).
 * Nothing here hard-codes a provider or a model.
 */
export const AI_MODEL_INTERFACE = {
  heading: "AI MODEL",
  freeModelsSection: "FREE MODELS",
  freeModelsNote:
    "The free-model list is populated from what OpenCode currently reports as genuinely available. It is not a fixed catalogue.",
  divider: true,
  providerSection: "API PROVIDER",
  providerLabel: "Provider",
  providerPlaceholder: "[ Select API Provider ]",
  apiKeyLabel: "API Key",
  apiKeyMaskedPlaceholder: "[ masked ]",
  apiKeyNote: "This key is stored locally and only used to make API requests from this application.",
  modelLabel: "Model",
  modelPlaceholder: "[ Select Model ]",
  modelNote: "The application automatically fetches the latest available models from the selected provider.",
  actions: [
    { id: "verify", label: "Verify", position: "left" },
    { id: "done", label: "Done", position: "right" }
  ]
} as const;

async function auditPlatform(
  db: pg.PoolClient,
  poEmail: string,
  companyId: string | null,
  action: string,
  detail: Record<string, unknown>
): Promise<void> {
  await db.query(
    `INSERT INTO platform_audit_logs
       (actor, action, company_id, new_value, reason)
     VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [poEmail, action, companyId, JSON.stringify(detail), `RULE 21.1 platform AI configuration: ${action}`]
  );
}

/**
 * RULE 21.1.13 - a new configuration never replaces the active one until it has
 * been verified for real. Creating it only records the selection.
 */
export async function createConfiguration(
  poEmail: string,
  companyId: string,
  input: { provider: string; model: string; apiKey?: string | null }
): Promise<CompanyAiConfigurationView> {
  if (!input.provider?.trim()) throw AppError.unprocessable("provider is required");
  if (!input.model?.trim()) throw AppError.unprocessable("model is required");

  // The selection must be one OpenCode actually offers, or it is not a
  // selection at all (RULE 21.1.7, RULE 21.2.4).
  const available = await openCodeProviderModels(input.provider.trim());
  const ref = input.model.includes("/") ? input.model.trim() : `${input.provider.trim()}/${input.model.trim()}`;
  if (!available.models.some((m) => m.ref === ref)) {
    throw AppError.unprocessable(
      `${ref} is not currently offered by ${input.provider.trim()} through OpenCode`
    );
  }

  return withBypass(async (db) => {
    const company = await db.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM companies WHERE id=$1`, [companyId]
    );
    if ((company.rowCount ?? 0) === 0) throw AppError.notFound("Company not found");

    const modelId = ref.slice(ref.indexOf("/") + 1);
    const inserted = await db.query<CompanyAiConfigurationRow>(
      `INSERT INTO company_ai_configurations
         (company_id, provider_id, model_id, api_key_encrypted, api_key_fingerprint,
          verification_state, verification_detail, is_active, created_by_platform_owner)
       VALUES ($1,$2,$3,$4,$5,'unverified','{}'::jsonb,false,
               (SELECT id FROM platform_owners WHERE email=$6))
       RETURNING *`,
      [
        companyId,
        input.provider.trim(),
        modelId,
        input.apiKey ? encryptCompanySecret(companyId, input.apiKey) : null,
        secretFingerprint(input.apiKey),
        poEmail
      ]
    );
    const row = inserted.rows[0]!;
    await auditPlatform(db, poEmail, companyId, "ai.configuration_created", {
      configurationId: row.id,
      provider: row.provider_id,
      model: row.model_id
    });
    return toView(row);
  });
}

/**
 * RULE 21.1.12 - real verification through the real OpenCode integration.
 * The stored state only ever becomes 'verified' from a real success.
 */
export async function verifyConfiguration(
  poEmail: string,
  configurationId: string
): Promise<CompanyAiConfigurationView> {
  const existing = await withBypass(async (db) => {
    const row = await db.query<CompanyAiConfigurationRow>(
      `SELECT * FROM company_ai_configurations WHERE id=$1`, [configurationId]
    );
    if ((row.rowCount ?? 0) === 0) throw AppError.notFound("AI configuration not found");
    return row.rows[0]!;
  });

  const apiKey = existing.api_key_encrypted
    ? decryptCompanySecret(existing.company_id, existing.api_key_encrypted)
    : null;

  const outcome = await verifyThroughOpenCode({
    provider: existing.provider_id,
    model: existing.model_id,
    apiKey,
    tenantLabel: `company:${existing.company_id}`
  });

  return withBypass(async (db) => {
    const updated = await db.query<CompanyAiConfigurationRow>(
      `UPDATE company_ai_configurations
          SET verification_state = $2,
              verification_detail = $3::jsonb,
              verified_at = CASE WHEN $2='verified' THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id=$1
        RETURNING *`,
      [
        configurationId,
        outcome.ok ? "verified" : "failed",
        JSON.stringify({
          failure: outcome.failure,
          latencyMs: outcome.latencyMs,
          checkedAt: outcome.checkedAt,
          verifiedThrough: "opencode"
        })
      ]
    );
    const row = updated.rows[0]!;
    await auditPlatform(db, poEmail, row.company_id, outcome.ok ? "ai.configuration_verified" : "ai.configuration_verification_failed", {
      configurationId,
      provider: row.provider_id,
      model: row.model_id,
      failure: outcome.failure
    });
    return toView(row);
  });
}

/**
 * RULE 21.2.7 - Done. Activation is refused unless the configuration is
 * genuinely verified, and exactly one configuration per company can be active
 * (the database enforces it too).
 */
export async function activateConfiguration(
  poEmail: string,
  configurationId: string
): Promise<CompanyAiConfigurationView> {
  return withBypass(async (db) => {
    const row = await db.query<CompanyAiConfigurationRow>(
      `SELECT * FROM company_ai_configurations WHERE id=$1 FOR UPDATE`, [configurationId]
    );
    if ((row.rowCount ?? 0) === 0) throw AppError.notFound("AI configuration not found");
    const current = row.rows[0]!;
    if (current.verification_state !== "verified") {
      throw AppError.conflict(
        "This configuration has not passed a real verification, so it cannot become the company's active AI"
      );
    }
    await db.query(
      `UPDATE company_ai_configurations SET is_active=false, updated_at=now()
        WHERE company_id=$1 AND is_active`,
      [current.company_id]
    );
    const activated = await db.query<CompanyAiConfigurationRow>(
      `UPDATE company_ai_configurations
          SET is_active=true, updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [configurationId]
    );
    const next = activated.rows[0]!;
    await auditPlatform(db, poEmail, next.company_id, "ai.configuration_activated", {
      configurationId,
      provider: next.provider_id,
      model: next.model_id
    });
    return toView(next);
  });
}

/** RULE 21.1.13 - an authorised removal path, audited, never silent. */
export async function revokeConfiguration(
  poEmail: string,
  companyId: string,
  configurationId: string,
  reason: string
): Promise<{ revoked: number; active: CompanyAiConfigurationView | null }> {
  return withBypass(async (db) => {
    const row = await db.query<CompanyAiConfigurationRow>(
      `SELECT * FROM company_ai_configurations WHERE id=$1 AND company_id=$2`,
      [configurationId, companyId]
    );
    if ((row.rowCount ?? 0) === 0) throw AppError.notFound("AI configuration not found");
    const current = row.rows[0]!;
    await db.query(
      `UPDATE company_ai_configurations
          SET is_active=false, verification_state='revoked', updated_at=now()
        WHERE id=$1`,
      [configurationId]
    );
    await auditPlatform(db, poEmail, companyId, "ai.configuration_revoked", {
      configurationId,
      provider: current.provider_id,
      model: current.model_id,
      reason
    });
    const active = await loadActiveConfiguration(db, companyId);
    return { revoked: 1, active: active ? toView(active) : null };
  });
}

export async function listCompanyConfigurations(
  poEmail: string,
  companyId: string
): Promise<{ active: CompanyAiConfigurationView | null; configurations: CompanyAiConfigurationView[] }> {
  void poEmail;
  return withBypass(async (db) => {
    const rows = await db.query<CompanyAiConfigurationRow>(
      `SELECT * FROM company_ai_configurations WHERE company_id=$1 ORDER BY created_at DESC`,
      [companyId]
    );
    const active = rows.rows.find((r) => r.is_active) ?? null;
    return {
      active: active ? toView(active) : null,
      configurations: rows.rows.map(toView)
    };
  });
}

// ---------------------------------------------------------------------------
// Company-side surface
// ---------------------------------------------------------------------------

/**
 * RULE 21.2.5 / RULE 21.2.9 - what a company user may see about the AI
 * configuration: which provider and model the company runs on, whether a key
 * is configured (masked), and the verification state. Persisted server-side, so
 * it survives reloads and restarts, and readable only inside that company.
 */
export async function describeActiveConfiguration(
  actor: { companyId: string }
): Promise<CompanyAiConfigurationView | null> {
  return withTenant(actor.companyId, null, async (db) => {
    const row = await loadActiveConfiguration(db, actor.companyId);
    return row ? toView(row) : null;
  });
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface AiExecutionRequest {
  question: string;
  /** Authorised, already-scoped grounding the model must answer from. */
  context: {
    label: string;
    facts: Array<Record<string, unknown>>;
    citations: Array<Record<string, unknown>>;
  };
}

export interface AiExecutionOutcome {
  configurationId: string;
  provider: string;
  model: string;
  answer: string;
  citations: Array<Record<string, unknown>>;
  sessionId: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

const SYSTEM_PROMPT = [
  "You are the read-only assistant inside a microfinance operating system.",
  "Answer only from the RECORDS supplied to you. They are the authorised records for the person asking.",
  "If the records do not contain the answer, say exactly that the data is not available to you.",
  "Never invent a customer, a balance, a figure, a policy or an outcome.",
  "Never suggest or perform a change to any record: you are read-only.",
  "Quote figures exactly as they appear. Keep the answer short and factual."
].join(" ");

/**
 * RULE 21.1.9 / RULE 21.3.1 - a request resolves the CALLER's company and uses
 * that company's persisted configuration, inside that company's tenant
 * context. There is no path from this function to another company's
 * configuration, secret or records.
 */
export async function runCompanyAi(
  actor: { sub: string; companyId: string; branchId: string | null },
  request: AiExecutionRequest,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<AiExecutionOutcome> {
  const question = request.question?.trim();
  if (!question || question.length > 2000) {
    throw AppError.unprocessable("question must be between 1 and 2000 characters");
  }

  const started = Date.now();
  const configuration = await withTenant(actor.companyId, actor.branchId, async (db) => {
    const row = await loadActiveConfiguration(db, actor.companyId);
    if (!row) {
      throw AppError.conflict(
        "This company has no active, verified AI configuration, so no AI answer can be produced"
      );
    }
    if (row.verification_state !== "verified") {
      throw AppError.conflict(
        "This company's AI configuration is not verified, so no AI answer can be produced"
      );
    }
    return row;
  });

  // RULE 21.3.3 / RULE 3.8.2 - the secret is resolved inside this company's
  // execution context and handed to exactly one child process.
  const context = TenantExecutionContext.forCompany(
    configuration.company_id,
    async () =>
      configuration.api_key_encrypted
        ? decryptCompanySecret(configuration.company_id, configuration.api_key_encrypted)
        : null,
    { branchId: actor.branchId, lane: `ai:${configuration.provider_id}` }
  );
  const secret = await context.secret();

  // The grounding handed to the model is the caller's authorised records only.
  const facts = JSON.stringify(request.context.facts, null, 1).slice(0, 60_000);
  const prompt = [
    `Question from ${request.context.label}:`,
    question,
    "",
    "AUTHORISED RECORDS (JSON):",
    facts
  ].join("\n");

  try {
    const run = await tenantLimiter.run(context.scope, () =>
      executeThroughOpenCode({
        provider: configuration.provider_id,
        model: configuration.model_id,
        apiKey: secret,
        system: SYSTEM_PROMPT,
        prompt,
        tenantLabel: `company:${actor.companyId}`
      })
    );
    const latencyMs = Date.now() - started;
    await recordExecution(actor, configuration, question, run.text, request.context.citations, {
      outcome: "answered",
      sessionId: run.sessionId,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: run.costUsd,
      latencyMs
    });
    void meta;
    return {
      configurationId: configuration.id,
      provider: run.provider,
      model: run.model,
      answer: run.text,
      citations: request.context.citations,
      sessionId: run.sessionId,
      latencyMs,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: run.costUsd
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    // RULE 21.1.14 - the real failure is recorded. Nothing is substituted, and
    // no other provider or model is tried in its place.
    await recordExecution(actor, configuration, question, "", request.context.citations, {
      outcome: "failed",
      failureReason: message.slice(0, 500),
      latencyMs
    }).catch(() => undefined);
    throw err;
  }
}

async function recordExecution(
  actor: { sub: string; companyId: string; branchId: string | null },
  configuration: CompanyAiConfigurationRow,
  question: string,
  answer: string,
  citations: Array<Record<string, unknown>>,
  extra: {
    outcome: "answered" | "failed" | "refused";
    failureReason?: string | null;
    sessionId?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsd?: number | null;
    latencyMs: number;
  }
): Promise<void> {
  await withTenant(actor.companyId, actor.branchId, async (db) => {
    await db.query(
      `INSERT INTO company_ai_executions
         (company_id, branch_id, configuration_id, actor_user_id, provider_id, model_id,
          question, answer, citations, outcome, failure_reason, session_id,
          input_tokens, output_tokens, cost_usd, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)`,
      [
        actor.companyId,
        actor.branchId,
        configuration.id,
        actor.sub,
        configuration.provider_id,
        configuration.model_id,
        question,
        answer,
        JSON.stringify(citations),
        extra.outcome,
        extra.failureReason ?? null,
        extra.sessionId ?? null,
        extra.inputTokens ?? null,
        extra.outputTokens ?? null,
        extra.costUsd ?? null,
        extra.latencyMs
      ]
    );
  });
}
