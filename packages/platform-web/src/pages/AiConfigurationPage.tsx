import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
  ErrorState,
  Field,
  IconKey,
  IconProvider,
  Input,
  LoadingRow,
  PageHeader,
  SearchInput,
  useToast
} from "@nexora/ui";
import { api, itemsOf, type Json } from "../lib/api";

/**
 * The company-specific AI provider / model configuration page.
 *
 * RULE 21.2.1 fixes this interface exactly: it is ONE vertically arranged
 * page, and the sections appear in this order and no other:
 *
 *   [1] FREE MODELS      - at the very top
 *   [2] API PROVIDER     - directly below the free-model section
 *   [3] API KEY          - only when the selected provider genuinely needs one
 *   [4] MODEL            - last, at the bottom
 *
 * Nothing here is hard-coded. The free-model list, the provider catalogue and
 * the per-provider model list are all read live from OpenCode (RULE 21.2.2,
 * 21.2.3, 21.2.4). The API-key field's presence is decided by the provider's
 * own reported authentication mechanism, never by a list of provider names
 * written by hand.
 *
 * The saved configuration is company-scoped and the platform owner selects it
 * for one explicitly identified company at a time. The company context comes
 * from the route, and the server resolves and validates it (RULE 3.6.5,
 * 21.1.10) - it is never trusted because a form said so.
 */

interface FreeModel {
  ref: string;
  provider: string;
  model: string;
  free: boolean;
}

interface ProviderRef {
  id: string;
  free: boolean;
  modelCount: number;
}

type AuthMechanism = "api" | "oauth" | "none" | "unknown";

interface SavedConfig {
  id: string;
  provider: string;
  model: string;
  status: string;
  verificationState?: string | null;
}

export interface AiConfigurationPageProps {
  companyId: string;
  companyName: string;
}

