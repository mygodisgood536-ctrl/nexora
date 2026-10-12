import { Crumbs } from "./parts";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Modal, PageHeader, SearchInput, StatusBadge, Table, useToast, type Column as TColumn } from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { day, personName } from "../lib/format";
import { useListPage } from "./parts";

export function CustomersPage() {
  const navigate = useNavigate();
  const me = useMe();
  const { rows, total, loading, error, reload, offset, setOffset, search, setSearch, status, setStatus } = useListPage<Record<string, unknown>>("/customers");
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const canCreate = me.permissions.includes("register_customer");

  const columns: TColumn<Record<string, unknown>>[] = [
    { key: "name", header: "Customer", render: (r) => <><strong>{personName(r)}</strong><div className="nx-faint">{String(r.customer_code ?? "—")}</div></> },
    { key: "phone", header: "Phone", render: (r) => String(r.phone ?? "—") },
    { key: "branch", header: "Branch", render: (r) => String(typeof r.branch_id === "string" ? r.branch_id.slice(0, 8) : "—") },
    { key: "kyc", header: "KYC", render: (r) => <StatusBadge status={r.kyc_complete ? "complete" : "incomplete"} label={r.kyc_complete ? "complete" : "incomplete"} /> },
    { key: "profile", header: "Profile", render: (r) => <StatusBadge status={r.profile_complete ? "complete" : "incomplete"} label={r.profile_complete ? "complete" : "incomplete"} /> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    { key: "created", header: "Created", render: (r) => day(r.created_at) },
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        description="The customer register with KYC and profile completeness."
        actions={canCreate ? <Button size="sm" onClick={() => setCreating(true)}>Register customer</Button> : undefined}
        breadcrumbs={<Crumbs items={[{ label: "Customers" }]} />}
      />
      <div className="nx-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Name, code, phone…" />
        <span className="nx-grow" />
        <select className="nx-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by customer status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      {loading ? <p className="nx-muted">Loading…</p> : error ? <p className="nx-muted">Could not load customers ({error})</p> : (
        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => String(r.id)}
          onRowClick={(r) => navigate(`/customers/${String(r.id)}`)}
          empty={<p className="nx-muted">No customers found.</p>}
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
      {creating && <RegisterCustomerModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); toast({ title: "Customer registered", tone: "success" }); reload(); }} />}
    </>
  );
}

function RegisterCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const { rows: branches } = useListPage<Record<string, unknown>>("/branches");
  const [form, setForm] = useState({ branchId: "", firstName: "", middleName: "", lastName: "", phone: "", email: "", address: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Register customer" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !form.branchId || !form.firstName || !form.lastName || !form.address} onClick={() => {
          setBusy(true);
          void api("/customers", { method: "POST", json: { ...form, middleName: form.middleName || null, phone: form.phone || null, email: form.email || null } })
            .then(() => onCreated())
            .catch((err: Error) => toast({ title: "Could not register customer", text: err.message, tone: "danger" }))
            .finally(() => setBusy(false));
        }}>Register</Button>
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
        <label className="nx-field"><span>First name *</span><input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
        <label className="nx-field"><span>Middle name</span><input value={form.middleName} onChange={(e) => setForm({ ...form, middleName: e.target.value })} /></label>
        <label className="nx-field"><span>Last name *</span><input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
        <label className="nx-field"><span>Phone</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label className="nx-field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label className="nx-field"><span>Address *</span><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
      </div>
    </Modal>
  );
}