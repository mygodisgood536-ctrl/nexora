import { Crumbs } from "./parts";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  ConfirmDialog,
  ErrorState,
  KV,
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
import { day, money, personName } from "../lib/format";
import { useResource } from "../lib/useResource";

export function GroupDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const toast = useToast();
  const { data: g, loading, error, reload } = useResource<Record<string, unknown>>(() => api.get(`/groups/${id}`), [id]);
  const { data: members, reload: reloadMembers } = useResource<Record<string, unknown>[]>(
    () => api.get<Record<string, unknown>[]>(`/groups/${id}/members`).then((r) => (Array.isArray(r) ? r : [])),
    [id]
  );
  const { data: ledger } = useResource<Record<string, unknown>[]>(
    () => api.get<Record<string, unknown>[]>(`/groups/${id}/ledger`).then((r) => (Array.isArray(r) ? r : [])),
    [id]
  );
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(false);

  const canAssign = me.permissions.includes("assign");
  const canEdit = me.permissions.includes("edit");

  if (loading) return <LoadingRow text="Loading group…" />;
  if (error || !g) return <ErrorState title="Could not load this group" detail={error ?? undefined} onRetry={reload} />;

  const memberCols: Column<Record<string, unknown>>[] = [
    { key: "name", header: "Member", render: (r) => <><strong>{String(r.full_name ?? r.name ?? personName(r))}</strong><div className="nx-faint">{String(r.group_role ?? "—")}</div></> },
    { key: "father", header: "Father / husband", render: (r) => String(r.father_husband_name ?? "—") },
    { key: "marital", header: "Marital status", render: (r) => String((r.marital_status ?? "—").toString().replace(/_/g, " ")) },
    { key: "phone", header: "Phone", render: (r) => String(r.phone ?? "—") },
  ];

  const ledgerCols: Column<Record<string, unknown>>[] = [
    { key: "date", header: "Date", render: (r) => day(r.date ?? r.created_at) },
    { key: "desc", header: "Description", render: (r) => String(r.description ?? "—") },
    { key: "type", header: "Type", render: (r) => <StatusBadge status={String(r.type ?? "")} /> },
    { key: "in", header: "In", numeric: true, render: (r) => money(r.credit ?? r.in ?? 0) },
    { key: "out", header: "Out", numeric: true, render: (r) => money(r.debit ?? r.out ?? 0) },
    { key: "balance", header: "Balance", numeric: true, render: (r) => money(r.balance ?? 0) },
  ];

  return (
    <>
      <PageHeader
        title={String(g.name)}
        eyebrow={`${String(g.group_number ?? "")} · ${String(g.member_count ?? 0)} members`}
        description={String(g.group_address ?? "")}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>Back</Button>
            {canAssign && <Button size="sm" onClick={() => setAdding(true)}>Add member</Button>}
            {canEdit && String(g.status) === "active" && (
              <Button variant="secondary" size="sm" onClick={() => setClosing(true)}>Close group</Button>
            )}
          </>
        }
        breadcrumbs={<Crumbs items={[{ label: "Groups" }, { label: String(g.name) }]} />}
      />
      <div className="nx-grid nx-grid--2">
        <section className="nx-panel">
          <h3 className="nx-h3">Details</h3>
          <KV items={[
            { label: "Group number", value: String(g.group_number ?? "—") },
            { label: "Address", value: String(g.group_address ?? "—") },
            { label: "Description", value: String(g.description ?? "—") },
            { label: "Members", value: String(g.member_count ?? 0) },
            { label: "Status", value: <StatusBadge status={String(g.status ?? "unknown")} /> },
            { label: "Formed", value: day(g.date_created ?? g.created_at) },
          ]} />
        </section>
        <section className="nx-panel">
          <h3 className="nx-h3">Ledger</h3>
          <Table columns={ledgerCols} rows={ledger ?? []} rowKey={(r) => String(r.id ?? r.created_at ?? r.description)} empty={<p className="nx-muted">No ledger entries for this period.</p>} />
        </section>
      </div>
      <section className="nx-panel" style={{ marginTop: 16 }}>
        <h3 className="nx-h3">Members</h3>
        <Table columns={memberCols} rows={members ?? []} rowKey={(r) => String(r.customer_id ?? r.id)} empty={<p className="nx-muted">No members yet.</p>} />
      </section>

      {adding && (
        <AddMemberModal
          groupId={id}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); reloadMembers(); reload(); toast({ title: "Member added", tone: "success" }); }}
        />
      )}
      {closing && (
        <ConfirmDialog
          open
          title="Close this group?"
          confirmLabel="Close group"
          onClose={() => setClosing(false)}
          onConfirm={() => {
            setClosing(false);
            void api(`/groups/${id}/close`, { method: "POST", json: { reason: "Closed from the group profile" } })
              .then(() => { toast({ title: "Group closed", tone: "success" }); reload(); })
              .catch((err: Error) => toast({ title: "Could not close group", text: err.message, tone: "danger" }));
          }} body={
            "Closing prevents further group activity and is recorded in the audit trail."
          } />
      )}
    </>
  );
}

function AddMemberModal({ groupId, onClose, onDone }: { groupId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ customerId: "", fullName: "", fatherHusbandName: "", maritalStatus: "", phone: "", groupRole: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Add member" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !form.customerId || !form.fullName || !form.fatherHusbandName || !form.maritalStatus || !form.phone || !form.groupRole} onClick={() => {
          setBusy(true);
          void api(`/groups/${groupId}/members`, { method: "POST", json: form })
            .then(() => onDone())
            .catch((err: Error) => toast({ title: "Could not add member", text: err.message, tone: "danger" }))
            .finally(() => setBusy(false));
        }}>Add</Button>
      </>
    }>
      <div className="nx-form-grid">
        <label className="nx-field"><span>Customer ID *</span><input value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} placeholder="uuid" /></label>
        <label className="nx-field"><span>Full name *</span><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
        <label className="nx-field"><span>Father / husband name *</span><input value={form.fatherHusbandName} onChange={(e) => setForm({ ...form, fatherHusbandName: e.target.value })} /></label>
        <label className="nx-field">
          <span>Marital status *</span>
          <select value={form.maritalStatus} onChange={(e) => setForm({ ...form, maritalStatus: e.target.value })}>
            <option value="">Select…</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="divorced">Divorced</option>
            <option value="widowed">Widowed</option>
          </select>
        </label>
        <label className="nx-field"><span>Phone *</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label className="nx-field"><span>Group role *</span><input value={form.groupRole} onChange={(e) => setForm({ ...form, groupRole: e.target.value })} placeholder="e.g. chairperson" /></label>
      </div>
    </Modal>
  );
}