export function AiConfigurationPage({ companyId, companyName }: AiConfigurationPageProps) {
  const toast = useToast();

  const [freeModels, setFreeModels] = useState<FreeModel[]>([]);
  const [providers, setProviders] = useState<ProviderRef[]>([]);
  const [models, setModels] = useState<FreeModel[]>([]);
  const [mechanism, setMechanism] = useState<AuthMechanism>("unknown");
  const [providerConfigured, setProviderConfigured] = useState(false);

  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState<SavedConfig[]>([]);

  const [freeQuery, setFreeQuery] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- live catalogue ----------------------------------------------------
  useEffect(() => {
    void (async () => {
      try {
        const [free, provs] = await Promise.all([
          api<{ models: FreeModel[] }>("/ai/free-models"),
          api<{ providers: ProviderRef[] }>("/ai/providers")
        ]);
        setFreeModels((free.models ?? []).filter((m) => m.free));
        setProviders(provs.providers ?? []);
        setCatalogueError(null);
      } catch (err) {
        setCatalogueError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ---- saved configuration for THIS company -------------------------------
  useEffect(() => {
    void (async () => {
      try {
        const rows = itemsOf<Json>(await api(`/companies/${companyId}/ai-configuration`));
        setSaved(
          rows.map((r) => ({
            id: String(r.id ?? ""),
            provider: String(r.provider ?? ""),
            model: String(r.model ?? ""),
            status: String(r.status ?? "unknown"),
            verificationState: (r.verificationState as string | null) ?? null
          }))
        );
      } catch {
        /* an unconfigured company simply has none */
      }
    })();
  }, [companyId]);

  // ---- the selected provider's models + its auth mechanism ---------------
  const loadProvider = useCallback(async (providerId: string) => {
    setModelsError(null);
    if (!providerId) {
      setModels([]);
      setMechanism("unknown");
      setProviderConfigured(false);
      return;
    }
    try {
      const [modelList, auth] = await Promise.all([
        api<{ models: FreeModel[] }>(`/ai/providers/${encodeURIComponent(providerId)}/models`),
        api<{ mechanism: AuthMechanism; configured: boolean }>(
          `/ai/providers/${encodeURIComponent(providerId)}/auth`
        )
      ]);
      setModels(modelList.models ?? []);
      setMechanism(auth.mechanism ?? "unknown");
      setProviderConfigured(auth.configured === true);
    } catch (err) {
      setModels([]);
      setModelsError((err as Error).message);
    }
  }, []);

  /**
   * RULE 21.2.4 - when the provider changes, the previous model selection is
   * cleared and the available models are refreshed. A stale model must never
   * remain selected.
   */
  function chooseProvider(next: string) {
    setProvider(next);
    setModel("");
    setApiKey("");
    void loadProvider(next);
  }

  /** RULE 21.2.2 - a free model is a path of its own: no provider is needed. */
  function chooseFreeModel(ref: string) {
    const [freeProvider, ...rest] = ref.split("/");
    setProvider(freeProvider ?? "");
    setModel(rest.join("/"));
    setApiKey("");
    void loadProvider(freeProvider ?? "");
  }

  // ---- filters ------------------------------------------------------------
  const visibleFree = useMemo(() => {
    const q = freeQuery.trim().toLowerCase();
    if (!q) return freeModels;
    return freeModels.filter((m) => m.ref.toLowerCase().includes(q));
  }, [freeModels, freeQuery]);

  const visibleProviders = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter((p) => p.id.toLowerCase().includes(q));
  }, [providers, providerQuery]);

  const visibleModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.ref.toLowerCase().includes(q));
  }, [models, modelQuery]);

  // ---- the API key field appears ONLY when the provider needs one --------
  const needsApiKey = mechanism === "api" || mechanism === "unknown";
  const needsOAuth = mechanism === "oauth";
  const needsNoCredential = mechanism === "none";

  // ---- actions ------------------------------------------------------------
  async function save() {
    if (!provider || !model) {
      toast({ title: "Select a provider and a model", text: "Both are required before the configuration can be saved.", tone: "danger" });
      return;
    }
    setBusy(true);
    try {
      const created = await api<Json>(`/companies/${companyId}/ai-configuration`, {
        method: "POST",
        json: { provider, model, apiKey: apiKey.trim() ? apiKey.trim() : null }
      });
      const id = String(created.id ?? "");
      // RULE 21.1.12 - Verify is a REAL verification. A successful one is only
      // reported after the provider actually confirmed the model.
      const verified = await api<{ ok: boolean; failure?: string | null }>(
        `/ai-configuration/${id}/verify`,
        { method: "POST" }
      );
      if (verified.ok) {
        await api(`/ai-configuration/${id}/activate`, { method: "POST" });
        toast({
          title: "Configuration verified and active",
          text: `${provider}/${model} is now this company's active AI configuration.`,
          tone: "success"
        });
      } else {
        toast({
          title: "Saved, but verification failed",
          text: verified.failure ?? "The provider did not confirm the model. The configuration was not activated.",
          tone: "danger"
        });
      }
      setApiKey("");
      const rows = itemsOf<Json>(await api(`/companies/${companyId}/ai-configuration`));
      setSaved(
        rows.map((r) => ({
          id: String(r.id ?? ""),
          provider: String(r.provider ?? ""),
          model: String(r.model ?? ""),
          status: String(r.status ?? "unknown"),
          verificationState: (r.verificationState as string | null) ?? null
        }))
      );
    } catch (err) {
      toast({ title: "Could not save the configuration", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="nx-main">
        <PageHeader title="AI MODEL" description="Company AI provider and model" />
        <Card><LoadingRow text="Loading the OpenCode catalogue…" /></Card>
      </div>
    );
  }

  return (
    <div className="nx-main">
      <PageHeader
        eyebrow={<Badge tone="accent">RULE 21.2</Badge>}
        title="AI MODEL"
        description={`Provider and model for ${companyName}`}
      />

      {catalogueError && (
        <div style={{ marginBottom: 16 }}>
          <ErrorState
            title="The AI catalogue is not reachable"
            detail={catalogueError}
            onRetry={() => window.location.reload()}
          />
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* [1] FREE MODELS - FIRST, AT THE TOP                              */}
      {/* ---------------------------------------------------------------- */}
      <Card
        title="FREE MODELS — No API Key Required"
        actions={<Badge tone="success">Powered by OpenCode</Badge>}
      >
        <div className="nx-stack">
          <SearchInput value={freeQuery} onChange={setFreeQuery} placeholder="Search free models..." />
          <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
            Available free models are retrieved from the supported OpenCode catalogue. They are not a
            fixed list: what appears here is what OpenCode currently reports as available without a
            provider key.
          </p>
          {visibleFree.length === 0 ? (
            <EmptyState
              icon={<IconProvider size={22} />}
              title="No free models are available"
              text="OpenCode currently reports no model that can be used without a provider key."
            />
          ) : (
            <div className="nx-grid nx-grid--2" style={{ maxHeight: 260, overflowY: "auto" }}>
              {visibleFree.map((m) => {
                const active = model === m.model && provider === m.provider;
                return (
                  <button
                    key={m.ref}
                    type="button"
                    className={cx("nx-pick", active && "nx-pick--active")}
                    aria-pressed={active}
                    onClick={() => chooseFreeModel(m.ref)}
                  >
                    <span style={{ fontWeight: active ? 600 : 400 }}>{m.model}</span>
                    <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{m.provider}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* [2] API PROVIDER - DIRECTLY BELOW THE FREE-MODEL SECTION         */}
      {/* ---------------------------------------------------------------- */}
      <Card title="API Provider">
        <div className="nx-stack">
          <SearchInput
            value={providerQuery}
            onChange={setProviderQuery}
            placeholder="Search and select provider..."
          />
          {visibleProviders.length === 0 ? (
            <EmptyState
              icon={<IconProvider size={22} />}
              title="No providers are reachable"
              text="OpenCode did not report a provider catalogue. Check that OpenCode is installed and its configuration is readable."
            />
          ) : (
            <div className="nx-grid nx-grid--2" style={{ maxHeight: 220, overflowY: "auto" }}>
              {visibleProviders.map((p) => {
                const active = provider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={cx("nx-pick", active && "nx-pick--active")}
                    aria-pressed={active}
                    onClick={() => chooseProvider(p.id)}
                  >
                    <span style={{ fontWeight: active ? 600 : 400 }}>{p.id}</span>
                    <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
                      {p.modelCount} model{p.modelCount === 1 ? "" : "s"}
                      {p.free ? " · free tier" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {provider && (
            <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
              {providerConfigured
                ? "This provider already has a credential configured on the platform."
                : "This provider has no credential configured on the platform yet."}
            </p>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* [3] API KEY - ONLY WHEN THE PROVIDER GENUINELY REQUIRES ONE     */}
      {/* ---------------------------------------------------------------- */}
      {provider && needsApiKey && (
        <Card title="API Key">
          <div className="nx-stack">
            <Field label="API Key" htmlFor="ai-key" hint="Stored server-side. Never returned to a browser, logged, or included in an export.">
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key..."
              />
            </Field>
            <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
              This key is stored locally and only used to make API requests from this application.
            </p>
            {mechanism === "unknown" && (
              <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
                OpenCode has not reported an authentication mechanism for this provider, so the key
                field is shown. If the provider turns out not to need a key, leaving it empty is
                harmless.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* [4] MODEL - LAST, AT THE BOTTOM                                   */}
      {/* ---------------------------------------------------------------- */}
      {provider && needsOAuth && (
        <Card title="Account access required">
          <p className="nx-faint" style={{ fontSize: "var(--nx-text-sm)" }}>
            {provider} is authenticated by linking an account rather than by an API key. Complete the
            provider&apos;s own sign-in on the platform, then choose one of its models below.
          </p>
        </Card>
      )}

      <Card title="Model">
        <div className="nx-stack">
          {!provider ? (
            <EmptyState
              icon={<IconProvider size={22} />}
              title="Choose a provider or a free model first"
              text="The model list is the last section, so it stays empty until a provider is selected above."
            />
          ) : (
            <>
              <SearchInput
                value={modelQuery}
                onChange={setModelQuery}
                placeholder="Search and select a model..."
              />
              <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
                Only models available for the selected provider
                {needsNoCredential ? " (no key required)" : ""}. The application automatically
                fetches the latest available models from the selected provider.
              </p>
              {modelsError && <ErrorState title="Could not load models" detail={modelsError} />}
              {visibleModels.length === 0 && !modelsError ? (
                <EmptyState
                  icon={<IconProvider size={22} />}
                  title="No models were returned"
                  text="OpenCode reported no model for this provider."
                />
              ) : (
                <div className="nx-grid nx-grid--2" style={{ maxHeight: 240, overflowY: "auto" }}>
                  {visibleModels.map((m) => {
                    const active = model === m.model;
                    return (
                      <button
                        key={m.ref}
                        type="button"
                        className={cx("nx-pick", active && "nx-pick--active")}
                        aria-pressed={active}
                        onClick={() => setModel(m.model)}
                      >
                        <span style={{ fontWeight: active ? 600 : 400 }}>{m.model}</span>
                        {m.free ? <Badge tone="success">free</Badge> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {/* ---- the two actions, Verify on the left and Done on the right ---- */}
      <Card title="Save and verify">
        <div className="nx-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div className="nx-stack" style={{ gap: 4 }}>
            <span style={{ fontSize: "var(--nx-text-sm)" }}>
              {provider && model ? `${provider}/${model}` : "No provider and model chosen yet"}
            </span>
            {needsNoCredential && (
              <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
                {provider} is served by OpenCode itself, so no API key is required.
              </span>
            )}
          </div>
          <div className="nx-row" style={{ gap: 10 }}>
            <Button variant="secondary" onClick={() => void save()} disabled={busy || !provider || !model}>
              <IconKey size={15} /> Verify
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !provider || !model}>
              Done
            </Button>
          </div>
        </div>
      </Card>

      {saved.length > 0 && (
        <Card title="This company's AI configuration">
          <div className="nx-stack nx-stack--sm">
            {saved.map((c) => (
              <div key={c.id} className="nx-row nx-row--between">
                <span>
                  {c.provider}/{c.model}
                </span>
                <Badge tone={c.status === "active" ? "success" : "neutral"}>{c.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
