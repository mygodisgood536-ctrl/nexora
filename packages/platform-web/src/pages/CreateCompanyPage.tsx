import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  IconCheck,
  IconLayers,
  IconLock,
  IconPlus,
  PageHeader,
  Select,
  StatusBadge,
  Switch,
  useToast
} from "@nexora/ui";
import { BUILT_IN_ROLES, ROLE_CATEGORIES } from "@nexora/shared";
import { api } from "../lib/api";
import { BrandPreview, type Branding } from "../components/BrandPreview";

interface WizardState {
  name: string;
  codePrefix: string;
  contactEmail: string;
  planTier: string;
  brand: Branding;
  /** Optional custom company domain (RULE 3.3.1). */
  domain: string | null;
  mdFullName: string;
  mdPhone: string;
  mdEmail: string;
  mdBirthDay: string;
  mdBirthMonth: string;
  roleKeys: string[];
}

interface CreateResult {
  id: string;
  slug: string;
  code_prefix: string;
  company_url: string;
  md?: { username: string; initial_password: string; credential_state: string; expires_at: string; worker_code: string };
}

const STEPS = ["Company", "Identity", "Managing director", "Roles", "Review"];

const emptyState: WizardState = {
  name: "",
  codePrefix: "",
  contactEmail: "",
  planTier: "standard",
  // The stored brand record still carries the company's own identity colours for
  // its brand surfaces (logo tile, sign-in panel), but it no longer drives the
  // workspace accent: there is ONE Nexora brand system (change of direction,
  // 2026-10-22, recorded in packages/shared/src/theme.ts).
  brand: {
    primaryColor: "#2f56d9",
    secondaryColor: "#0b3d29",
    accentColor: "#2f56d9",
    navyColor: "#101418",
    fontFamily: "Fraunces"
  },
  domain: null,
  mdFullName: "",
  mdPhone: "",
  mdEmail: "",
  mdBirthDay: "",
  mdBirthMonth: "",
  roleKeys: BUILT_IN_ROLES.map((r) => r.key)
};

