import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  IconBuilding,
  IconCheck,
  IconKey,
  Input,
  KV,
  LoadingRow,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  Tabs,
  Timeline,
  formatDate,
  formatDateTime,
  formatRelative,
  useToast,
  type Column
} from "@nexora/ui";
import { BUILT_IN_ROLES } from "@nexora/shared";
import { api, itemsOf, type Json } from "../lib/api";
import { BrandPreview, type Branding } from "../components/BrandPreview";

interface Detail {
  company: {
    id: string;
    name: string;
    slug: string;
    codePrefix: string;
    portalUrl: string | null;
    contactEmail: string | null;
    status: string;
    planTier: string | null;
    createdAt: string;
    activatedAt: string | null;
    suspendedAt: string | null;
    lastActivityAt: string | null;
  };
  setup: { complete: boolean; branches: number; workers: number; rolesEnabled: number; enabledRoleKeys: string[] };
  staffByCategory: Array<{ category: string; roleKey: string; name: string; workers: number }>;
  branches: Array<{ id: string; code: string; name: string; status: string; portalUrl: string | null }>;
  branding: Branding & { logoUrl: string | null; fontFamily: string | null };
  recentLogins: Array<{ username: string; lastLoginAt: string | null; status: string }>;
  aiConfiguration: unknown;
}

type StatusAction = "submit_for_activation" | "activate" | "suspend" | "reactivate";

const STATUS_ACTIONS: Array<{ action: StatusAction; label: string; tone: "primary" | "secondary" | "danger"; needsReason: boolean }> = [
  { action: "submit_for_activation", label: "Submit for activation", tone: "primary", needsReason: false },
  { action: "activate", label: "Activate now", tone: "primary", needsReason: false },
  { action: "suspend", label: "Suspend company", tone: "danger", needsReason: true },
  { action: "reactivate", label: "Reactivate", tone: "primary", needsReason: false }
];

