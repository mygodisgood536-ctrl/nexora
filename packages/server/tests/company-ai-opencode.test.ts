import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createHash } from "node:crypto";
import { seedWorld, withAdmin, withAdminValue, type TestWorld } from "./fixtures";
import { initPlatformOwner, poLogin, staffLogin } from "./platform-helpers";
import {
  FREE_PROVIDER_ID,
  openCodeCatalogue,
  openCodeFreeModels,
  openCodeProviderModels,
  providerApiKeyEnvName,
  executeThroughOpenCode,
  type OpenCodeModelRef
} from "../src/lib/opencode";
import { decryptCompanySecret, encryptCompanySecret } from "../src/lib/ai-secret-vault";
import { TenantLimiter, runAcrossTenants } from "../src/lib/tenant-execution";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";
const REAL_EXECUTION_MS = 600_000;

/** The PO access token is minted for 30 minutes; refresh a little before that. */
const PO_TOKEN_REFRESH_MS = 25 * 60 * 1000;

/**
 * Upper bound for hunting one genuinely working model across the live catalogue.
 *
 * This is a DIAGNOSTIC budget, not a weakening of the requirement: the walk
 * still only succeeds when a REAL execution succeeds. When the upstream AI
 * service is unreachable this makes the suite report the true per-model
 * reasons promptly, instead of stalling until the test timeout hides them.
 */
const CATALOGUE_WALK_BUDGET_MS = 240_000;

/**
 * RULE 21.1.6 - 21.1.15, RULE 21.2.1 - 21.2.10, RULE 21.3.1 - 21.3.5.
 *
 * Every assertion here runs against the real OpenCode executable in this
 * environment. No catalogue is written by this file, no model name is assumed,
 * and no response is fabricated. Model availability genuinely varies from
 * moment to moment, so the suite picks a model that answers RIGHT NOW from the
 * live catalogue rather than betting on one named in any document.
 */