export function CreateCompanyPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const draftId = params.get("draft");

  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(emptyState);
  const [draftSaved, setDraftSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [resuming, setResuming] = useState(Boolean(draftId));

  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await api<{
          company: {
            name: string;
            slug: string;
            codePrefix: string;
            portalUrl: string | null;
            domain: string | null;
          };
          branding: Branding;
        }>(`/companies/${draftId}/detail`);
        if (cancelled) return;
        setState((s) => ({
          ...s,
          name: detail.company.name ?? "",
          codePrefix: detail.company.codePrefix ?? "",
          domain: detail.company.domain ?? null,
          brand: { ...s.brand, ...detail.branding }
        }));
        setDraftSaved(true);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setResuming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));

  const stepValid = useMemo(() => {
    if (step === 0) return state.name.trim().length >= 2 && /^[A-Za-z]{3,6}$/.test(state.codePrefix);
    if (step === 1) return true;
    if (step === 2) return state.mdFullName.trim().length >= 3 && state.mdPhone.trim().length >= 4;
    if (step === 3) return state.roleKeys.length > 0;
    return confirmed;
  }, [step, state, confirmed]);

  function stepError(): string | null {
    if (step === 0) {
      if (state.name.trim().length < 2) return "Company name is required (at least 2 characters).";
      if (!/^[A-Za-z]{3,6}$/.test(state.codePrefix)) return "Code prefix must be 3 to 6 letters (A-Z only).";
    }
    if (step === 2) {
      if (state.mdFullName.trim().length < 3) return "The MD's full name is required - it becomes the MD's username (RULE 3.3.1).";
      if (state.mdPhone.trim().length < 4) return "The MD's phone number is required (RULE 3.3.1).";
    }
    if (step === 3 && state.roleKeys.length === 0) return "Enable at least one role for the company.";
    if (step === 4 && !confirmed) return "Confirm the details before creating the company (RULE 3.3).";
    return null;
  }

  async function saveDraft() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: state.name.trim() || undefined,
        codePrefix: /^[A-Za-z]{3,6}$/.test(state.codePrefix) ? state.codePrefix : undefined,
        contactEmail: state.contactEmail.trim() || undefined,
        planTier: state.planTier || undefined,
        domain: state.domain?.trim() || undefined,
        branding: state.brand
      };
      const saved = draftId
        ? await api<{ id: string }>(`/companies/drafts/${draftId}`, { method: "PUT", json: payload })
        : await api<{ id: string }>("/companies/draft", { method: "POST", json: payload });
      setDraftSaved(true);
      toast({ title: "Draft saved", text: "Resume it any time from the Drafts page - it cannot be signed in to.", tone: "success" });
      if (!draftId && saved?.id) navigate(`/companies/new?draft=${encodeURIComponent(saved.id)}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      toast({ title: "Draft not saved", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (step < 4) {
      const problem = stepError();
      if (problem) {
        setError(problem);
        return;
      }
      setError(null);
      setStep(step + 1);
      return;
    }
    const problem = stepError();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: state.name.trim(),
        codePrefix: state.codePrefix,
        contactEmail: state.contactEmail.trim() || undefined,
        planTier: state.planTier || undefined,
        mdFullName: state.mdFullName.trim(),
        mdPhone: state.mdPhone.trim(),
        mdEmail: state.mdEmail.trim() || undefined,
        mdBirthDay: state.mdBirthDay ? Number(state.mdBirthDay) : undefined,
        mdBirthMonth: state.mdBirthMonth ? Number(state.mdBirthMonth) : undefined,
        domain: state.domain?.trim() || undefined,
        branding: state.brand,
        enabledRoleKeys: state.roleKeys
      };
      if (draftId) body.draftId = draftId;
      const created = await api<CreateResult>("/companies", { method: "POST", json: body });
      setResult(created);
      toast({ title: "Company created", text: `${created.slug}.nexora.app is now live.`, tone: "success" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) return <CredentialPanel result={result} onOpen={() => navigate(`/companies/${result.id}`)} onDone={() => navigate("/companies")} />;

  return (
    <div className="nx-stack nx-stack--lg" style={{ maxWidth: 1040 }}>
      <PageHeader
        eyebrow="Platform"
        title={draftId ? "Resume company setup" : "Create company"}
        description="Five steps to a live tenant: identity, branding, the MD's credential, which roles exist, then review. Save a draft at any point (RULE 3.3)."
        actions={
          <>
            <Button onClick={() => void saveDraft()} loading={busy} icon={<IconLayers size={15} />}>
              {draftSaved ? "Save draft again" : "Save draft"}
            </Button>
            <Button variant="ghost" onClick={() => navigate(draftId ? "/drafts" : "/companies")}>Cancel</Button>
          </>
        }
      />

      <div className="nxp-steps">
        {STEPS.map((label, i) => (
          <span key={label} className={i === step ? "nxp-step is-active" : i < step ? "nxp-step is-done" : "nxp-step"}>
            {i < step ? <IconCheck size={13} /> : <span className="nx-num">{i + 1}</span>}
            {label}
          </span>
        ))}
      </div>

      {resuming && <Card><span className="nx-muted">Resuming draft…</span></Card>}

      <form onSubmit={(e) => void create(e)} noValidate className="nx-stack nx-stack--lg">
        {step === 0 && (
          <Card title="Company identity">
            <div className="nx-grid nx-grid--2">
              <Field label="Company name" htmlFor="c-name" required hint="Appears across the product and on the login page">
                <Input id="c-name" value={state.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Bright Finance Ltd" />
              </Field>
              <Field label="Code prefix" htmlFor="c-prefix" required hint="3-6 letters. Used for customer and loan codes.">
                <Input id="c-prefix" value={state.codePrefix} onChange={(e) => patch({ codePrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} placeholder="BRF" maxLength={6} />
              </Field>
              <Field label="Contact email" htmlFor="c-email" hint="Optional. Never used as a login credential.">
                <Input id="c-email" type="email" value={state.contactEmail} onChange={(e) => patch({ contactEmail: e.target.value })} placeholder="hello@company.example" />
              </Field>
              <Field label="Plan tier" htmlFor="c-plan" hint="Commercial label only - no feature gating is implied">
                <Select id="c-plan" value={state.planTier} onChange={(e) => patch({ planTier: e.target.value })}>
                  <option value="standard">Standard</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                </Select>
              </Field>
            </div>
            <div className="nx-row" style={{ gap: 10, marginTop: 14, fontSize: "var(--nx-text-sm)" }}>
              <Badge tone="accent">RULE 3.3.1</Badge>
              <span className="nx-muted">The MD's own details are collected in step 3 - a company cannot be created without them.</span>
            </div>
          </Card>
        )}

        {step === 1 && (
          <div className="nx-grid nx-grid--2">
            <Card title="Company identity">
              <div className="nx-stack">
                <Field label="Logo URL" htmlFor="c-logo" hint="https:// or root-relative path. Shown in the company login, sidebar and reports.">
                  <Input id="c-logo" value={state.brand.logoUrl ?? ""} onChange={(e) => patch({ brand: { ...state.brand, logoUrl: e.target.value || null } })} placeholder="/logo.svg" />
                </Field>
                <Field label="Custom domain" htmlFor="c-domain" hint="Optional. Leave empty to use the generated company URL. Verified before it resolves.">
                  <Input id="c-domain" value={state.domain ?? ""} onChange={(e) => patch({ domain: e.target.value || null })} placeholder="loans.example.com" />
                </Field>
                <div className="nx-row" style={{ gap: 10, marginTop: 4, fontSize: "var(--nx-text-sm)" }}>
                  <Badge tone="accent">ONE BRAND</Badge>
                  <span className="nx-muted">
                    Every company uses the Nexora brand system. There is no per-company colour or
                    theme to choose: the company&apos;s identity is its name, its logo and its domain.
                  </span>
                </div>
              </div>
            </Card>
            <Card title="Live preview (RULE 3.3.2)">
              <BrandPreview brand={state.brand} companyName={state.name} />
              <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)", marginTop: 10 }}>
                Illustrative preview. The real sign-in page applies the Nexora brand tokens before
                first paint, and semantic colours (success, danger, warning) are never branded
                (RULE 13.3).
              </p>
            </Card>
          </div>
        )}

        {step === 2 && (
          <Card title="Managing director credential">
            <div className="nx-grid nx-grid--2">
              <Field label="Full name" htmlFor="md-name" required hint="Becomes the MD's username for sign-in">
                <Input id="md-name" value={state.mdFullName} onChange={(e) => patch({ mdFullName: e.target.value })} placeholder="Cornelius Adedeji Victor" />
              </Field>
              <Field label="Phone number" htmlFor="md-phone" required hint="Verification contact, never a login factor by itself">
                <Input id="md-phone" value={state.mdPhone} onChange={(e) => patch({ mdPhone: e.target.value })} placeholder="+234 800 000 0000" />
              </Field>
              <Field label="Email" htmlFor="md-email" hint="Optional - the MD does not sign in with email">
                <Input id="md-email" type="email" value={state.mdEmail} onChange={(e) => patch({ mdEmail: e.target.value })} />
              </Field>
              <div className="nx-grid nx-grid--2">
                <Field label="Birth day" htmlFor="md-day" hint="Day + month only (RULE 5.7.4)">
                  <Input id="md-day" inputMode="numeric" maxLength={2} value={state.mdBirthDay} onChange={(e) => patch({ mdBirthDay: e.target.value.replace(/\D/g, "") })} placeholder="14" />
                </Field>
                <Field label="Birth month" htmlFor="md-month" hint="&nbsp;">
                  <Select id="md-month" value={state.mdBirthMonth} onChange={(e) => patch({ mdBirthMonth: e.target.value })}>
                    <option value="">—</option>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
            <div className="nx-row" style={{ gap: 10, marginTop: 14, fontSize: "var(--nx-text-sm)" }}>
              <IconLock size={15} />
              <span className="nx-muted">
                On creation the MD receives a one-time initial password with an expiry - it is shown
                exactly once in this console and never again (RULE 3.4.1).
              </span>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card
            title="Enabled roles"
            actions={
              <>
                <Button size="sm" onClick={() => patch({ roleKeys: BUILT_IN_ROLES.map((r) => r.key) })}>Select all</Button>
                <Button size="sm" onClick={() => patch({ roleKeys: ["md"] })}>MD only</Button>
              </>
            }
          >
            <p className="nx-muted" style={{ fontSize: "var(--nx-text-sm)", marginBottom: 14 }}>
              Only enabled roles can exist in this company. The catalogue below is the platform
              ceiling - workers are created against these keys later (RULE 4.5 / 12.x).
            </p>
            <div className="nx-grid nx-grid--2">
              {ROLE_CATEGORIES.map((cat) => {
                const roles = BUILT_IN_ROLES.filter((r) => r.category === cat.key);
                if (roles.length === 0) return null;
                const allOn = roles.every((r) => state.roleKeys.includes(r.key));
                return (
                  <div key={cat.key} className="nx-stack nx-stack--sm" style={{ border: "1px solid var(--nx-border)", borderRadius: "var(--nx-radius)", padding: 14 }}>
                    <div className="nx-row nx-row--between">
                      <strong style={{ fontSize: "var(--nx-text-sm)" }}>{cat.label}</strong>
                      <Switch
                        label={allOn ? "All on" : "All off"}
                        checked={allOn}
                        onChange={(e) => {
                          const keys = roles.map((r) => r.key);
                          patch({
                            roleKeys: e.target.checked
                              ? Array.from(new Set([...state.roleKeys, ...keys]))
                              : state.roleKeys.filter((k) => !keys.includes(k))
                          });
                        }}
                      />
                    </div>
                    <div className="nx-stack nx-stack--sm">
                      {roles.map((r) => (
                        <Checkbox
                          key={r.key}
                          label={r.name}
                          checked={state.roleKeys.includes(r.key)}
                          onChange={(e) =>
                            patch({
                              roleKeys: e.target.checked
                                ? [...state.roleKeys, r.key]
                                : state.roleKeys.filter((k) => k !== r.key)
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {step === 4 && (
          <Card title="Review and create">
            <div className="nx-grid nx-grid--2">
              <div className="nx-kv">
                <dt>Company</dt><dd><strong>{state.name || "—"}</strong></dd>
                <dt>Url</dt><dd>{(state.name ? state.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "company")}.nexora.app</dd>
                <dt>Code prefix</dt><dd>{state.codePrefix || "—"}</dd>
                <dt>Plan</dt><dd>{state.planTier}</dd>
                <dt>Roles enabled</dt><dd>{state.roleKeys.length} of {BUILT_IN_ROLES.length}</dd>
                <dt>MD</dt><dd>{state.mdFullName || "—"} <span className="nx-faint">{state.mdPhone}</span></dd>
              </div>
              <div className="nx-stack nx-stack--sm">
                <span className="nx-eyebrow">Branding</span>
                <BrandPreview brand={state.brand} companyName={state.name} />
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <Checkbox
                label="I confirm these details are correct. Creating the company provisions the MD credential and makes the tenant live."
                hint="Creation is an audited, irreversible activation (RULE 3.3 / 19.13.1)."
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
            </div>
          </Card>
        )}

        {error && (
          <div className="nx-errorstate" role="alert">
            <span>{error}</span>
          </div>
        )}

        <div className="nx-row" style={{ gap: 10 }}>
          {step > 0 && (
            <Button type="button" onClick={() => { setError(null); setStep(step - 1); }} disabled={busy}>
              Back
            </Button>
          )}
          <div className="nx-grow" />
          <Button type="button" onClick={() => void saveDraft()} loading={busy} icon={<IconLayers size={15} />}>
            Save draft
          </Button>
          <Button type="submit" variant="primary" loading={busy} icon={step === 4 ? <IconCheck size={15} /> : <IconPlus size={15} />} disabled={!stepValid}>
            {step === 4 ? "Create company" : "Continue"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function CredentialPanel({ result, onOpen, onDone }: { result: CreateResult; onOpen: () => void; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const md = result.md;

  function copy(what: string, value: string) {
    void navigator.clipboard?.writeText(value);
    setCopied(what);
  }

  return (
    <div className="nx-stack nx-stack--lg" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Company created"
        title={result.slug}
        description="The tenant is live. The MD credential below is shown exactly once - hand it over securely."
        actions={<Button variant="primary" onClick={onOpen}>Open company detail</Button>}
      />

      <Card>
        <div className="nx-row" style={{ gap: 10, marginBottom: 14 }}>
          <StatusBadge status="active" label="live now" />
          <Badge tone="accent">{result.company_url}</Badge>
        </div>

        {md ? (
          <div className="nxp-credential">
            <div className="nx-row" style={{ gap: 8 }}>
              <IconLock size={16} />
              <strong>MD initial credential (one time)</strong>
            </div>
            <div className="nx-kv">
              <dt>Username</dt>
              <dd className="nx-row" style={{ gap: 8 }}>
                <code>{md.username}</code>
                <Button size="sm" onClick={() => copy("user", md.username)}>{copied === "user" ? "Copied" : "Copy"}</Button>
              </dd>
              <dt>Initial password</dt>
              <dd className="nx-row" style={{ gap: 8 }}>
                <code>{md.initial_password}</code>
                <Button size="sm" onClick={() => copy("pass", md.initial_password)}>{copied === "pass" ? "Copied" : "Copy"}</Button>
              </dd>
              <dt>Worker code</dt><dd className="nx-num">{md.worker_code || "—"}</dd>
              <dt>Expires</dt><dd>{md.expires_at ? new Date(md.expires_at).toLocaleString() : "per policy"}</dd>
            </div>
            <p style={{ fontSize: "var(--nx-text-sm)", color: "var(--nx-text-secondary)" }}>
              This panel is not retrievable later. The MD is forced to change the password on first
              sign-in, and the event is written to both the platform and company audit trails.
            </p>
          </div>
        ) : (
          <p className="nx-muted">No MD credential was issued - complete the MD step and recreate to issue one.</p>
        )}
      </Card>

      <Card title="What happens next">
        <ol className="nx-stack nx-stack--sm" style={{ paddingLeft: 18, fontSize: "var(--nx-text-sm)" }}>
          <li>The MD signs in at <strong>{result.company_url}</strong> and rotates the initial password.</li>
          <li>Branches, workers and providers are configured inside the company workspace - not here.</li>
          <li>Suspending from this console ends all sessions immediately (RULE 3.5).</li>
        </ol>
        <div className="nx-row" style={{ gap: 10, marginTop: 16 }}>
          <Button variant="primary" onClick={onOpen}>Open company detail</Button>
          <Button onClick={onDone}>Back to companies</Button>
        </div>
      </Card>
    </div>
  );
}
