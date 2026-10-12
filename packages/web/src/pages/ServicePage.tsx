import { useState } from "react";
import {
  Badge,
  Button,
  ErrorState,
  LoadingRow,
  Modal,
  PageHeader,
  SearchInput,
  StatusBadge,
  Table,
  Tabs,
  useToast,
  type Column
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { when } from "../lib/format";
import { useListPage } from "./parts";
import { Crumbs } from "./parts";

type TabKey = "corrections" | "payments";

export function ServicePage() {
  const me = useMe();
  const canRaise = me.permissions.includes("create");
  const [tab, setTab] = useState<TabKey>("corrections");
  const [raising, setRaising] = useState(false);

  return (
    <>
      <PageHeader
        title="Service"
        description="Customer queries that touch money are raised as correction requests and decided by an authorised role (RULE 5.6.3)."
        actions={canRaise ? <Button size="sm" onClick={() => setRaising(true)}>Raise correction</Button> : undefined}
        breadcrumbs={<Crumbs items={[{ label: "Service" }]} />}
      />
      <Tabs
        items={[
          { key: "corrections", label: "Correction requests" },
          { key: "payments", label: "Payment explorer" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "corrections" && <Corrections canRaise={canRaise} onRaise={() => setRaising(true)} />}
        {tab === "payments" && <PaymentExplorer />}
      </div>
      {raising && <RaiseModal onClose={() => setRaising(false)} />}
    </>
  );
}

function Corrections({ canRaise, onRaise }: { canRaise: boolean; onRaise: () => void }) {
  const list = useListPage<Record<string, unknown>>("/payments/corrections", {});

  const cols: Column<Record<string, unknown>>[] = [
    { key: "payment", header: "Payment", render: (r) => <span className="nx-faint">{String(r.paymentId ?? r.payment_id ?? "—").slice(0, 8)}</span> },
    { key: "kind", header: "Kind", render: (r) => <Badge tone="neutral">{String(r.kind ?? "—")}</Badge> },
    { key: "reason", header: "Reason", render: (r) => String(r.reason ?? "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    { key: "requested", header: "Requested", render: (r) => when(r.requestedAt ?? r.requested_at) },
    { key: "decided", header: "Decided", render: (r) => when(r.decidedAt ?? r.decided_at) },
  ];

  return (
    <>
      <div className="nx-toolbar">
        {canRaise && <Button size="sm" onClick={onRaise}>Raise a correction</Button>}
        <span className="nx-grow" />
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Reason…" />
      </div>
      {list.loading ? <LoadingRow text="Loading correction requests…" /> : list.error ? (
        <ErrorState title="Could not load correction requests" detail={list.error} onRetry={list.reload} />
      ) : (
        <Table columns={cols} rows={list.rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No correction requests.</p>} />
      )}
    </>
  );
}

function PaymentExplorer() {
  const list = useListPage<Record<string, unknown>>("/payments", {});

  const cols: Column<Record<string, unknown>>[] = [
    { key: "ref", header: "Provider ref", render: (r) => <span className="nx-faint">{String(r.providerTxnRef ?? r.provider_txn_ref ?? "—")}</span> },
    { key: "provider", header: "Provider", render: (r) => String(r.provider ?? "—") },
    { key: "customer", header: "Customer", render: (r) => String(r.customerId ?? r.customer_id ?? "—").slice(0, 8) },
    { key: "amount", header: "Amount", numeric: true, render: (r) => String(r.amount ?? "—") },
    { key: "valueDate", header: "Value date", render: (r) => String(r.valueDate ?? r.value_date ?? "—") },
    { key: "received", header: "Received", render: (r) => when(r.receivedAt ?? r.received_at) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
  ];

  return (
    <>
      <p className="nx-muted">Payments only ever arrive from a provider webhook. No person creates or edits a payment.</p>
      {list.loading ? <LoadingRow text="Loading payments…" /> : list.error ? (
        <ErrorState title="Could not load payments" detail={list.error} onRetry={list.reload} />
      ) : (
        <Table columns={cols} rows={list.rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No payments in your scope.</p>} />
      )}
    </>
  );
}

function RaiseModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [paymentId, setPaymentId] = useState("");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"reversal" | "correction">("reversal");
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title="Raise a correction request"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || paymentId.trim().length < 8 || reason.trim().length < 10}
            onClick={() => {
              setBusy(true);
              void api("/payments/corrections", { method: "POST", json: { paymentId: paymentId.trim(), reason, kind } })
                .then(() => { toast({ title: "Correction requested", text: "It waits in the approver's inbox.", tone: "success" }); onClose(); })
                .catch((err: Error) => toast({ title: "Could not raise the request", text: err.message, tone: "danger" }))
                .finally(() => setBusy(false));
            }}
          >
            Submit
          </Button>
        </>
      }
    >
      <p className="nx-muted">
        A correction never edits a financial record. It asks an authorised approver to post a new linked reversal.
      </p>
      <div className="nx-form-grid">
        <label className="nx-field">
          <span>Payment id *</span>
          <input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} placeholder="uuid of the payment" />
        </label>
        <label className="nx-field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="reversal">Reversal</option>
            <option value="correction">Correction</option>
          </select>
        </label>
        <label className="nx-field" style={{ gridColumn: "1 / -1" }}>
          <span>Reason (min 10 chars) *</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} />
        </label>
      </div>
    </Modal>
  );
}