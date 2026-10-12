import { useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
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
import { money, when } from "../lib/format";
import { useResource } from "../lib/useResource";
import { Crumbs } from "./parts";

type TabKey = "cases" | "escalations" | "alerts";

export function RecoveryPage() {
  const me = useMe();
  const canEdit = me.permissions.includes("edit");
  const [tab, setTab] = useState<TabKey>("cases");

  return (
    <>
      <PageHeader
        title="Recovery"
        description="Overdue cases, the escalation ladder, and collection-watch alerts."
        breadcrumbs={<Crumbs items={[{ label: "Recovery" }]} />}
      />
      <Tabs
        items={[
          { key: "cases", label: "My cases" },
          { key: "escalations", label: "Escalations" },
          { key: "alerts", label: "Watch alerts" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "cases" && <Cases />}
        {tab === "escalations" && <Escalations canEdit={canEdit} />}
        {tab === "alerts" && <Alerts canEdit={canEdit} />}
      </div>
    </>
  );
}

function Cases() {
  const { data, loading, error, reload } = useResource<{ items?: Record<string, unknown>[]; total?: number }>(
    () => api.get("/payments?status=overdue&limit=50"),
    []
  );

  const cols: Column<Record<string, unknown>>[] = [
    { key: "customer", header: "Customer", render: (r) => String(r.customer_id ?? "—").slice(0, 8) },
    { key: "amount", header: "Amount", numeric: true, render: (r) => money(r.amount ?? 0) },
    { key: "provider", header: "Provider", render: (r) => String(r.provider ?? "—") },
    { key: "ref", header: "Provider ref", render: (r) => <span className="nx-faint">{String(r.providerTxnRef ?? "—")}</span> },
    { key: "value", header: "Value date", render: (r) => String(r.valueDate ?? "—") },
    { key: "status", header: "Status", render: (r) => <Badge tone="danger">{String(r.status ?? "overdue")}</Badge> },
  ];

  if (loading) return <LoadingRow text="Loading overdue cases…" />;
  if (error) return <ErrorState title="Could not load overdue cases" detail={error} onRetry={reload} />;
  return (
    <>
      <p className="nx-muted">Overdue money sits on the payment pipeline; contact notes live in the visit log.</p>
      <Table columns={cols} rows={data?.items ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No overdue payments in your scope.</p>} />
    </>
  );
}

function Escalations({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<{ escalations?: Record<string, unknown>[] }>(
    () => api.get("/overdue-escalation/escalations?status=open&limit=100"),
    []
  );
  const [resolving, setResolving] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const rows = data?.escalations ?? [];

  const cols: Column<Record<string, unknown>>[] = [
    { key: "customer", header: "Customer", render: (r) => String(r.customerId ?? "—").slice(0, 8) },
    { key: "loan", header: "Loan", render: (r) => String(r.loanId ?? "—").slice(0, 8) },
    { key: "level", header: "Level", render: (r) => <>{Number(r.escalationLevel ?? 0)} <span className="nx-faint">{String(r.levelName ?? "")}</span></> },
    { key: "days", header: "Days past due", numeric: true, render: (r) => String(r.daysPastDue ?? 0) },
    { key: "due", header: "Amount due", numeric: true, render: (r) => money(r.amountDue ?? 0) },
    { key: "raised", header: "Raised", render: (r) => when(r.raisedAt) },
    { key: "notified", header: "Notified", render: (r) => `${(r.notifiedUserIds as string[] | undefined)?.length ?? 0} people` },
    {
      key: "action",
      header: "",
      render: (r) => (canEdit ? (
        <Button size="sm" onClick={(e) => { e.stopPropagation(); setResolving(r); }}>Resolve</Button>
      ) : null)
    },
  ];

  return (
    <>
      <div className="nx-toolbar">
        <span className="nx-faint">{rows.length} open escalation{rows.length === 1 ? "" : "s"}.</span>
        <span className="nx-grow" />
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setRunning(true)}>Run the ladder now</Button>
        )}
      </div>
      {loading ? <LoadingRow text="Loading escalations…" /> : error ? (
        <ErrorState title="Could not load escalations" detail={error} onRetry={reload} />
      ) : (
        <Table columns={cols} rows={rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No open escalations.</p>} />
      )}
      {resolving && (
        <NoteModal
          title="Resolve this escalation"
          body="The case stays in the trail with your note; nothing is deleted."
          onClose={() => setResolving(null)}
          onSubmit={(note) => {
            const id = String(resolving.id);
            setResolving(null);
            void api(`/overdue-escalation/escalations/${id}/resolve`, { method: "POST", json: { note } })
              .then(() => { toast({ title: "Escalation resolved", tone: "success" }); reload(); })
              .catch((err: Error) => toast({ title: "Could not resolve", text: err.message, tone: "danger" }));
          }}
        />
      )}
      {running && (
        <RunModal
          title="Run the escalation ladder"
          body="Runs the configured ladder now and raises escalations for cases past their grace days. Every action is notified and audited."
          endpoint="/overdue-escalation/escalations/run"
          fields={[
            { name: "graceDays", label: "Grace days (blank = company setting)", type: "number" },
            { name: "limit", label: "Maximum cases examined", type: "number" },
          ]}
          onClose={() => setRunning(false)}
          onDone={(result) => {
            setRunning(false);
            toast({
              title: "Escalation run finished",
              text: `${String((result as { escalationsRaised?: number }).escalationsRaised ?? 0)} escalation(s) raised`
            });
            reload();
          }}
        />
      )}
    </>
  );
}

function Alerts({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<{ alerts?: Record<string, unknown>[] }>(
    () => api.get("/collection-watch/alerts?limit=100"),
    []
  );
  const [resolving, setResolving] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const rows = data?.alerts ?? [];

  const cols: Column<Record<string, unknown>>[] = [
    { key: "kind", header: "Signal", render: (r) => <Badge tone="warning">{String(r.alertKind ?? "").replace(/_/g, " ")}</Badge> },
    { key: "subject", header: "Subject", render: (r) => <>{String(r.subjectType ?? "")} <span className="nx-faint">{String(r.subjectId ?? "").slice(0, 8)}</span></> },
    { key: "detail", header: "Detail", render: (r) => Object.entries((r.detail ?? {}) as Record<string, unknown>).map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`).join(" · ") || "—" },
    { key: "owner", header: "Responsible", render: (r) => String(r.responsibleUserId ?? "unassigned").slice(0, 8) },
    { key: "raised", header: "Raised", render: (r) => when(r.raisedAt) },
    { key: "state", header: "State", render: (r) => (r.resolvedAt ? <Badge tone="success">resolved</Badge> : <Badge tone="warning">open</Badge>) },
    {
      key: "action",
      header: "",
      render: (r) => (canEdit && !r.resolvedAt ? (
        <Button size="sm" onClick={(e) => { e.stopPropagation(); setResolving(r); }}>Resolve</Button>
      ) : null)
    },
  ];

  return (
    <>
      <div className="nx-toolbar">
        <span className="nx-faint">Payments waiting for allocation, missed full cycles, silent groups and workers below target.</span>
        <span className="nx-grow" />
        {canEdit && <Button size="sm" variant="ghost" onClick={() => setRunning(true)}>Run the watch now</Button>}
      </div>
      {loading ? <LoadingRow text="Loading alerts…" /> : error ? (
        <ErrorState title="Could not load alerts" detail={error} onRetry={reload} />
      ) : (
        <Table columns={cols} rows={rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No watch alerts.</p>} />
      )}
      {resolving && (
        <NoteModal
          title="Resolve this alert"
          body="Your note is kept with the alert; the alert stops being raised."
          onClose={() => setResolving(null)}
          onSubmit={(note) => {
            const id = String(resolving.id);
            setResolving(null);
            void api(`/collection-watch/alerts/${id}/resolve`, { method: "POST", json: { note } })
              .then(() => { toast({ title: "Alert resolved", tone: "success" }); reload(); })
              .catch((err: Error) => toast({ title: "Could not resolve", text: err.message, tone: "danger" }));
          }}
        />
      )}
      {running && (
        <RunModal
          title="Run collection watch"
          body="Stands up the standing alerts now using the company thresholds."
          endpoint="/collection-watch/run"
          fields={[
            { name: "allocationWindowHours", label: "Allocation window (hours)", type: "number" },
            { name: "fullCycleDays", label: "Full cycle (days)", type: "number" },
            { name: "belowTargetRate", label: "Below target rate (%)", type: "number" },
          ]}
          onClose={() => setRunning(false)}
          onDone={() => { setRunning(false); toast({ title: "Watch run finished" }); reload(); }}
        />
      )}
    </>
  );
}

function NoteModal({ title, body, onClose, onSubmit }: { title: string; body: string; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={note.trim().length < 3} onClick={() => onSubmit(note)}>Save</Button>
        </>
      }
    >
      <p className="nx-muted">{body}</p>
      <label className="nx-field">
        <span>Note (min 3 chars) *</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </label>
    </Modal>
  );
}

function RunModal({
  title,
  body,
  endpoint,
  fields,
  onClose,
  onDone
}: {
  title: string;
  body: string;
  endpoint: string;
  fields: Array<{ name: string; label: string; type: string }>;
  onClose: () => void;
  onDone: (result: unknown) => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              const json: Record<string, number> = {};
              for (const f of fields) {
                const raw = values[f.name];
                if (raw !== undefined && raw.trim() !== "") {
                  const n = Number(raw);
                  if (Number.isFinite(n)) json[f.name] = n;
                }
              }
              void api(endpoint, { method: "POST", json })
                .then(onDone)
                .catch((err: Error) => toast({ title: "Run failed", text: err.message, tone: "danger" }))
                .finally(() => setBusy(false));
            }}
          >
            Run
          </Button>
        </>
      }
    >
      <p className="nx-muted">{body}</p>
      <div className="nx-form-grid">
        {fields.map((f) => (
          <label key={f.name} className="nx-field">
            <span>{f.label}</span>
            <input type={f.type} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
          </label>
        ))}
      </div>
    </Modal>
  );
}

/** Shared by EodPage: one confirm-then-run surface for company-wide actions. */
export function ConfirmRun({
  open,
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <ConfirmDialog
      open
      title={title}
      confirmLabel={confirmLabel}
      onClose={onClose}
      onConfirm={onConfirm}
      body={body}
    />
  );
}