import { Crumbs } from "./parts";
import { useState } from "react";
import {
  Badge,
  Button,
  ErrorState,
  LoadingRow,
  Modal,
  PageHeader,
  StatusBadge,
  Table,
  useToast,
  type Column
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { useResource } from "../lib/useResource";

interface RegistryEntry {
  code?: string;
  name?: string;
  status?: string;
  requirementSet?: unknown;
  capabilityFlags?: unknown;
}

export function ProvidersPage() {
  const me = useMe();
  const toast = useToast();
  const { data: configs, loading, error, reload } = useResource<Record<string, unknown>[]>(
    () => api.get<Record<string, unknown>[]>("/payment-providers").then((r) => (Array.isArray(r) ? r : [])),
    []
  );
  const { data: registry } = useResource<RegistryEntry[]>(
    () => api.get<RegistryEntry[]>("/payment-providers/registry").then((r) => (Array.isArray(r) ? r : [])),
    []
  );
  const [creating, setCreating] = useState(false);

  const canConfigure = me.permissions.includes("configure");

  const configCols: Column<Record<string, unknown>>[] = [
    { key: "provider", header: "Provider", render: (r) => <strong>{String(r.provider ?? "—")}</strong> },
    { key: "branch", header: "Scope", render: (r) => (r.branchId ?? r.branch_id) ? <span className="nx-faint">{String(r.branchId ?? r.branch_id).slice(0, 8)}</span> : <Badge tone="neutral">company</Badge> },
    { key: "url", header: "API base URL", render: (r) => String(r.apiBaseUrl ?? r.api_base_url ?? "—") },
    { key: "active", header: "Active", render: (r) => (r.isActive ?? r.is_active) ? <Badge tone="success">active</Badge> : <Badge tone="neutral">inactive</Badge> },
    { key: "md", header: "MD approval", render: (r) => <StatusBadge status={(r.mdApproved ?? r.md_approved) ? "approved" : "pending"} /> },
    { key: "action", header: "", render: (r) => canConfigure ? (
      <Button size="sm" variant="ghost" onClick={(e) => {
        e.stopPropagation();
        void api(`/payment-providers/${String(r.id)}/test`, { method: "POST" })
          .then((res) => toast({ title: "Connection test", text: JSON.stringify(res) }))
          .catch((err: Error) => toast({ title: "Test failed", text: err.message, tone: "danger" }));
      }}>Test</Button>
    ) : null },
  ];

  const registryCols: Column<Record<string, unknown>>[] = [
    { key: "code", header: "Code", render: (r) => <strong>{String(r.code ?? "—")}</strong> },
    { key: "name", header: "Name", render: (r) => String(r.name ?? "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    {
      key: "flags",
      header: "Capabilities",
      render: (r) => {
        const flags = r.capabilityFlags as Record<string, unknown> | undefined;
        if (!flags) return "—";
        const on = Object.entries(flags).filter(([, v]) => v === true).map(([k]) => k);
        return on.length ? on.map((k) => <Badge key={k} tone="info">{k.replace(/_/g, " ")}</Badge>) : <span className="nx-faint">none declared</span>;
      }
    },
  ];

  return (
    <>
      <PageHeader
        title="Providers"
        description="Configured payment provider connections and the shipped provider registry (Part 8)."
        actions={canConfigure ? <Button size="sm" onClick={() => setCreating(true)}>Add connection</Button> : undefined}
        breadcrumbs={<Crumbs items={[{ label: "Providers" }]} />}
      />
      <section className="nx-panel">
        <h3 className="nx-h3">Company connections</h3>
        {loading ? <LoadingRow text="Loading connections…" /> : error ? <ErrorState title="Could not load provider connections" detail={error} onRetry={reload} /> : (
          <Table columns={configCols} rows={configs ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No provider connection configured yet.</p>} />
        )}
      </section>
      <section className="nx-panel" style={{ marginTop: 16 }}>
        <h3 className="nx-h3">Registry</h3>
        <p className="nx-faint">Platform-owned list of the providers Nexora ships with.</p>
        <Table columns={registryCols} rows={(registry as Record<string, unknown>[] | null) ?? []} rowKey={(r) => String(r.code)} empty={<p className="nx-muted">Registry unavailable.</p>} />
      </section>

      {creating && <AddConnectionModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); toast({ title: "Connection created", tone: "success" }); reload(); }} />}
    </>
  );
}

function AddConnectionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ provider: "", apiBaseUrl: "", apiKey: "", branchId: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Add provider connection"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !form.provider || !form.apiBaseUrl} onClick={() => {
            setBusy(true);
            void api("/payment-providers", {
              method: "POST",
              json: { provider: form.provider, apiBaseUrl: form.apiBaseUrl, apiKey: form.apiKey || null, branchId: form.branchId || null }
            })
              .then(() => onDone())
              .catch((err: Error) => toast({ title: "Could not create connection", text: err.message, tone: "danger" }))
              .finally(() => setBusy(false));
          }}>Create</Button>
        </>
      }
    >
      <div className="nx-form-grid">
        <label className="nx-field"><span>Provider *</span><input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="e.g. paystack" /></label>
        <label className="nx-field"><span>API base URL *</span><input value={form.apiBaseUrl} onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })} placeholder="https://…" /></label>
        <label className="nx-field"><span>API key (masked after save)</span><input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></label>
        <label className="nx-field"><span>Branch scope (blank = company)</span><input value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} placeholder="uuid" /></label>
      </div>
      <p className="nx-faint">A new connection stays inactive until the MD approves the change.</p>
    </Modal>
  );
}