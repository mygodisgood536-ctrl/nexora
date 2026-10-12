import { Crumbs } from "./parts";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Modal, PageHeader, StatusBadge, Table, useToast, type Column as TColumn } from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { day, money } from "../lib/format";
import { useListPage } from "./parts";

const STATUSES = ["", "submitted", "in_review", "information_requested", "approved", "rejected", "disbursed", "withdrawn"];

export function CreditPage() {
  const navigate = useNavigate();
  const me = useMe();
  const { rows, total, loading, error, reload, offset, setOffset, status, setStatus } = useListPage<Record<string, unknown>>("/loan-applications");
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const canCreate = me.permissions.includes("create");

  const columns = useMemo<TColumn<Record<string, unknown>>[]>(() => [
    { key: "id", header: "Application", render: (r) => <span className="nx-faint">{String(r.id).slice(0, 8)}</span> },
    { key: "customer", header: "Customer", render: (r) => <span className="nx-faint">{String(r.customer_id).slice(0, 8)}</span> },
    { key: "principal", header: "Principal", numeric: true, render: (r) => money(r.principal_amount) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    { key: "stage", header: "Stage", numeric: true, render: (r) => String(r.current_stage_order ?? "—") },
    { key: "created", header: "Created", render: (r) => day(r.created_at) },
    { key: "decided", header: "Decided", render: (r) => day(r.decided_at) },
  ], []);

  return (
    <>
      <PageHeader
        title="Credit"
        description="Loan applications through the approval chain, terms, guarantor and disbursement."
        actions={canCreate ? <Button size="sm" onClick={() => setCreating(true)}>New application</Button> : undefined}
        breadcrumbs={<Crumbs items={[{ label: "Credit" }]} />}
      />
      <div className="nx-toolbar">
        <span className="nx-faint">Status</span>
        <select className="nx-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by application status">
          {STATUSES.map((s) => <option key={s} value={s}>{s === "" ? "All statuses" : s.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      {loading ? <p className="nx-muted">Loading…</p> : error ? <p className="nx-muted">Could not load applications ({error})</p> : (
        <Table columns={columns} rows={rows} rowKey={(r) => String(r.id)} onRowClick={(r) => navigate(`/credit/${String(r.id)}`)} empty={<p className="nx-muted">No loan applications yet.</p>} />
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
        <NewApplicationModal
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); toast({ title: "Application created", tone: "success" }); reload(); navigate(`/credit/${id}`); }}
        />
      )}
    </>
  );
}

function NewApplicationModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const { rows: customers } = useListPage<Record<string, unknown>>("/customers");
  const { rows: products } = useListPage<Record<string, unknown>>("/loan-products");
  const [form, setForm] = useState({ customerId: "", productId: "", principalAmount: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New loan application" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          disabled={busy || !form.customerId || !form.productId || !Number(form.principalAmount)}
          onClick={() => {
            setBusy(true);
            void api("/loan-applications", { method: "POST", json: { ...form, principalAmount: Number(form.principalAmount) } })
              .then((r) => onCreated(String((r as { id: string }).id)))
              .catch((err: Error) => toast({ title: "Could not create application", text: err.message, tone: "danger" }))
              .finally(() => setBusy(false));
          }}
        >
          Create
        </Button>
      </>
    }>
      <div className="nx-form-grid">
        <label className="nx-field">
          <span>Customer *</span>
          <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
            <option value="">Select customer…</option>
            {customers.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>
                {String(c.first_name ?? "")} {String(c.last_name ?? "")} · {String(c.customer_code ?? "")}
              </option>
            ))}
          </select>
        </label>
        <label className="nx-field">
          <span>Loan product *</span>
          <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
            <option value="">Select product…</option>
            {products.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
          </select>
        </label>
        <label className="nx-field">
          <span>Principal amount *</span>
          <input inputMode="decimal" value={form.principalAmount} onChange={(e) => setForm({ ...form, principalAmount: e.target.value })} />
        </label>
      </div>
    </Modal>
  );
}