export function CompanyDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [enabledRoles, setEnabledRoles] = useState<string[]>([]);
  const [audit, setAudit] = useState<Json[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusPrompt, setStatusPrompt] = useState<(typeof STATUS_ACTIONS)[number] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState<Branding>({});
  const [savedRoles, setSavedRoles] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, roles, log] = await Promise.all([
        api<Detail>(`/companies/${id}/detail`),
        api<string[]>(`/companies/${id}/enabled-roles`),
        api<unknown>("/audit?limit=300")
      ]);
      setDetail(d);
      setEnabledRoles(Array.isArray(roles) ? roles : []);
      setSavedRoles(Array.isArray(roles) ? roles : []);
      setBrand({
        accentColor: d.branding.accentColor ?? undefined,
        primaryColor: d.branding.primaryColor ?? undefined,
        secondaryColor: d.branding.secondaryColor ?? undefined,
        navyColor: d.branding.navyColor ?? undefined,
        logoUrl: d.branding.logoUrl,
        fontFamily: d.branding.fontFamily ?? undefined
      });
      setAudit(itemsOf<Json>(log).filter((r) => String(r.company_id ?? r.companyId ?? "") === id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const rolesDirty = useMemo(
    () => enabledRoles.length !== savedRoles.length || enabledRoles.some((k) => !savedRoles.includes(k)),
    [enabledRoles, savedRoles]
  );
  const brandDirty = useMemo(() => {
    if (!detail) return false;
    return (
      (brand.accentColor ?? null) !== (detail.branding.accentColor ?? null) ||
      (brand.secondaryColor ?? null) !== (detail.branding.secondaryColor ?? null) ||
      (brand.navyColor ?? null) !== (detail.branding.navyColor ?? null) ||
      (brand.logoUrl ?? null) !== (detail.branding.logoUrl ?? null) ||
      (brand.fontFamily ?? null) !== (detail.branding.fontFamily ?? null)
    );
  }, [brand, detail]);

  async function runStatus() {
    if (!statusPrompt) return;
    if (statusPrompt.needsReason && reason.trim().length < 5) {
      toast({ title: "Reason required", text: "A suspension must record why (RULE 3.5).", tone: "warning" });
      return;
    }
    setBusy(true);
    try {
      await api(`/companies/${id}/status`, {
        method: "POST",
        json: { action: statusPrompt.action, reason: reason.trim() || undefined }
      });
      toast({ title: "Status updated", text: `${detail?.company.name}: ${statusPrompt.label}.`, tone: "success" });
      setStatusPrompt(null);
      setReason("");
      await load();
    } catch (err) {
      toast({ title: "Action failed", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function saveRoles() {
    setBusy(true);
    try {
      await api(`/companies/${id}/enabled-roles`, { method: "PUT", json: { enabledRoleKeys: enabledRoles } });
      setSavedRoles(enabledRoles);
      toast({ title: "Roles saved", text: `${enabledRoles.length} roles enabled for ${detail?.company.name}.`, tone: "success" });
      await load();
    } catch (err) {
      toast({ title: "Could not save roles", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function saveBrand() {
    setBusy(true);
    try {
      await api(`/companies/${id}/theme`, { method: "PUT", json: brand });
      toast({ title: "Branding saved", text: "The tenant's login page picks this up immediately.", tone: "success" });
      await load();
    } catch (err) {
      toast({ title: "Could not save branding", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingRow text="Loading company…" />;
  if (error || !detail) {
    return (
      <div className="nx-stack">
        <ErrorState title="Company detail unavailable" detail={error ?? "Not found"} onRetry={() => void load()} />
        <Button onClick={() => navigate("/companies")}>Back to companies</Button>
      </div>
    );
  }

  const c = detail.company;
  const allowed = STATUS_ACTIONS.filter((a) =>
    (a.action === "submit_for_activation" || a.action === "activate") ? c.status !== "active" :
    a.action === "suspend" ? c.status === "active" :
    c.status === "suspended"
  );

  const branchColumns: Column<Detail["branches"][number]>[] = [
    { key: "code", header: "Code", render: (b) => <strong className="nx-num">{b.code}</strong> },
    { key: "name", header: "Branch", render: (b) => b.name },
    { key: "status", header: "Status", render: (b) => <StatusBadge status={b.status} /> },
    { key: "url", header: "Portal", hideBelow: "760px", render: (b) => <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{b.portalUrl ?? "—"}</span> }
  ];

  const staffColumns: Column<Detail["staffByCategory"][number]>[] = [
    { key: "role", header: "Role", render: (s) => s.name },
    { key: "key", header: "Key", hideBelow: "760px", render: (s) => <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{s.roleKey}</span> },
    { key: "n", header: "Workers", numeric: true, render: (s) => <span className="nx-num">{s.workers}</span> }
  ];

  const loginColumns: Column<Detail["recentLogins"][number]>[] = [
    { key: "u", header: "Username", render: (l) => <span className="nx-num">{l.username}</span> },
    { key: "t", header: "Last sign-in", render: (l) => (l.lastLoginAt ? formatRelative(l.lastLoginAt) : "never") },
    { key: "s", header: "State", render: (l) => <StatusBadge status={l.status} /> }
  ];

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        breadcrumbs={<div className="nx-row" style={{ gap: 6, fontSize: "var(--nx-text-sm)" }}>
          <button type="button" className="nx-linkish" onClick={() => navigate("/companies")} style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "var(--nx-color-accent)", cursor: "pointer" }}>Companies</button>
          <span className="nx-faint">/</span>
          <span>{c.name}</span>
        </div>}
        eyebrow={<span className="nx-row" style={{ gap: 8 }}><StatusBadge status={c.status} /> <Badge tone="accent">{c.slug}.nexora.app</Badge></span>}
        title={c.name}
        description={`Created ${formatDate(c.createdAt)} - code prefix ${c.codePrefix} - ${detail.setup.branches} branches, ${detail.setup.workers} workers, ${detail.setup.rolesEnabled} roles enabled.`}
        actions={
          <div className="nx-row" style={{ gap: 8 }}>
            <Button onClick={() => window.open(`https://${c.portalUrl ?? `${c.slug}.nexora.app`}`, "_blank", "noopener")}>
              Open tenant
            </Button>
            {allowed.map((a) => (
              <Button key={a.action} variant={a.tone} onClick={() => setStatusPrompt(a)}>
                {a.label}
              </Button>
            ))}
          </div>
        }
      />

      <Tabs
        items={[
          { key: "overview", label: "Overview" },
          { key: "branding", label: "Branding" },
          { key: "roles", label: "Users and roles", count: detail.setup.rolesEnabled },
          { key: "branches", label: "Branches", count: detail.branches.length },
          { key: "setup", label: "Setup status" },
          { key: "activity", label: "Activity log", count: audit.length },
          { key: "ai", label: "AI configuration" }
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "overview" && (
        <div className="nx-grid nx-grid--2">
          <Card title="Company facts">
            <KV
              items={[
                { label: "Status", value: <StatusBadge status={c.status} /> },
                { label: "Portal url", value: c.portalUrl ?? `${c.slug}.nexora.app` },
                { label: "Contact email", value: c.contactEmail ?? <span className="nx-faint">none recorded</span> },
                { label: "Plan tier", value: c.planTier ?? "standard" },
                { label: "Created", value: formatDate(c.createdAt) },
                { label: "Activated", value: c.activatedAt ? formatDate(c.activatedAt) : <span className="nx-faint">not yet</span> },
                { label: "Suspended", value: c.suspendedAt ? formatDate(c.suspendedAt) : <span className="nx-faint">never</span> },
                { label: "Last activity", value: c.lastActivityAt ? formatRelative(c.lastActivityAt) : <span className="nx-faint">never</span> }
              ]}
            />
          </Card>
          <Card title="Recent MD and worker sign-ins" padded={false}>
            {detail.recentLogins.length === 0 ? (
              <EmptyState title="No sign-ins recorded" text="The tenant has not been used yet." />
            ) : (
              <Table columns={loginColumns} rows={detail.recentLogins} rowKey={(l) => l.username} />
            )}
          </Card>
          <Card title="Staff by role" padded={false}>
            {detail.staffByCategory.length === 0 ? (
              <EmptyState title="No workers yet" text="Workers are created inside the company workspace, not from this console." />
            ) : (
              <Table columns={staffColumns} rows={detail.staffByCategory} rowKey={(s) => s.roleKey} />
            )}
          </Card>
          <Card title="Aggregate footprint">
            <KV
              items={[
                { label: "Branches", value: <span className="nx-num">{detail.setup.branches}</span> },
                { label: "Workers", value: <span className="nx-num">{detail.setup.workers}</span> },
                { label: "Roles enabled", value: <span className="nx-num">{detail.setup.rolesEnabled}</span> },
                { label: "Setup complete", value: detail.setup.complete ? <Badge tone="success" dot>complete</Badge> : <Badge tone="warning" dot>in progress</Badge> }
              ]}
            />
            <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)", marginTop: 10 }}>
              Aggregates only. Individual customer, loan or payment records are never visible from
              the platform console (RULE 3.6.2).
            </p>
          </Card>
        </div>
      )}

      {tab === "branding" && (
        <div className="nx-grid nx-grid--2">
          <Card title="Company colour = highlighter (RULE 13)">
            <div className="nx-stack">
              <Field label="Accent / primary" htmlFor="b-accent" hint="#RRGGBB">
                <div className="nx-row" style={{ gap: 8 }}>
                  <input type="color" aria-label="Accent colour picker" value={brand.accentColor ?? "#0f7b4f"} onChange={(e) => setBrand({ ...brand, accentColor: e.target.value, primaryColor: e.target.value })} style={{ width: 42, height: 34, border: "1px solid var(--nx-border)", borderRadius: 8, padding: 2, background: "var(--nx-surface)" }} />
                  <Input id="b-accent" value={brand.accentColor ?? ""} onChange={(e) => setBrand({ ...brand, accentColor: e.target.value })} placeholder="#0f7b4f" maxLength={7} />
                </div>
              </Field>
              <Field label="Secondary" htmlFor="b-secondary" hint="#RRGGBB">
                <div className="nx-row" style={{ gap: 8 }}>
                  <input type="color" aria-label="Secondary colour picker" value={brand.secondaryColor ?? "#0b3d29"} onChange={(e) => setBrand({ ...brand, secondaryColor: e.target.value })} style={{ width: 42, height: 34, border: "1px solid var(--nx-border)", borderRadius: 8, padding: 2, background: "var(--nx-surface)" }} />
                  <Input id="b-secondary" value={brand.secondaryColor ?? ""} onChange={(e) => setBrand({ ...brand, secondaryColor: e.target.value })} placeholder="#0b3d29" maxLength={7} />
                </div>
              </Field>
              <Field label="Logo url" htmlFor="b-logo" hint="https:// or root-relative">
                <Input id="b-logo" value={brand.logoUrl ?? ""} onChange={(e) => setBrand({ ...brand, logoUrl: e.target.value || null })} />
              </Field>
              <Field label="Font family" htmlFor="b-font">
                <Select id="b-font" value={brand.fontFamily ?? "Poppins"} onChange={(e) => setBrand({ ...brand, fontFamily: e.target.value })}>
                  <option value="Poppins">Poppins</option>
                  <option value="Inter">Inter</option>
                  <option value="Manrope">Manrope</option>
                  <option value="Source Sans 3">Source Sans 3</option>
                </Select>
              </Field>
              <div className="nx-row" style={{ gap: 10 }}>
                <Button variant="primary" onClick={() => void saveBrand()} loading={busy} disabled={!brandDirty}>Save branding</Button>
                {brandDirty && <Badge tone="warning" dot>unsaved changes</Badge>}
              </div>
            </div>
          </Card>
          <Card title="Live preview">
            <BrandPreview brand={brand} companyName={c.name} />
          </Card>
        </div>
      )}

      {tab === "roles" && (
        <Card
          title="Enabled roles (platform ceiling per tenant)"
          actions={
            <>
              <Button size="sm" onClick={() => setEnabledRoles(BUILT_IN_ROLES.map((r) => r.key))}>All</Button>
              <Button size="sm" variant="primary" onClick={() => void saveRoles()} loading={busy} disabled={!rolesDirty}>
                Save roles
              </Button>
            </>
          }
        >
          <p className="nx-muted" style={{ fontSize: "var(--nx-text-sm)", marginBottom: 14 }}>
            Disabling a role prevents new workers from holding it. Existing holders are managed in
            the company workspace.
          </p>
          <div className="nx-grid nx-grid--3">
            {BUILT_IN_ROLES.map((r) => (
              <Checkbox
                key={r.key}
                label={r.name}
                hint={r.key}
                checked={enabledRoles.includes(r.key)}
                onChange={(e) =>
                  setEnabledRoles((prev) => (e.target.checked ? [...prev, r.key] : prev.filter((k) => k !== r.key)))
                }
              />
            ))}
          </div>
          {rolesDirty && (
            <div className="nx-row" style={{ gap: 10, marginTop: 16 }}>
              <Badge tone="warning" dot>{enabledRoles.length} selected (was {savedRoles.length})</Badge>
              <Button variant="ghost" onClick={() => setEnabledRoles(savedRoles)}>Reset</Button>
            </div>
          )}
        </Card>
      )}

      {tab === "branches" && (
        <Card title={`Branches (${detail.branches.length})`} padded={false}>
          {detail.branches.length === 0 ? (
            <EmptyState
              icon={<IconBuilding size={26} />}
              title="No branches provisioned"
              text="Branches are created inside the company workspace by an authorized role (RULE 7.4.1) - this console only lists them."
            />
          ) : (
            <Table columns={branchColumns} rows={detail.branches} rowKey={(b) => b.id} />
          )}
        </Card>
      )}

      {tab === "setup" && (
        <div className="nx-grid nx-grid--2">
          <Card title="Setup status (RULE 3.3.3)">
            <div className="nx-stack">
              <div className="nx-row nx-row--between">
                <span className="nx-muted">Company status</span>
                <StatusBadge status={c.status} />
              </div>
              <div className="nx-row nx-row--between">
                <span className="nx-muted">Setup complete</span>
                {detail.setup.complete ? <Badge tone="success" dot>complete</Badge> : <Badge tone="warning" dot>in setup</Badge>}
              </div>
              <div className="nx-row nx-row--between">
                <span className="nx-muted">Branches</span><strong className="nx-num">{detail.setup.branches}</strong>
              </div>
              <div className="nx-row nx-row--between">
                <span className="nx-muted">Workers</span><strong className="nx-num">{detail.setup.workers}</strong>
              </div>
              <div className="nx-row nx-row--between">
                <span className="nx-muted">Roles enabled</span><strong className="nx-num">{detail.setup.rolesEnabled}</strong>
              </div>
              <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
                A company in setup cannot be signed in to - the login path returns 403
                COMPANY_NOT_OPERATIONAL until it is activated.
              </p>
            </div>
          </Card>
          <Card title="Status controls">
            <div className="nx-stack nx-stack--sm">
              {STATUS_ACTIONS.map((a) => (
                <div key={a.action} className="nx-row nx-row--between" style={{ border: "1px solid var(--nx-border)", borderRadius: "var(--nx-radius)", padding: 12 }}>
                  <div className="nx-stack nx-stack--sm">
                    <strong style={{ fontSize: "var(--nx-text-sm)" }}>{a.label}</strong>
                    <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
                      {a.action === "suspend" && "Ends every session immediately and locks the tenant."}
                      {a.action === "reactivate" && "Restores sign-in; new credentials may be required."}
                      {a.action === "submit_for_activation" && "Moves the draft to pending review."}
                      {a.action === "activate" && "Makes the tenant live immediately (RULE 3.3.3)."}
                    </span>
                  </div>
                  <Button variant={a.tone} size="sm" onClick={() => setStatusPrompt(a)}>
                    {a.label}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "activity" && (
        <Card title="Company activity in the platform trail" padded={false}>
          {audit.length === 0 ? (
            <EmptyState title="No platform events for this company" text="Creation, status changes and support sessions will appear here." />
          ) : (
            <div style={{ padding: 20 }}>
              <Timeline
                items={audit.map((r, i) => ({
                  id: `${String(r.id ?? i)}`,
                  title: <strong>{String(r.action ?? "event")}</strong>,
                  meta: (
                    <span className="nx-row" style={{ gap: 8 }}>
                      <span className="nx-faint">{String(r.actor ?? r.actor_email ?? "platform")}</span>
                      <span className="nx-faint">{formatDateTime(String(r.created_at ?? r.createdAt ?? ""))}</span>
                    </span>
                  ),
                  body: r.snapshot ?? r.details ?? r.changes ? <code style={{ fontSize: "0.75rem" }}>{JSON.stringify(r.snapshot ?? r.details ?? r.changes)}</code> : undefined
                }))}
              />
            </div>
          )}
        </Card>
      )}

      {tab === "ai" && <AiTab companyId={id} initial={detail.aiConfiguration} onSaved={() => void load()} />}

      <ConfirmDialog
        open={statusPrompt !== null}
        onClose={() => { setStatusPrompt(null); setReason(""); }}
        onConfirm={() => void runStatus()}
        title={`${statusPrompt?.label ?? "Status change"} - ${c.name}`}
        body={
          <div className="nx-stack">
            <span>
              {statusPrompt?.action === "suspend"
                ? "Suspending ends every active session for this tenant immediately."
                : statusPrompt?.action === "activate"
                ? "Activating makes the tenant live now - workers can sign in at once."
                : statusPrompt?.action === "reactivate"
                ? "Reactivating restores sign-in for this tenant."
                : "Submitting marks the draft as ready for activation review."}
            </span>
            {statusPrompt?.needsReason && (
              <Field label="Reason (recorded in the audit trail)" htmlFor="status-reason" required>
                <Input id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this tenant being suspended?" />
              </Field>
            )}
          </div>
        }
        confirmLabel={statusPrompt?.label ?? "Confirm"}
        tone={statusPrompt?.tone ?? "primary"}
        busy={busy}
      />
    </div>
  );
}

function AiTab({ companyId, initial, onSaved }: { companyId: string; initial: unknown; onSaved: () => void }) {
  const toast = useToast();
  const [configs, setConfigs] = useState<Json[]>([]);
  const [providers, setProviders] = useState<Json[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<Json[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [c, p] = await Promise.all([
          api<unknown>(`/companies/${companyId}/ai-configuration`),
          api<unknown>("/ai/providers")
        ]);
        setConfigs(itemsOf<Json>(c));
        setProviders(itemsOf<Json>(p));
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [companyId, initial]);

  useEffect(() => {
    if (!provider) {
      setModels([]);
      return;
    }
    void (async () => {
      try {
        setModels(itemsOf<Json>(await api(`/ai/providers/${encodeURIComponent(provider)}/models`)));
      } catch {
        setModels([]);
      }
    })();
  }, [provider]);

  async function createConfig() {
    setBusy(true);
    try {
      await api(`/companies/${companyId}/ai-configuration`, {
        method: "POST",
        json: { provider, model, apiKey: apiKey || null }
      });
      toast({ title: "Configuration saved", text: "Verify it, then activate (RULE 21.1.9).", tone: "success" });
      setApiKey("");
      setConfigs(itemsOf<Json>(await api(`/companies/${companyId}/ai-configuration`)));
      onSaved();
    } catch (err) {
      toast({ title: "Could not save", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, label: string) {
    setBusy(true);
    try {
      await api(path, { method: "POST" });
      toast({ title: label, tone: "success" });
      setConfigs(itemsOf<Json>(await api(`/companies/${companyId}/ai-configuration`)));
      onSaved();
    } catch (err) {
      toast({ title: "Action failed", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const configColumns: Column<Json>[] = [
    { key: "provider", header: "Provider", render: (r) => <strong>{String(r.provider ?? "—")}</strong> },
    { key: "model", header: "Model", render: (r) => String(r.model ?? "—") },
    { key: "state", header: "State", render: (r) => <StatusBadge status={String(r.state ?? r.status ?? "unknown")} /> },
    {
      key: "actions",
      header: "",
      width: "220px",
      render: (r) => {
        const cid = String(r.id ?? "");
        return (
          <div className="nx-row" style={{ gap: 6, justifyContent: "flex-end" }}>
            <Button size="sm" onClick={() => void act(`/ai-configuration/${cid}/verify`, "Verification requested")}>Verify</Button>
            <Button size="sm" variant="primary" onClick={() => void act(`/ai-configuration/${cid}/activate`, "Configuration activated")}>Activate</Button>
          </div>
        );
      }
    }
  ];

  return (
    <div className="nx-grid nx-grid--2">
      <Card title="Configurations for this tenant">
        {error && <ErrorState title="AI configuration unavailable" detail={error} />}
        {!error && configs.length === 0 ? (
          <EmptyState icon={<IconKey size={24} />} title="No AI provider configured" text="Pick a provider and model below. The platform stores the choice; company users cannot change it (RULE 21.1.9)." />
        ) : (
          <Table columns={configColumns} rows={configs} rowKey={(r) => String(r.id ?? r.model ?? "")} />
        )}
      </Card>
      <Card title="Add a configuration">
        <div className="nx-stack">
          <Field label="Provider" htmlFor="ai-provider" required>
            <Select id="ai-provider" value={provider} onChange={(e) => { setProvider(e.target.value); setModel(""); }}>
              <option value="">Select a provider…</option>
              {providers.map((p) => (
                <option key={String(p.id ?? p.name)} value={String(p.id ?? p.name)}>{String(p.name ?? p.id)}</option>
              ))}
              {providers.length === 0 && <option value="opencode">opencode (default)</option>}
            </Select>
          </Field>
          <Field label="Model" htmlFor="ai-model" required>
            {models.length > 0 ? (
              <Select id="ai-model" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">Select a model…</option>
                {models.map((m) => (
                  <option key={String(m.id ?? m.name)} value={String(m.id ?? m.name)}>{String(m.name ?? m.id)}</option>
                ))}
              </Select>
            ) : (
              <Input id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" />
            )}
          </Field>
          <Field label="API key" htmlFor="ai-key" hint="Stored encrypted; never displayed again after saving">
            <Input id="ai-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="optional for local gateways" />
          </Field>
          <div className="nx-row">
            <Button variant="primary" onClick={() => void createConfig()} loading={busy} disabled={!provider || !model} icon={<IconCheck size={15} />}>
              Save configuration
            </Button>
          </div>
          <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
            The OpenCode runtime must be installed in production for verification to succeed; in
            this environment verification reports honestly rather than pretending.
          </p>
        </div>
      </Card>
    </div>
  );
}
