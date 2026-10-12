import { useState } from "react";
import {
  Badge,
  Button,
  ErrorState,
  KV,
  LoadingRow,
  Modal,
  PageHeader,
  Table,
  Tabs,
  useToast,
  type Column
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { money, personName, todayParam, when } from "../lib/format";
import { useResource } from "../lib/useResource";
import { Crumbs } from "./parts";

type TabKey = "assignments" | "allocation" | "visits";

export function FieldPage() {
  const me = useMe();
  const canCreate = me.permissions.includes("create");
  const canAllocate = me.permissions.includes("allocate");
  const [tab, setTab] = useState<TabKey>("assignments");
  const [logging, setLogging] = useState(false);

  return (
    <>
      <PageHeader
        title="Field"
        description="Your book, the allocation queue, and the visit log. Money figures come from the payment pipeline only."
        actions={canCreate ? <Button size="sm" onClick={() => setLogging(true)}>Record visit</Button> : undefined}
        breadcrumbs={<Crumbs items={[{ label: "Field" }]} />}
      />
      <Tabs
        items={[
          { key: "assignments", label: "My book" },
          { key: "allocation", label: "Awaiting allocation" },
          { key: "visits", label: "Visit log" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "assignments" && <Assignments />}
        {tab === "allocation" && <Allocation canAllocate={canAllocate} />}
        {tab === "visits" && <Visits />}
      </div>
      {logging && <VisitModal onClose={() => setLogging(false)} onDone={() => setLogging(false)} />}
    </>
  );
}

function Assignments() {
  const me = useMe();
  const { data, loading, error, reload } = useResource<{ items?: Record<string, unknown>[]; total?: number }>(
    () => api.get(`/customer-assignments?status=active&staffId=${me.userId}`),
    [me.userId]
  );

  const cols: Column<Record<string, unknown>>[] = [
    { key: "subject", header: "Subject", render: (r) => String(r.customer_name ?? r.group_name ?? r.subject_id ?? "—").slice(0, 12) },
    { key: "type", header: "Type", render: (r) => <Badge tone="neutral">{String(r.subject_type ?? r.customer_id ? "customer" : "group")}</Badge> },
    { key: "assigned", header: "Assigned", render: (r) => when(r.assigned_at ?? r.created_at ?? r.starts_at) },
    { key: "status", header: "Status", render: (r) => <Badge tone="success">{String(r.status ?? "active")}</Badge> },
  ];

  if (loading) return <LoadingRow text="Loading your book…" />;
  if (error) return <ErrorState title="Could not load your assignments" detail={error} onRetry={reload} />;
  return <Table columns={cols} rows={data?.items ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">You carry no customer or group assignments yet.</p>} />;
}

function Allocation({ canAllocate }: { canAllocate: boolean }) {
  const [target, setTarget] = useState<Record<string, unknown> | null>(null);
  const { data, loading, error, reload } = useResource<{ items?: Record<string, unknown>[]; total?: number }>(
    () => api.get("/payments/pending?limit=50"),
    []
  );

  const cols: Column<Record<string, unknown>>[] = [
    { key: "customer", header: "Customer", render: (r) => String(r.customer_name ?? r.customer_code ?? r.customer_id ?? "—") },
    { key: "amount", header: "Verified amount", numeric: true, render: (r) => money(r.amount ?? r.verified_amount ?? 0) },
    { key: "received", header: "Received", render: (r) => when(r.received_at ?? r.receivedAt ?? r.created_at) },
    { key: "provider", header: "Provider", render: (r) => String(r.provider ?? "—") },
    {
      key: "action",
      header: "",
      render: (r) => (
        <Button size="sm" onClick={(e) => { e.stopPropagation(); setTarget(r); }} disabled={!canAllocate}>
          Allocate
        </Button>
      )
    },
  ];

  if (loading) return <LoadingRow text="Loading the allocation queue…" />;
  if (error) return <ErrorState title="Could not load the allocation queue" detail={error} onRetry={reload} />;

  return (
    <>
      <p className="nx-muted">
        A verified payment is never edited. Allocation splits it into loan repayment and savings, and the two must add back to
        the verified amount exactly (RULE 10.5.3B).
      </p>
      <Table columns={cols} rows={data?.items ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">Nothing is waiting for allocation.</p>} />
      {target && <AllocateModal payment={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); reload(); }} />}
    </>
  );
}

function AllocateModal({
  payment,
  onClose,
  onDone
}: {
  payment: Record<string, unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const paymentId = String(payment.id ?? "");
  const verified = Number(payment.amount ?? payment.verified_amount ?? 0);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loanId, setLoanId] = useState("");
  const [repayment, setRepayment] = useState("");
  const [savings, setSavings] = useState("");
  const [busy, setBusy] = useState(false);

  const repaymentNum = Number(repayment || 0);
  const savingsNum = Number(savings || 0);
  const balanced = Math.abs(repaymentNum + savingsNum - verified) < 0.005 && loanId.length >= 8;

  return (
    <Modal
      open
      onClose={onClose}
      title="Allocate a verified payment"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!balanced || busy}
            onClick={() => {
              setBusy(true);
              void api(`/payments/${paymentId}/allocate`, {
                method: "POST",
                json: { loanId, repaymentAmount: String(repaymentNum), savingsAmount: String(savingsNum), note: "Allocated from the field queue" }
              })
                .then(() => { toast({ title: "Payment allocated", tone: "success" }); onDone(); })
                .catch((err: Error) => toast({ title: "Could not allocate", text: err.message, tone: "danger" }))
                .finally(() => setBusy(false));
            }}
          >
            Allocate
          </Button>
        </>
      }
    >
      <div className="nx-stack nx-stack--sm">
        <KV
          items={[
            { label: "Verified amount", value: money(verified) },
            { label: "Provider", value: String(payment.provider ?? "—") },
            { label: "Received", value: when(payment.received_at ?? payment.receivedAt ?? payment.created_at) },
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void api.get<Record<string, unknown>>(`/payments/pending/${paymentId}`)
              .then(setDetail)
              .catch((err: Error) => toast({ title: "Could not open the payment", text: err.message, tone: "danger" }));
          }}
        >
          Load allocation context
        </Button>
        {detail && (
          <KV
            items={Object.entries(detail)
              .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
              .map(([k, v]) => ({ label: k.replace(/_/g, " "), value: String(v ?? "—") }))}
          />
        )}
        <label className="nx-field">
          <span>Loan id *</span>
          <input value={loanId} onChange={(e) => setLoanId(e.target.value)} placeholder="uuid of the loan being repaid" />
        </label>
        <label className="nx-field">
          <span>Loan repayment</span>
          <input inputMode="decimal" value={repayment} onChange={(e) => setRepayment(e.target.value)} />
        </label>
        <label className="nx-field">
          <span>Savings</span>
          <input inputMode="decimal" value={savings} onChange={(e) => setSavings(e.target.value)} />
        </label>
        <p className={balanced ? "nx-muted" : "nx-error"}>
          Repayment + savings must equal {money(verified)}. Currently {money(repaymentNum + savingsNum)}.
        </p>
      </div>
    </Modal>
  );
}

function Visits() {
  const { data, loading, error, reload } = useResource<{ items?: Record<string, unknown>[]; total?: number }>(
    () => api.get("/visits?limit=50"),
    []
  );

  const cols: Column<Record<string, unknown>>[] = [
    { key: "customer", header: "Customer", render: (r) => String(r.customer_name ?? "—") },
    { key: "group", header: "Group", render: (r) => String(r.group_name ?? "—") },
    { key: "type", header: "Type", render: (r) => <Badge tone="neutral">{String(r.visit_type ?? "").replace(/_/g, " ")}</Badge> },
    { key: "note", header: "Note", render: (r) => String(r.note ?? "—") },
    { key: "when", header: "Visited", render: (r) => when(r.visited_on) },
    { key: "by", header: "Worker", render: (r) => personName({ first_name: r.worker_first_name, last_name: r.worker_last_name }) },
  ];

  if (loading) return <LoadingRow text="Loading the visit log…" />;
  if (error) return <ErrorState title="Could not load visits" detail={error} onRetry={reload} />;
  return <Table columns={cols} rows={data?.items ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No visits recorded.</p>} />;
}

function VisitModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [customerId, setCustomerId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [visitType, setVisitType] = useState("visited");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a visit"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || note.trim().length === 0 || (!customerId.trim() && !groupId.trim())}
            onClick={() => {
              setBusy(true);
              void api("/visits", {
                method: "POST",
                json: {
                  customerId: customerId.trim() || null,
                  groupId: groupId.trim() || null,
                  visitType,
                  note,
                  visitedOn: new Date().toISOString()
                }
              })
                .then(() => { toast({ title: "Visit recorded", tone: "success" }); onDone(); })
                .catch((err: Error) => toast({ title: "Could not record the visit", text: err.message, tone: "danger" }))
                .finally(() => setBusy(false));
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <p className="nx-muted">A visit is an activity record, never a money entry.</p>
      <div className="nx-form-grid">
        <label className="nx-field">
          <span>Customer id</span>
          <input value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="uuid (optional if a group is given)" />
        </label>
        <label className="nx-field">
          <span>Group id</span>
          <input value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="uuid" />
        </label>
        <label className="nx-field">
          <span>Visit type</span>
          <select value={visitType} onChange={(e) => setVisitType(e.target.value)}>
            <option value="visited">Visited</option>
            <option value="followed_up">Followed up</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="nx-field">
          <span>Visited on</span>
          <input type="date" defaultValue={todayParam()} readOnly />
        </label>
        <label className="nx-field" style={{ gridColumn: "1 / -1" }}>
          <span>Note *</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </label>
      </div>
    </Modal>
  );
}