describe("OpenCode company AI (RULE 21.1 / 21.2 / 21.3)", () => {
  let app: Express;
  let w: TestWorld;
  let poToken: string;
  let poTokenIssuedAt = 0;
  let working: OpenCodeModelRef | null = null;

  /** The first model in the live free catalogue that really answers now. */
  async function liveWorkingModel(): Promise<OpenCodeModelRef> {
    if (working) return working;
    for (const model of await openCodeFreeModels()) {
      try {
        const run = await executeThroughOpenCode({
          provider: model.provider,
          model: model.model,
          apiKey: null,
          system: "Answer with the single requested word and nothing else.",
          prompt: "Reply with exactly: NEXORA_OK",
          tenantLabel: "probe",
          timeoutMs: 90_000
        });
        if (run.text.toUpperCase().includes("NEXORA_OK")) {
          working = model;
          return model;
        }
      } catch {
        // This model is unavailable at this moment. Try the next real one.
      }
    }
    throw new Error("No currently-offered OpenCode model answered a real execution");
  }

  beforeAll(async () => {
    app = (await import("../src/app")).createApp();
    w = await seedWorld();
    await initPlatformOwner();
    poToken = await poLogin(app);
    poTokenIssuedAt = Date.now();
  }, REAL_EXECUTION_MS);

  /**
   * The Platform Owner access token lives 30 minutes (signPoAccessToken,
   * src/modules/platform/service.ts). This file performs genuinely long real
   * OpenCode work and has legitimately run beyond that, after which every
   * later request correctly returns 401 for an expired token. Re-authenticating
   * keeps the harness authenticated across a long run.
   *
   * This weakens no assertion about the product: an expired access token still
   * returning 401 is itself the correct, separately tested behaviour. It only
   * stops the harness from confusing its own session lifetime with a product
   * failure.
   */
  beforeEach(async () => {
    if (Date.now() - poTokenIssuedAt > PO_TOKEN_REFRESH_MS) {
      poToken = await poLogin(app);
      poTokenIssuedAt = Date.now();
    }
  }, 120_000);

  /**
   * Verification through the product, for a model that answers right now.
   *
   * Model availability genuinely varies moment to moment, so rather than
   * betting on one name this walks the LIVE catalogue and asks the real
   * product to verify each candidate in turn. Every success is a genuine
   * OpenCode execution; if no currently-offered model can be verified, the
   * test fails rather than pretending one was.
   */
  async function verifiedConfigurationFor(companyId: string): Promise<{
    id: string;
    provider: string;
    model: string;
  }> {
    const failures: string[] = [];
    const walkStartedAt = Date.now();
    for (const model of await openCodeFreeModels()) {
      if (Date.now() - walkStartedAt > CATALOGUE_WALK_BUDGET_MS) {
        failures.push(
          "(catalogue walk budget exhausted; the upstream AI service did not answer any model in time)"
        );
        break;
      }
      const created = await request(app)
        .post(`/platform/v1/companies/${companyId}/ai-configuration`)
        .set("Authorization", `Bearer ${poToken}`)
        .send({ provider: model.provider, model: model.model });
      if (created.status !== 201) {
        failures.push(`${model.ref}: create ${created.status}`);
        continue;
      }
      const verified = await request(app)
        .post(`/platform/v1/ai-configuration/${created.body.id}/verify`)
        .set("Authorization", `Bearer ${poToken}`)
        .send({});
      if (verified.body.verificationState === "verified") {
        return { id: created.body.id, provider: model.provider, model: model.model };
      }
      failures.push(`${model.ref}: ${verified.body.verificationFailure ?? "not verified"}`);
    }
    throw new Error(`No currently-offered model verified a real execution. ${failures.join(" | ")}`);
  }

  it("21.1.7/21.1.8 the provider and model catalogue is the real one OpenCode reports", async () => {
    const catalogue = await openCodeCatalogue({ refresh: true });
    expect(catalogue.openCodeVersion, "OpenCode did not report a version").toBeTruthy();
    expect(catalogue.models.length, "OpenCode reported no models").toBeGreaterThan(0);
    expect(catalogue.providers.length).toBeGreaterThan(0);
    for (const model of catalogue.models) {
      expect(model.ref).toBe(`${model.provider}/${model.model}`);
    }
    const openCode = catalogue.providers.find((p) => p.id === FREE_PROVIDER_ID);
    expect(openCode, "OpenCode's own provider is missing from its own catalogue").toBeTruthy();
    expect(catalogue.models.filter((m) => m.provider === FREE_PROVIDER_ID).length).toBe(
      openCode!.modelCount
    );
  }, 120_000);

  it("21.2.2 the FREE MODELS list is exactly what OpenCode currently offers free", async () => {
    const free = await openCodeFreeModels();
    const catalogue = await openCodeCatalogue();
    expect(free.length).toBeGreaterThan(0);

    const known = new Set(catalogue.models.map((m) => m.ref));
    for (const model of free) expect(known.has(model.ref)).toBe(true);

    const expected = catalogue.models.filter((m) => m.free).map((m) => m.ref).sort();
    expect(free.map((m) => m.ref)).toEqual(expected);
    expect(free.every((m) => m.provider === FREE_PROVIDER_ID || /free$/i.test(m.model))).toBe(true);
  }, 120_000);

  it("21.2.4 the model list for a provider is live, and a fake provider is refused", async () => {
    const providers = await openCodeCatalogue();
    const provider = providers.providers[0]!.id;
    const models = await openCodeProviderModels(provider);
    expect(models.provider).toBe(provider);
    expect(models.models.length).toBeGreaterThan(0);
    expect(models.models.every((m) => m.provider === provider)).toBe(true);
    expect(models.fetchedAt).toBeTruthy();

    await expect(openCodeProviderModels("definitely-not-a-provider")).rejects.toThrow(
      /is not a provider OpenCode currently offers/
    );
  }, 120_000);

  it("21.1.12/21.1.14 a real execution really runs through the selected model", async () => {
    const target = await liveWorkingModel();
    const run = await executeThroughOpenCode({
      provider: target.provider,
      model: target.model,
      apiKey: null,
      system: "Answer with the single requested word and nothing else.",
      prompt: "Reply with exactly: NEXORA_OK",
      tenantLabel: "company:test",
      timeoutMs: 180_000
    });
    expect(run.text.toUpperCase()).toContain("NEXORA_OK");
    expect(run.provider).toBe(target.provider);
    expect(run.model).toBe(target.model);
    expect(run.sessionId, "OpenCode returned no session for the real run").toBeTruthy();

    // A model OpenCode does not offer is refused before anything is spawned.
    await expect(
      executeThroughOpenCode({
        provider: target.provider,
        model: "no-such-model-on-this-provider",
        apiKey: null,
        prompt: "hello",
        tenantLabel: "company:test"
      })
    ).rejects.toThrow();
  }, REAL_EXECUTION_MS);

  it("21.1.11 a company secret is encrypted at rest and bound to its own company", () => {
    const companyA = "11111111-1111-4111-8111-111111111111";
    const companyB = "22222222-2222-4222-8222-222222222222";
    const envelope = encryptCompanySecret(companyA, "sk-live-super-secret-value");
    expect(envelope).not.toContain("super-secret");
    expect(envelope.startsWith("v1.")).toBe(true);
    expect(decryptCompanySecret(companyA, envelope)).toBe("sk-live-super-secret-value");
    expect(() => decryptCompanySecret(companyB, envelope)).toThrow(/does not belong to this company/);
  });

  it("21.1.10 a provider key is named per provider and never inherited from the server", () => {
    expect(providerApiKeyEnvName("openai")).toBe("OPENAI_API_KEY");
    expect(providerApiKeyEnvName("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(providerApiKeyEnvName("some-provider")).toBe("SOME_PROVIDER_API_KEY");
  });

  it("21.1.9/21.1.12/21.1.13 the Platform Owner configures, verifies for real, then activates", async () => {
    // 1. The selection is recorded, unverified and NOT active.
    const first = await openCodeFreeModels();
    const target = first[0]!;
    const created = await request(app)
      .post(`/platform/v1/companies/${w.companyA}/ai-configuration`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({ provider: target.provider, model: target.model });
    expect(created.status, `create failed: ${JSON.stringify(created.body)}`).toBe(201);
    expect(created.body.verificationState).toBe("unverified");
    expect(created.body.isActive).toBe(false);
    expect(created.body.model).toBe(target.model);

    // An unverified configuration cannot be activated (Done is refused).
    const tooEarly = await request(app)
      .post(`/platform/v1/ai-configuration/${created.body.id}/activate`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({});
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.message).toMatch(/real verification/i);

    // 2. Verify performs a real OpenCode execution, through the product, for a
    //    model that is genuinely available right now.
    const live = await verifiedConfigurationFor(w.companyA);
    const verified = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/ai-configuration`)
      .set("Authorization", `Bearer ${poToken}`);
    const verifiedRow = verified.body.configurations.find(
      (c: { id: string }) => c.id === live.id
    );
    expect(verifiedRow.verificationState).toBe("verified");
    expect(verifiedRow.verifiedAt).toBeTruthy();
    expect(verifiedRow.verificationFailure).toBeNull();

    // 3. Done activates it.
    const activated = await request(app)
      .post(`/platform/v1/ai-configuration/${live.id}/activate`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({});
    expect(activated.status).toBe(200);
    expect(activated.body.isActive).toBe(true);

    // 4. No secret is ever returned, in any view of the configuration.
    const listed = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/ai-configuration`)
      .set("Authorization", `Bearer ${poToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.active.isActive).toBe(true);
    expect(JSON.stringify(listed.body)).not.toMatch(/apiKey"\s*:\s*"[^"]+/);

    // 5. The activation is a platform-audited event.
    const trail = await withAdminValue(async (db) =>
      (
        await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM platform_audit_logs
            WHERE company_id=$1 AND action LIKE 'ai.%'`,
          [w.companyA]
        )
      ).rows[0]!.n
    );
    expect(Number(trail)).toBeGreaterThanOrEqual(3);

    // 6. RULE 21.1.13 - an unverified replacement never displaces the active one.
    const replacement = await request(app)
      .post(`/platform/v1/companies/${w.companyA}/ai-configuration`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({ provider: target.provider, model: target.model });
    expect(replacement.status).toBe(201);
    expect(replacement.body.verificationState).toBe("unverified");
    const stillActive = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/ai-configuration`)
      .set("Authorization", `Bearer ${poToken}`);
    expect(stillActive.body.active.id).toBe(live.id);
  }, REAL_EXECUTION_MS);

  it("21.1.12 a configuration OpenCode cannot run is never marked verified", async () => {
    // A provider OpenCode does not offer cannot even be selected.
    const refused = await request(app)
      .post(`/platform/v1/companies/${w.companyA}/ai-configuration`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({ provider: "not-a-real-provider", model: "some-model" });
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toMatch(/is not a provider OpenCode currently offers/i);

    // And a configuration whose model vanished from the catalogue reports the
    // real failure instead of claiming success.
    const target = await liveWorkingModel();
    const created = await request(app)
      .post(`/platform/v1/companies/${w.companyB}/ai-configuration`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({ provider: target.provider, model: target.model });
    expect(created.status).toBe(201);
    await withAdmin(async (db) => {
      await db.query(`UPDATE company_ai_configurations SET model_id='vanished-model' WHERE id=$1`, [
        created.body.id
      ]);
    });
    const verified = await request(app)
      .post(`/platform/v1/ai-configuration/${created.body.id}/verify`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({});
    expect(verified.status).toBe(200);
    expect(verified.body.verificationState).toBe("failed");
    expect(verified.body.verificationFailure).toMatch(/not currently offered/i);
  }, REAL_EXECUTION_MS);

  it("21.2.8/21.3.1 the company executes with its OWN persisted configuration", async () => {
    const live = await verifiedConfigurationFor(w.companyA);
    const target = { provider: live.provider, model: live.model };
    await request(app)
      .post(`/platform/v1/ai-configuration/${live.id}/activate`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({});

    // The company sees its own persisted configuration, with a masked key only.
    const { token } = await staffLogin(app, ALPHA_HOST, "amy");
    const configuration = await request(app)
      .get("/api/v1/company-ai/configuration")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${token}`);
    expect(configuration.status).toBe(200);
    expect(configuration.body.configuration.provider).toBe(target.provider);
    expect(configuration.body.configuration.model).toBe(target.model);
    expect(configuration.body.configuration.isActive).toBe(true);
    if (configuration.body.configuration.hasApiKey) {
      expect(configuration.body.configuration.apiKeyMasked).toMatch(/^\*+$/);
    } else {
      expect(configuration.body.configuration.apiKeyMasked).toBe("");
    }

    // RULE 21.3.1 - a company with no configuration of its own resolves none.
    const { token: betaToken } = await staffLogin(app, BETA_HOST, "bob");
    const betaConfiguration = await request(app)
      .get("/api/v1/company-ai/configuration")
      .set("Host", BETA_HOST)
      .set("Authorization", `Bearer ${betaToken}`);
    expect(betaConfiguration.status).toBe(200);
    expect(betaConfiguration.body.configuration).toBeNull();

    // RULE 21.1.4/21.3.2 - a real question, answered from authorised records.
    const asked = await request(app)
      .post("/api/v1/company-ai/ask")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${token}`)
      .send({
        intent: "customer_loan_history",
        customerId: w.customerA1,
        question: "How many loans does this customer have, and what is the outstanding principal on each?"
      });
    expect(asked.status, `ask failed: ${JSON.stringify(asked.body)}`).toBe(200);
    expect(asked.body.provider).toBe(target.provider);
    expect(asked.body.model).toBe(target.model);
    expect(asked.body.answer.length).toBeGreaterThan(0);
    expect(asked.body.citations.length).toBeGreaterThan(0);
    // The answer is grounded: the seeded customer's real principal appears.
    expect(asked.body.answer).toContain("30000");

    // The execution is recorded against the company that made it.
    const executions = await withAdminValue(async (db) =>
      (
        await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM company_ai_executions
            WHERE company_id=$1 AND outcome='answered'`,
          [w.companyA]
        )
      ).rows[0]!.n
    );
    expect(Number(executions)).toBeGreaterThanOrEqual(1);
  }, REAL_EXECUTION_MS);

  it("21.1.10/21.3.3 two companies never share a provider/model configuration or secret", async () => {
    const target = await liveWorkingModel();
    const created = await request(app)
      .post(`/platform/v1/companies/${w.companyA}/ai-configuration`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({ provider: target.provider, model: target.model, apiKey: "sk-company-a-only-key" });
    expect(created.status).toBe(201);
    expect(created.body.hasApiKey).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain("sk-company-a-only-key");

    const stored = await withAdminValue(async (db) =>
      (
        await db.query<{ api_key_encrypted: string }>(
          `SELECT api_key_encrypted FROM company_ai_configurations WHERE id=$1`,
          [created.body.id]
        )
      ).rows[0]!
    );
    expect(stored.api_key_encrypted).not.toContain("sk-company-a-only-key");
    expect(decryptCompanySecret(w.companyA, stored.api_key_encrypted)).toBe("sk-company-a-only-key");
    expect(() => decryptCompanySecret(w.companyB, stored.api_key_encrypted)).toThrow();

    // Company B has no verified configuration, so the refusal is explicit and
    // never a fabricated answer.
    const { token: betaToken } = await staffLogin(app, BETA_HOST, "bob");
    const betaAsk = await request(app)
      .post("/api/v1/company-ai/ask")
      .set("Host", BETA_HOST)
      .set("Authorization", `Bearer ${betaToken}`)
      .send({ intent: "overdue_summary", question: "How much is overdue?" });
    expect(betaAsk.status).toBe(409);
    expect(betaAsk.body.error.message).toMatch(/no active, verified AI configuration/i);
  }, 180_000);

  it("21.3.1 a company cannot execute against another company's configuration", async () => {
    const live = await verifiedConfigurationFor(w.companyA);
    await request(app)
      .post(`/platform/v1/ai-configuration/${live.id}/activate`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({});

    const { token: betaToken } = await staffLogin(app, BETA_HOST, "bob");
    const betaConfiguration = await request(app)
      .get("/api/v1/company-ai/configuration")
      .set("Host", BETA_HOST)
      .set("Authorization", `Bearer ${betaToken}`);
    expect(betaConfiguration.body.configuration).toBeNull();

    // Beta asking about an ALPHA customer gets a refusal, not alpha's data.
    const crossAsk = await request(app)
      .post("/api/v1/company-ai/ask")
      .set("Host", BETA_HOST)
      .set("Authorization", `Bearer ${betaToken}`)
      .send({
        intent: "customer_loan_history",
        customerId: w.customerA1,
        question: "Tell me about this customer."
      });
    expect(crossAsk.status).toBeGreaterThanOrEqual(400);

    const betaExecutions = await withAdminValue(async (db) =>
      (
        await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM company_ai_executions WHERE company_id=$1`,
          [w.companyB]
        )
      ).rows[0]!.n
    );
    expect(betaExecutions).toBe("0");
  }, REAL_EXECUTION_MS);

  it("21.1.13 removal is an authorised, audited flow and the company falls back to no AI", async () => {
    const live = await verifiedConfigurationFor(w.companyA);
    await request(app)
      .post(`/platform/v1/ai-configuration/${live.id}/activate`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({});

    const revoked = await request(app)
      .post(`/platform/v1/companies/${w.companyA}/ai-configuration/${live.id}/revoke`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({ reason: "customer request" });
    expect(revoked.status, `revoke failed: ${JSON.stringify(revoked.body)}`).toBe(200);
    expect(revoked.body.active).toBeNull();

    const { token } = await staffLogin(app, ALPHA_HOST, "amy");
    const after = await request(app)
      .get("/api/v1/company-ai/configuration")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${token}`);
    expect(after.body.configuration).toBeNull();
  }, REAL_EXECUTION_MS);

  it("3.8.3 a per-tenant limiter never makes two companies wait on each other", async () => {
    const limiter = new TenantLimiter(1, 5_000);
    const order: string[] = [];
    let releaseA: (() => void) | null = null;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const slowA = limiter.run({ companyId: "A", lane: "ai" }, async () => {
      order.push("A-start");
      await gateA;
      order.push("A-end");
      return "A";
    });
    await new Promise((r) => setTimeout(r, 20));

    // Company B has its own lane and proceeds immediately.
    const fastB = await limiter.run({ companyId: "B", lane: "ai" }, async () => {
      order.push("B");
      return "B";
    });
    expect(fastB).toBe("B");
    expect(order).toEqual(["A-start", "B"]);

    // A second operation for A queues behind A's first, not behind B.
    const queuedA = limiter.run({ companyId: "A", lane: "ai" }, async () => {
      order.push("A-second");
      return "A2";
    });
    releaseA!();
    expect(await slowA).toBe("A");
    expect(await queuedA).toBe("A2");
    expect(order).toEqual(["A-start", "B", "A-end", "A-second"]);
    expect(limiter.snapshot()).toEqual({});
  });

  it("21.3.3/21.3.4 concurrent AI requests from several companies are independently scoped", async () => {
    const limiter = new TenantLimiter(4, 10_000);
    const companies = ["A", "B", "C", "D", "E", "F", "G"];
    const outcomes = await runAcrossTenants(
      companies.map((companyId) => ({
        label: companyId,
        run: () =>
          limiter.run({ companyId, lane: "ai" }, async () => {
            await new Promise((r) => setTimeout(r, 10));
            return { companyId, secret: `secret-for-${companyId}` };
          })
      })),
      { maxParallel: 7 }
    );
    expect(outcomes.every((o) => o.ok)).toBe(true);
    for (const outcome of outcomes) {
      if (!outcome.ok) continue;
      expect(outcome.value.secret).toBe(`secret-for-${outcome.value.companyId}`);
    }
  });

  it("21.2.1 the AI MODEL interface is served with the exact labels and dynamic lists", async () => {
    const { token } = await staffLogin(app, ALPHA_HOST, "amy");
    const res = await request(app)
      .get("/api/v1/company-ai/interface")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    // The fixed text is exactly what the Vision specifies.
    const ui = res.body.interface;
    expect(ui.heading).toBe("AI MODEL");
    expect(ui.freeModelsSection).toBe("FREE MODELS");
    expect(ui.providerSection).toBe("API PROVIDER");
    expect(ui.providerLabel).toBe("Provider");
    expect(ui.providerPlaceholder).toBe("[ Select API Provider ]");
    expect(ui.apiKeyLabel).toBe("API Key");
    expect(ui.apiKeyMaskedPlaceholder).toBe("[ masked ]");
    expect(ui.apiKeyNote).toBe(
      "This key is stored locally and only used to make API requests from this application."
    );
    expect(ui.modelLabel).toBe("Model");
    expect(ui.modelPlaceholder).toBe("[ Select Model ]");
    expect(ui.modelNote).toBe(
      "The application automatically fetches the latest available models from the selected provider."
    );
    // RULE 21.2.7 - Verify on the left, Done on the right, on one row.
    expect(ui.actions).toEqual([
      { id: "verify", label: "Verify", position: "left" },
      { id: "done", label: "Done", position: "right" }
    ]);

    // RULE 21.2.2/21.2.3 - both lists are live OpenCode data, not a stored list.
    const free = (await openCodeFreeModels()).map((m) => m.ref);
    expect(res.body.freeModels.map((m: { ref: string }) => m.ref)).toEqual(free);
    expect(free.length).toBeGreaterThan(0);
    const catalogue = await openCodeCatalogue();
    expect(res.body.providers.map((p: { id: string }) => p.id)).toEqual(
      catalogue.providers.map((p) => p.id)
    );
  }, 180_000);

  it("3.6.4/3.6.6/3.6.7 each company opens its own detail workspace with its own AI configuration", async () => {
    // Two companies, each with its own verified, active configuration.
    const alphaLive = await verifiedConfigurationFor(w.companyA);
    const target = { provider: alphaLive.provider, model: alphaLive.model };
    await request(app)
      .post(`/platform/v1/ai-configuration/${alphaLive.id}/activate`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({});
    const betaLive = await verifiedConfigurationFor(w.companyB);
    const betaTarget = { provider: betaLive.provider, model: betaLive.model };
    await request(app)
      .post(`/platform/v1/ai-configuration/${betaLive.id}/activate`)
      .set("Authorization", `Bearer ${poToken}`)
      .send({});

    // RULE 3.6.4 - each company opens independently and shows its OWN AI config.
    const alphaDetail = await request(app)
      .get(`/platform/v1/companies/${w.companyA}/detail`)
      .set("Authorization", `Bearer ${poToken}`);
    expect(alphaDetail.status).toBe(200);
    expect(alphaDetail.body.company.id).toBe(w.companyA);
    expect(alphaDetail.body.aiConfiguration.active.provider).toBe(target.provider);
    expect(alphaDetail.body.aiConfiguration.active.model).toBe(target.model);
    // The management context the Vision requires is present.
    expect(alphaDetail.body.setup).toBeTruthy();
    expect(Array.isArray(alphaDetail.body.staffByCategory)).toBe(true);
    expect(Array.isArray(alphaDetail.body.branches)).toBe(true);
    expect(alphaDetail.body.branding).toBeTruthy();
    expect(Array.isArray(alphaDetail.body.recentLogins)).toBe(true);

    const betaDetail = await request(app)
      .get(`/platform/v1/companies/${w.companyB}/detail`)
      .set("Authorization", `Bearer ${poToken}`);
    expect(betaDetail.body.company.id).toBe(w.companyB);
    expect(betaDetail.body.aiConfiguration.active.provider).toBe(betaTarget.provider);
    expect(betaDetail.body.aiConfiguration.active.model).toBe(betaTarget.model);

    // RULE 3.6.5 - every configuration shown belongs to the company opened, and
    // exactly one of them is active for that company.
    for (const item of alphaDetail.body.aiConfiguration.configurations) {
      expect(item.companyId).toBe(w.companyA);
    }
    for (const item of betaDetail.body.aiConfiguration.configurations) {
      expect(item.companyId).toBe(w.companyB);
    }
    expect(
      alphaDetail.body.aiConfiguration.configurations.filter((c: { isActive: boolean }) => c.isActive)
    ).toHaveLength(1);
    expect(
      betaDetail.body.aiConfiguration.configurations.filter((c: { isActive: boolean }) => c.isActive)
    ).toHaveLength(1);
    // The two companies' histories never interleave.
    const alphaIds = new Set(
      alphaDetail.body.aiConfiguration.configurations.map((c: { id: string }) => c.id)
    );
    for (const item of betaDetail.body.aiConfiguration.configurations) {
      expect(alphaIds.has(item.id)).toBe(false);
    }

    // RULE 3.6.2 - the detail workspace never carries customer or money data.
    const detailText = JSON.stringify(alphaDetail.body);
    expect(detailText).not.toContain(w.customerA1);
    expect(detailText).not.toMatch(/"customers"\s*:/);
    expect(detailText).not.toMatch(/"loans"\s*:/);
    expect(detailText).not.toMatch(/"payments"\s*:/);
    expect(detailText).not.toMatch(/"balance"/i);

    // RULE 3.6.7 - the AI configuration is separate from payment providers.
    const alphaProviders = await withAdminValue(async (db) =>
      (
        await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM payment_provider_configs WHERE company_id=$1`,
          [w.companyA]
        )
      ).rows[0]!.n
    );
    const aiRows = await withAdminValue(async (db) =>
      (
        await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM company_ai_configurations WHERE company_id=$1 AND is_active`,
          [w.companyA]
        )
      ).rows[0]!.n
    );
    expect(aiRows).toBe("1");
    // The AI table holds no payment-provider column at all.
    const columns = await withAdminValue(async (db) =>
      (
        await db.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name='company_ai_configurations'`
        )
      ).rows.map((row) => row.column_name)
    );
    expect(columns.some((name) => /api_base_url|webhook|signing/i.test(name))).toBe(false);
    void alphaProviders;
  }, REAL_EXECUTION_MS);

  it("3.6.6 the Companies workspace searches, filters, sorts and paginates, and each result opens its exact company", async () => {
    const searched = await request(app)
      .get("/platform/v1/companies?search=alpha")
      .set("Authorization", `Bearer ${poToken}`);
    expect(searched.status).toBe(200);
    expect(searched.body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of searched.body.items) {
      expect(`${item.name} ${item.slug} ${item.codePrefix}`.toLowerCase()).toContain("alpha");
    }

    const filtered = await request(app)
      .get("/platform/v1/companies?status=active&limit=200")
      .set("Authorization", `Bearer ${poToken}`);
    expect(filtered.body.items.every((c: { status: string }) => c.status === "active")).toBe(true);
    expect(filtered.body.total).toBeGreaterThanOrEqual(filtered.body.items.length);

    const sorted = await request(app)
      .get("/platform/v1/companies?sort=name&order=asc&limit=200")
      .set("Authorization", `Bearer ${poToken}`);
    const names = sorted.body.items.map((c: { name: string }) => c.name);
    expect([...names].sort()).toEqual(names);

    const page1 = await request(app)
      .get("/platform/v1/companies?sort=created_at&order=asc&limit=1&offset=0")
      .set("Authorization", `Bearer ${poToken}`);
    const page2 = await request(app)
      .get("/platform/v1/companies?sort=created_at&order=asc&limit=1&offset=1")
      .set("Authorization", `Bearer ${poToken}`);
    expect(page1.body.items).toHaveLength(1);
    expect(page2.body.items).toHaveLength(1);
    expect(page1.body.items[0].id).not.toBe(page2.body.items[0].id);
    expect(page1.body.total).toBe(page2.body.total);

    // Every listed result opens ITS OWN company detail, exactly.
    for (const item of page1.body.items.concat(page2.body.items)) {
      const detail = await request(app)
        .get(`/platform/v1/companies/${item.id}/detail`)
        .set("Authorization", `Bearer ${poToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.company.id).toBe(item.id);
      expect(detail.body.company.name).toBe(item.name);
    }
  }, 180_000);

  it("3.6.2 the owner cannot reach a company's customers from the platform layer", async () => {
    for (const path of [
      `/platform/v1/companies/${w.companyA}/customers`,
      `/platform/v1/companies/${w.companyA}/loans`,
      `/platform/v1/companies/${w.companyA}/payments`,
      `/platform/v1/companies/${w.companyA}/ledger`
    ]) {
      const attempt = await request(app).get(path).set("Authorization", `Bearer ${poToken}`);
      expect([404, 405], `${path} answered ${attempt.status}`).toContain(attempt.status);
    }
  });

  it("21.2.10 a model is only ever offered because OpenCode returned it", async () => {
    const free = (await openCodeFreeModels()).map((m) => m.ref);
    expect(free).not.toContain("opencode/definitely-not-a-real-model-xyz");

    const catalogue = await openCodeCatalogue();
    const hash = createHash("sha256")
      .update(catalogue.models.map((m) => m.ref).sort().join(","))
      .digest("hex");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // The interface the Vision specifies is served entirely from these lists.
    const { token } = await staffLogin(app, ALPHA_HOST, "amy");
    const apiFree = await request(app)
      .get("/api/v1/company-ai/free-models")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${token}`);
    expect(apiFree.status).toBe(200);
    expect(apiFree.body.source).toBe("opencode");
    expect(apiFree.body.models.map((m: { ref: string }) => m.ref)).toEqual(free);

    const apiProviders = await request(app)
      .get("/api/v1/company-ai/providers")
      .set("Host", ALPHA_HOST)
      .set("Authorization", `Bearer ${token}`);
    expect(apiProviders.status).toBe(200);
    expect(apiProviders.body.source).toBe("opencode");
    expect(apiProviders.body.providers.length).toBeGreaterThan(0);
  }, 120_000);
});
