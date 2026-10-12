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
  useToast,
  type Column
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { when } from "../lib/format";
import { useResource } from "../lib/useResource";
import { Crumbs } from "./parts";

type Severity = "observation" | "low" | "medium" | "high" | "critical";
type Status = "open" | "acknowledged" | "closed";

interface FindingRow {
  id: string;
  reference: string;
  title: string;
  observation: string;
  severity: Severity;
  status: Status;
  entityType: string | null;
  entityId: string | null;
  raisedByName: string;
  raisedAsRole: string | null;
  remediationNote: string | null;
  closedAt: string | null;
  createdAt: string;
}

interface FindingEvent {
  event: string;
  previousStatus: string | null;
  newStatus: string | null;
  note: string | null;
  actorName: string;
  actorRole: string | null;
  createdAt: string;
}

const NEXT_STATUS: Record<Status, Status | null> = {
  open: "acknowledged",
  acknowledged: "closed",
  closed: null,
};

const SEVERITY_TONE: Record<Severity, "neutral" | "accent" | "warning" | "danger"> = {
  observation: "neutral",
  low: "neutral",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

/**
 * PART 12 §12.14 — the Internal Auditor's "findings and annotations".
 *
 * A finding is an auditor's conclusion attached to something they inspected.
 * It never touches money, and its lifecycle only ever moves forward: every
 * transition is kept as a separate event, so the finding's own history is
 * append-only in the same spirit as the audit trail.
 */
export function FindingsPage() {
  const me = useMe();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [raising, setRaising] = useState(false);
  const [progressing, setProgressing] = useState<{ finding: FindingRow; to: Status } | null>(null);
  const [detail, setDetail] = useState<FindingRow | null>(null);

  const mayRecord = me.roles.some((r) =>
    ["internal_auditor", "audit_officer", "compliance_officer", "risk_officer", "md", "deputy_md"].includes(r.roleKey)
  );

  const list = useResource<{ items?: FindingRow[]; total?: number }>(
    () => api.get(`/audit/findings/list?${new URLSearchParams({ status, severity, limit: "50" }).toString()}`),
    [status, severity]
  );

  const cols: Column<FindingRow>[] = [
    { key: "ref", header: "Reference", render: (f) => <span className="nx-faint">{f.reference}</span> },
    { key: "title", header: "Finding", render: (f) => <><strong>{f.title}</strong><div className="nx-faint">{f.observation.slice(0, 90)}{f.observation.length > 90 ? "…" : ""}</div></> },
    { key: "severity", header: "Severity", render: (f) => <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge> },
    { key: "status", header: "Status", render: (f) => <Badge tone={f.status === "closed" ? "success" : f.status === "acknowledged" ? "warning" : "accent"}>{f.status}</Badge> },
    { key: "subject", header: "Subject", render: (f) => (f.entityType ? <>{f.entityType}<div className="nx-faint">{String(f.entityId ?? "").slice(0, 8)}</div></> : "—") },
    { key: "raised", header: "Raised", render: (f) => <>{when(f.createdAt)}<div className="nx-faint">{f.raisedByName}</div></> },
    {
      key: "action",
      header: "",
      render: (f) => {
        const next = NEXT_STATUS[f.status];
        return (
          <>
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDetail(f); }}>Open</Button>
            {mayRecord && next && (
              <Button size="sm" onClick={(e) => { e.stopPropagation(); setProgressing({ finding: f, to: next }); }}>
                {next === "acknowledged" ? "Acknowledge" : "Close"}
              </Button>
            )}
          </>
        );
      }
    },
  ];

  return (
    <>
      <PageHeader
        title="Findings"
        description="What the auditors concluded. A finding never changes money; its history is kept in full."
        actions={mayRecord ? <Button size="sm" onClick={() => setRaising(true)}>Record a finding</Button> : undefined}
        breadcrumbs={<Crumbs items={[{ label: "Audit" }, { label: "Findings" }]} />}
      />

      {!mayRecord && (
        <p className="nx-muted">
          Findings are recorded by audit and compliance roles. You can read them here; your role cannot raise or progress one.
        </p>
      )}

      <div className="nx-toolbar">
        <label className="nx-field">
          <span>Status</span>
          <select className="nx-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label className="nx-field">
          <span>Severity</span>
          <select className="nx-select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="observation">Observation</option>
          </select>
        </label>
        <span className="nx-grow" />
        <span className="nx-faint">{list.data?.total ?? 0} findings</span>
      </div>

      {list.loading ? (
        <LoadingRow text="Loading findings…" />
      ) : list.error ? (
        <ErrorState title="Could not load findings" detail={list.error} onRetry={list.reload} />
      ) : (
        <Table columns={cols} rows={list.data?.items ?? []} rowKey={(f) => String(f.id)} empty={<p className="nx-muted">No findings recorded.</p>} />
      )}

      {raising && (
        <RaiseModal
          onClose={() => setRaising(false)}
          onDone={() => { setRaising(false); toast({ title: "Finding recorded", tone: "success" }); list.reload(); }}
        />
      )}

      {progressing && (
        <ProgressModal
          finding={progressing.finding}
          to={progressing.to}
          onClose={() => setProgressing(null)}
          onDone={() => { setProgressing(null); toast({ title: "Finding updated", tone: "success" }); list.reload(); }}
        />
      )}

      {detail && <FindingModal finding={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function RaiseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    reference: "",
    title: "",
    observation: "",
    severity: "observation" as Severity,
    entityType: "",
    entityId: ""
  });
  const [busy, setBusy] = useState(false);

  const ready = form.reference.trim().length > 0 && form.title.trim().length >= 3 && form.observation.trim().length >= 10;

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a finding"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !ready}
            onClick={() => {
              setBusy(true);
              void api("/audit/findings", {
                method: "POST",
                json: {
                  reference: form.reference.trim(),
                  title: form.title.trim(),
                  observation: form.observation.trim(),
                  severity: form.severity,
                  entityType: form.entityType.trim() || null,
                  entityId: form.entityId.trim() || null
                }
              })
                .then(() => onDone())
                .catch((err: Error) => toast({ title: "Could not record the finding", text: err.message, tone: "danger" }))
                .finally(() => setBusy(false));
            }}
          >
            Record
          </Button>
        </>
      }
    >
      <p className="nx-muted">
        A finding is your conclusion, not an edit. Attaching a subject lets anyone open the exact record you inspected.
      </p>
      <div className="nx-form-grid">
        <label className="nx-field">
          <span>Reference *</span>
          <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. AUD-2026-014" />
        </label>
        <label className="nx-field">
          <span>Severity</span>
          <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}>
            <option value="observation">Observation</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label className="nx-field" style={{ gridColumn: "1 / -1" }}>
          <span>Title *</span>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className="nx-field">
          <span>Subject type</span>
          <input value={form.entityType} onChange={(e) => setForm({ ...form, entityType: e.target.value })} placeholder="e.g. loan_application" />
        </label>
        <label className="nx-field">
          <span>Subject id</span>
          <input value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })} placeholder="uuid" />
        </label>
        <label className="nx-field" style={{ gridColumn: "1 / -1" }}>
          <span>Observation (min 10 chars) *</span>
          <textarea value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} rows={5} />
        </label>
      </div>
    </Modal>
  );
}

