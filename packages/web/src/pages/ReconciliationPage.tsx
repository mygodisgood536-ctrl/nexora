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
  Tabs,
  useToast,
  type Column
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { money, when } from "../lib/format";
import { useResource } from "../lib/useResource";

type TabKey = "exceptions" | "unmatched" | "unallocated" | "corrections";

export function ReconciliationPage() {
  const me = useMe();
  const [tab, setTab] = useState<TabKey>("exceptions");
  const canEdit = me.permissions.includes("edit");
  const canCreate = me.permissions.includes("create");

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Matching exceptions, unmatched and unallocated payments, and the correction workflow (RULE 5.6.3)."
        breadcrumbs={<Crumbs items={[{ label: "Reconciliation" }]} />}
      />
      <Tabs
        items={[
          { key: "exceptions", label: "Matching exceptions" },
          { key: "unmatched", label: "Unmatched payments" },
          { key: "unallocated", label: "Unallocated payments" },
          { key: "corrections", label: "Corrections" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "exceptions" && <Exceptions canEdit={canEdit} />}
        {tab === "unmatched" && <UnmatchedList />}
        {tab === "unallocated" && <UnallocatedList />}
        {tab === "corrections" && <Corrections canCreate={canCreate} />}
      </div>
    </>
  );
}

function Exceptions({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<{ items?: Record<string, unknown>[]; total?: number }>(
    () => api<{ items?: Record<string, unknown>[]; total?: number }>("/reconciliation-items?" + new URLSearchParams({ status: "open", limit: "100" }).toString()),
    []
  );
  const [target, setTarget] = useState<{ row: Record<string, unknown>; action: "resolve" | "dismiss" } | null>(null);
  const rows = data?.items ?? [];

  const cols: Column<Record<string, unknown>>[] = [
    { key: "kind", header: "Kind", render: (r) => <Badge tone="neutral">{String(r.kind ?? r.reason ?? "exception")}</Badge> },
    { key: "ref", header: "Reference", render: (r) => <span className="nx-faint">{String(r.provider_txn_ref ?? r.payment_id ?? r.id ?? "").slice(0, 12)}</span> },
    { key: "detail", header: "Detail", render: (r) => String(r.detail ?? r.description ?? r.reason ?? "—") },
    { key: "amount", header: "Amount", numeric: true, render: (r) => money(r.amount ?? 0) },
    { key: "created", header: "Raised", render: (r) => when(r.created_at) },
    { key: "action", header: "", render: (r) => canEdit ? (
      <>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setTarget({ row: r, action: "dismiss" }); }}>Dismiss</Button>
        <Button size="sm" onClick={(e) => { e.stopPropagation(); setTarget({ row: r, action: "resolve" }); }}>Resolve</Button>
      </>
    ) : null },
  ];

  if (loading) return <LoadingRow text="Loading exceptions…" />;
  if (error) return <ErrorState title="Could not load reconciliation items" detail={error} onRetry={reload} />;
  return (
    <>
      <p className="nx-muted">{rows.length} open exception{rows.length === 1 ? "" : "s"}.</p>
      <Table columns={cols} rows={rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No open matching exceptions.</p>} />
      {target && (
        <ActionModal
          action={target.action}
          onClose={() => setTarget(null)}
          onSubmit={(note) => {
            const t = target;
            setTarget(null);
            void api(`/reconciliation-items/${String(t.row.id)}/${t.action}`, { method: "POST", json: { note } })
              .then(() => { toast({ title: `Item ${t.action === "resolve" ? "resolved" : "dismissed"}`, tone: "success" }); reload(); })
              .catch((err: Error) => toast({ title: "Action failed", text: err.message, tone: "danger" }));
          }}
        />
      )}
    </>
  );
}

function UnmatchedList() {
  const { data, loading, error, reload } = useResource<{ items?: Record<string, unknown>[]; total?: number }>(
    () => api<{ items?: Record<string, unknown>[]; total?: number }>("/payments/unmatched?" + new URLSearchParams({ limit: "100" }).toString()),
    []
  );
  const rows = data?.items ?? [];
  const cols: Column<Record<string, unknown>>[] = [
    { key: "ref", header: "Provider ref", render: (r) => String(r.provider_txn_ref ?? r.providerTxnRef ?? "—") },
    { key: "amount", header: "Amount", numeric: true, render: (r) => money(r.amount ?? 0) },
    { key: "provider", header: "Provider", render: (r) => String(r.provider ?? "—") },
    { key: "received", header: "Received", render: (r) => when(r.created_at ?? r.received_at) },
    { key: "resolved", header: "Resolved", render: (r) => (r.resolved_at ?? r.resolved) ? <Badge tone="success">resolved</Badge> : <Badge tone="warning">open</Badge> },
  ];
  if (loading) return <LoadingRow text="Loading unmatched payments…" />;
  if (error) return <ErrorState title="Could not load unmatched payments" detail={error} onRetry={reload} />;
  return <Table columns={cols} rows={rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No unmatched payments.</p>} />;
}

