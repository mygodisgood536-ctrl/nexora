import { Crumbs } from "./parts";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Modal, PageHeader, SearchInput, StatusBadge, Table, useToast, type Column as TColumn } from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { day } from "../lib/format";
import { useListPage } from "./parts";

export function GroupsPage() {
  const navigate = useNavigate();
  const me = useMe();
  const { rows, total, loading, error, reload, offset, setOffset, search, setSearch, status, setStatus } = useListPage<Record<string, unknown>>("/groups");
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const canCreate = me.permissions.includes("create");

  const columns = useMemo<TColumn<Record<string, unknown>>[]>(() => [
    { key: "name", header: "Group", render: (r) => <><strong>{String(r.name)}</strong><div className="nx-faint">{String(r.group_number ?? "")}</div></> },
    { key: "address", header: "Address", render: (r) => String(r.group_address ?? "—") },
    { key: "members", header: "Members", numeric: true, render: (r) => String(r.member_count ?? 0) },
    { key: "created", header: "Formed", render: (r) => day(r.date_created ?? r.created_at) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
  ], []);

  return (
    <>
      <PageHeader
        title="Groups"
        description="Savings-and-loan groups, their members and ledgers."
        actions={canCreate ? <Button size="sm" onClick={() => setCreating(true)}>Create group</Button> : undefined}
        breadcrumbs={<Crumbs items={[{ label: "Groups" }]} />}
      />
      <div className="nx-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Group name or number…" />
        <span className="nx-grow" />
        <select className="nx-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by group status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      {loading ? <p className="nx-muted">Loading…</p> : error ? <p className="nx-muted">Could not load groups ({error})</p> : (
        <Table columns={columns} rows={rows} rowKey={(r) => String(r.id)} onRowClick={(r) => navigate(`/groups/${String(r.id)}`)} empty={<p className="nx-muted">No groups found.</p>} />
      )}
      {total > 0 && (
        <div className="nx-pagination">
          <span>{offset + 1}–{Math.min(offset + 25, total)} of {total}</span>
          <div className="nx-grow" />
          <Button size="sm" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</Button>
          <Button size="sm" disabled={offset + 25 >= total} onClick={() => setOffset(offset + 25)}>Next</Button>
        </div>
      )}
      {creating && <CreateGroupModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); toast({ title: "Group created", tone: "success" }); reload(); }} />}
    </>
  );
}

function CreateGroupModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const { rows: branches } = useListPage<Record<string, unknown>>("/branches");
  const [form, setForm] = useState({ branchId: "", name: "", groupNumber: "", groupAddress: "", dateCreated: "", description: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Create group" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !form.branchId || !form.name || !form.groupNumber || !form.groupAddress || !form.dateCreated} onClick={() => {
          setBusy(true);
          void api("/groups", { method: "POST", json: { ...form, description: form.description || null } })
            .then(() => onCreated())
            .catch((err: Error) => toast({ title: "Could not create group", text: err.message, tone: "danger" }))
            .finally(() => setBusy(false));
        }}>Create</Button>
      </>
    }>
      <div className="nx-form-grid">
        <label className="nx-field">
          <span>Branch *</span>
          <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
            <option value="">Select branch…</option>
            {branches.map((b) => <option key={String(b.id)} value={String(b.id)}>{String(b.name)}</option>)}
          </select>
        </label>
        <label className="nx-field"><span>Group name *</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="nx-field"><span>Group number *</span><input value={form.groupNumber} onChange={(e) => setForm({ ...form, groupNumber: e.target.value })} /></label>
        <label className="nx-field"><span>Group address *</span><input value={form.groupAddress} onChange={(e) => setForm({ ...form, groupAddress: e.target.value })} /></label>
        <label className="nx-field">
          <span>Formed on *</span>
          <input type="date" value={form.dateCreated} onChange={(e) => setForm({ ...form, dateCreated: e.target.value })} />
        </label>
        <label className="nx-field"><span>Description</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      </div>
    </Modal>
  );
}