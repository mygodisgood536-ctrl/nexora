import { Crumbs } from "./parts";
import { useState } from "react";
import {
  Button,
  ConfirmDialog,
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
import { day } from "../lib/format";
import { useResource } from "../lib/useResource";

type Action = "open" | "suspend" | "reactivate" | "close";

export function BranchesPage() {
  const me = useMe();
  const toast = useToast();
  const { data: rows, loading, error, reload } = useResource<Record<string, unknown>[]>(
    () => api.get<Record<string, unknown>[]>("/branches"),
    []
  );
  const [creating, setCreating] = useState(false);
  const [transition, setTransition] = useState<{ id: string; name: string; action: Action } | null>(null);

  const canCreate = me.permissions.includes("create_branch");

  const run = () => {
    if (!transition) return;
    const t = transition;
    setTransition(null);
    void api(`/branches/${t.id}/status`, { method: "POST", json: { action: t.action } })
      .then(() => {
        toast({ title: `Branch ${t.action}`, text: `${t.name} is now ${t.action.replace(/_/g, " ")}.`, tone: "success" });
        reload();
      })
      .catch((err: Error) => toast({ title: "Could not change branch status", text: err.message, tone: "danger" }));
  };

  const columns: Column<Record<string, unknown>>[] = [
    { key: "name", header: "Branch", render: (r) => <><strong>{String(r.name)}</strong><div className="nx-faint">{String(r.code ?? "")} · {String(r.slug ?? "")}</div></> },
    { key: "address", header: "Address", render: (r) => String(r.address ?? "—") },
    { key: "phone", header: "Phone", render: (r) => String(r.phone ?? "—") },
    { key: "email", header: "Email", render: (r) => String(r.email ?? "—") },
    { key: "portal", header: "Portal", render: (r) => <span className="nx-faint">{String(r.portal_url ?? "—")}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    { key: "created", header: "Created", render: (r) => day(r.created_at) },
    {
      key: "actions",
      header: "",
      width: "120px",
      render: (r) =>
        canCreate ? (
          <select
            className="nx-select"
            aria-label="Branch actions"
            value=""
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = e.target.value as Action;
              if (v) setTransition({ id: String(r.id), name: String(r.name), action: v });
            }}
          >
            <option value="">Actions…</option>
            <option value="open" disabled={String(r.status) === "active" || String(r.status) === "suspended"}>Open</option>
            <option value="suspend" disabled={String(r.status) !== "active"}>Suspend</option>
            <option value="reactivate" disabled={String(r.status) !== "suspended"}>Reactivate</option>
            <option value="close">Close</option>
          </select>
        ) : null
    }
  ];

  return (
    <>
      <PageHeader
        title="Branches"
        description="The branch register, lifecycles and portals (RULE 7.2)."
        actions={canCreate ? <Button size="sm" onClick={() => setCreating(true)}>Add branch</Button> : undefined}
        breadcrumbs={<Crumbs items={[{ label: "Branches" }]} />}
      />
      {loading ? <LoadingRow text="Loading branches…" /> : error ? <ErrorState title="Could not load branches" detail={error} onRetry={reload} /> : (
        <Table columns={columns} rows={rows ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No branches found.</p>} />
      )}

      {creating && <CreateBranchModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); toast({ title: "Branch created", tone: "success" }); reload(); }} />}

      {transition && (
        <ConfirmDialog
          open
          title={`${transition.action.replace(/_/g, " ")} "${transition.name}"?`}
          confirmLabel={transition.action.replace(/_/g, " ")}
          onClose={() => setTransition(null)}
          onConfirm={run} body={
            "This is recorded in the branch audit trail."
          } />
      )}
    </>
  );
}

function CreateBranchModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", address: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Add branch" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !form.name || !form.address} onClick={() => {
          setBusy(true);
          void api("/branches", { method: "POST", json: { ...form, phone: form.phone || null, email: form.email || null } })
            .then(() => onCreated())
            .catch((err: Error) => toast({ title: "Could not create branch", text: err.message, tone: "danger" }))
            .finally(() => setBusy(false));
        }}>Create</Button>
      </>
    }>
      <div className="nx-form-grid">
        <label className="nx-field"><span>Branch name *</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="nx-field"><span>Address *</span><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <label className="nx-field"><span>Phone</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label className="nx-field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
      </div>
    </Modal>
  );
}