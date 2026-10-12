import { Crumbs } from "./parts";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Modal,
  PageHeader,
  SearchInput,
  StatusBadge,
  Table,
  useToast,
  type Column as TColumn
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { day, personName } from "../lib/format";
import { useListPage } from "./parts";

export function PeoplePage() {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const { rows, total, loading, error, reload, offset, setOffset, search, setSearch, status, setStatus } = useListPage<Record<string, unknown>>("/workers");
  const [creating, setCreating] = useState(false);

  const canManage = me.permissions.includes("manage_workers");

  const cref = useMemo(() => {
    if (!canManage) return null;
    return (
      <>
        <Button size="sm" onClick={() => setCreating(true)}>Add worker</Button>
      </>
    );
  }, [canManage]);

  const columns: TColumn<Record<string, unknown>>[] = [
    { key: "name", header: "Worker", render: (r) => <><strong>{personName(r)}</strong><div className="nx-faint">{String(r.worker_code ?? "—")}</div></> },
    { key: "username", header: "Username", render: (r) => String(r.username ?? "—") },
    { key: "phone", header: "Phone", render: (r) => String(r.phone ?? "—") },
    { key: "branch", header: "Branch", render: (r) => String(typeof r.branch_id === "string" ? r.branch_id.slice(0, 8) : "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    { key: "cred", header: "Credentials", render: (r) => <StatusBadge status={String(r.credential_state ?? "unknown")} label={String(r.credential_state ?? "unknown").replace(/_/g, " ")} /> },
    { key: "last_login", header: "Last login", render: (r) => day(r.last_login_at) },
  ];

  return (
    <>
      <PageHeader
        title="People"
        description="Workers, their role assignments, credential state and portfolio controls."
        actions={cref}
        breadcrumbs={<Crumbs items={[{ label: "People" }]} />}
      />
      <div className="nx-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Name, worker code or username…" />
        <span className="nx-grow" />
        <select className="nx-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="terminated">Terminated</option>
        </select>
      </div>
      {loading ? <Badge tone="neutral">Loading…</Badge> : error ? <p className="nx-muted">Could not load people ({error})</p> : (
        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => String(r.id)}
          onRowClick={(r) => navigate(`/people/${String(r.id)}`)}
          empty={<p className="nx-muted">No workers found.</p>}
        />
      )}
      {total > 0 && (
        <div className="nx-pagination">
          <span>{offset + 1}–{Math.min(offset + 25, total)} of {total}</span>
          <div className="nx-grow" />
          <Button size="sm" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</Button>
          <Button size="sm" disabled={offset + 25 >= total} onClick={() => setOffset(offset + 25)}>Next</Button>
        </div>
      )}
      {creating && (
        <CreateWorkerModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            toast({ title: "Worker created", text: "A credential reset message was prepared for the new worker.", tone: "success" });
            reload();
          }}
        />
      )}
    </>
  );
}

function CreateWorkerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    phone: "",
    email: "",
    branchId: "",
    roleKey: "collection_officer",
    scopeType: "single_branch"
  });
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    void api("/workers", {
      method: "POST",
      json: {
        ...form,
        middleName: form.middleName || null,
        phone: form.phone || null,
        email: form.email || null
      }
    })
      .then((r) => {
        const body = r as { temporaryPassword?: string };
        if (body.temporaryPassword) {
          toast({ title: "Temporary password", text: body.temporaryPassword });
        }
        onCreated();
      })
      .catch((err: Error) => toast({ title: "Could not create worker", text: err.message, tone: "danger" }))
      .finally(() => setBusy(false));
  };

  const { rows: branches } = useListPage<Record<string, unknown>>("/branches");

  return (
    <Modal open onClose={onClose} title="Add worker" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy || !form.firstName || !form.lastName || !form.branchId}>Create worker</Button>
      </>
    }>
      <div className="nx-form-grid">
        <label className="nx-field"><span>First name *</span><input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
        <label className="nx-field"><span>Middle name</span><input value={form.middleName} onChange={(e) => setForm({ ...form, middleName: e.target.value })} /></label>
        <label className="nx-field"><span>Last name *</span><input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
        <label className="nx-field"><span>Phone</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label className="nx-field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label className="nx-field">
          <span>Branch *</span>
          <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
            <option value="">Select branch…</option>
            {branches.map((b) => (
              <option key={String(b.id)} value={String(b.id)}>{String(b.name)}</option>
            ))}
          </select>
        </label>
        <label className="nx-field">
          <span>Role</span>
          <select value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
            <option value="collection_officer">Collection officer</option>
            <option value="senior_collection_officer">Senior collection officer</option>
            <option value="recovery_officer">Recovery officer</option>
            <option value="customer_service_officer">Customer service officer</option>
            <option value="accountant">Accountant</option>
            <option value="assistant_accountant">Assistant accountant</option>
            <option value="hr_officer">HR officer</option>
            <option value="mis_reporting_officer">MIS reporting officer</option>
            <option value="internal_auditor">Internal auditor</option>
            <option value="compliance_officer">Compliance officer</option>
          </select>
        </label>
        <label className="nx-field">
          <span>Scope</span>
          <select value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value })}>
            <option value="single_branch">This branch</option>
            <option value="multi_branch">Multiple branches</option>
            <option value="head_office">Head office</option>
            <option value="company_wide">Company wide</option>
            <option value="assigned_customers_groups_loans">Assigned customers / groups / loans</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}