function UnallocatedList() {
  const { data, loading, error, reload } = useResource<{ items?: Record<string, unknown>[]; total?: number }>(
    () => api<{ items?: Record<string, unknown>[]; total?: number }>("/payments/unallocated?" + new URLSearchParams({ limit: "100" }).toString()),
    []
  );
  const rows = data?.items ?? [];
  const cols: Column<Record<string, unknown>>[] = [
    { key: "customer", header: "Customer", render: (r) => String(r.customer_name ?? r.customer_code ?? r.customer_id ?? "—") },
    { key: "amount", header: "Amount", numeric: true, render: (r) => money(r.amount ?? 0) },
    { key: "method", header: "Method", render: (r) => String(r.method ?? r.channel ?? "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    { key: "received", header: "Received", render: (r) => when(r.created_at) },
  ];
  if (loading) return <LoadingRow text="Loading unallocated payments…" />;
  if (error) return <ErrorState title="Could not load unallocated payments" detail={error} onRetry={reload} />;
  return <Table columns={cols} rows={rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No unallocated payments.</p>} />;
}

function Corrections({ canCreate }: { canCreate: boolean }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<{ corrections?: Record<string, unknown>[] }>(
    () => api<{ corrections?: Record<string, unknown>[] }>("/payments/corrections"),
    []
  );
  const [raising, setRaising] = useState(false);
  const rows = data?.corrections ?? [];

  const cols: Column<Record<string, unknown>>[] = [
    { key: "payment", header: "Payment", render: (r) => <span className="nx-faint">{String(r.paymentId ?? r.payment_id ?? "").slice(0, 8)}</span> },
    { key: "kind", header: "Kind", render: (r) => <Badge tone="neutral">{String(r.kind ?? "—")}</Badge> },
    { key: "reason", header: "Reason", render: (r) => String(r.reason ?? "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    { key: "requested", header: "Requested", render: (r) => when(r.requestedAt ?? r.requested_at) },
    { key: "decided", header: "Decided", render: (r) => when(r.decidedAt ?? r.decided_at) },
  ];

  if (loading) return <LoadingRow text="Loading corrections…" />;
  if (error) return <ErrorState title="Could not load corrections" detail={error} onRetry={reload} />;
  return (
    <>
      {canCreate && <Button size="sm" onClick={() => setRaising(true)}>Request correction</Button>}
      <Table columns={cols} rows={rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No correction requests.</p>} />
      {raising && (
        <RequestCorrectionModal
          onClose={() => setRaising(false)}
          onDone={() => { setRaising(false); toast({ title: "Correction requested", tone: "success" }); reload(); }}
        />
      )}
    </>
  );
}

function RequestCorrectionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [paymentId, setPaymentId] = useState("");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"reversal" | "correction">("reversal");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Request a correction"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || paymentId.trim().length < 8 || reason.trim().length < 10} onClick={() => {
            setBusy(true);
            void api("/payments/corrections", { method: "POST", json: { paymentId, reason, kind } })
              .then(() => onDone())
              .catch((err: Error) => toast({ title: "Could not request correction", text: err.message, tone: "danger" }))
              .finally(() => setBusy(false));
          }}>Request</Button>
        </>
      }
    >
      <p className="nx-muted">Finance prepares the request; only MD, GM or an authorised Auditor may approve it (RULE 5.6.3).</p>
      <div className="nx-form-grid">
        <label className="nx-field"><span>Payment ID *</span><input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} placeholder="uuid" /></label>
        <label className="nx-field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="reversal">Reversal</option>
            <option value="correction">Correction</option>
          </select>
        </label>
        <label className="nx-field" style={{ gridColumn: "1 / -1" }}>
          <span>Reason (min 10 chars) *</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </label>
      </div>
    </Modal>
  );
}

function ActionModal({ action, onClose, onSubmit }: { action: "resolve" | "dismiss"; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title={action === "resolve" ? "Resolve exception" : "Dismiss as benign"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(note || "No further note")} disabled={action === "resolve" && note.trim().length === 0}>{action}</Button>
        </>
      }
    >
      <label className="nx-field">
        <span>Note {action === "resolve" ? "*" : "(optional)"}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </label>
    </Modal>
  );
}