function ProgressModal({
  finding,
  to,
  onClose,
  onDone
}: {
  finding: FindingRow;
  to: Status;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title={to === "closed" ? "Close this finding" : "Acknowledge this finding"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api(`/audit/findings/${finding.id}/progress`, { method: "POST", json: { status: to, note: note.trim() || null } })
                .then(() => onDone())
                .catch((err: Error) => toast({ title: "Could not update the finding", text: err.message, tone: "danger" }))
                .finally(() => setBusy(false));
            }}
          >
            {to === "closed" ? "Close" : "Acknowledge"}
          </Button>
        </>
      }
    >
      <p className="nx-muted">
        {finding.reference} — {finding.title}
      </p>
      <label className="nx-field">
        <span>{to === "closed" ? "Remediation note" : "Note"}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
      </label>
    </Modal>
  );
}

function FindingModal({ finding, onClose }: { finding: FindingRow; onClose: () => void }) {
  const { data, loading, error } = useResource<{ events?: FindingEvent[] }>(
    () => api.get(`/audit/findings/${finding.id}/events`),
    [finding.id]
  );

  return (
    <Modal open onClose={onClose} title={finding.title}>
      <div className="nx-stack">
        <KV
          items={[
            { label: "Reference", value: finding.reference },
            { label: "Severity", value: <Badge tone={SEVERITY_TONE[finding.severity]}>{finding.severity}</Badge> },
            { label: "Status", value: <Badge tone={finding.status === "closed" ? "success" : "warning"}>{finding.status}</Badge> },
            { label: "Raised by", value: `${finding.raisedByName}${finding.raisedAsRole ? ` (${finding.raisedAsRole.replace(/_/g, " ")})` : ""}` },
            { label: "Raised at", value: when(finding.createdAt) },
            { label: "Subject", value: finding.entityType ? `${finding.entityType} ${String(finding.entityId ?? "").slice(0, 8)}` : "—" },
            { label: "Closed at", value: finding.closedAt ? when(finding.closedAt) : "—" },
          ]}
        />
        <div>
          <h4 className="nx-h3">Observation</h4>
          <p className="nx-muted">{finding.observation}</p>
        </div>
        {finding.remediationNote && (
          <div>
            <h4 className="nx-h3">Remediation</h4>
            <p className="nx-muted">{finding.remediationNote}</p>
          </div>
        )}
        <div>
          <h4 className="nx-h3">History</h4>
          {loading ? (
            <LoadingRow text="Loading history…" />
          ) : error ? (
            <ErrorState title="Could not load the finding history" detail={error} />
          ) : (
            <Table
              columns={[
                { key: "when", header: "When", render: (e: FindingEvent) => when(e.createdAt) },
                { key: "event", header: "Event", render: (e: FindingEvent) => String(e.event).replace(/_/g, " ") },
                {
                  key: "move",
                  header: "Move",
                  render: (e: FindingEvent) => (e.previousStatus ? `${e.previousStatus} → ${e.newStatus}` : "—")
                },
                { key: "who", header: "Who", render: (e: FindingEvent) => `${e.actorName}${e.actorRole ? ` (${e.actorRole.replace(/_/g, " ")})` : ""}` },
                { key: "note", header: "Note", render: (e: FindingEvent) => String(e.note ?? "—") },
              ]}
              rows={data?.events ?? []}
              rowKey={(e: FindingEvent) => `${e.createdAt}-${e.event}`}
              empty={<p className="nx-muted">No history.</p>}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}