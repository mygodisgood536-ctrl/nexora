import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  ErrorState,
  KV,
  LoadingRow,
  Modal,
  PageHeader,
  Table,
  type Column
} from "@nexora/ui";
import { when } from "../lib/format";
import { useList } from "../lib/useResource";
import { Crumbs, PAGE_SIZE } from "./parts";

interface AuditEntry {
  id: string;
  branchId: string | null;
  actorUserId: string | null;
  actorUsername: string | null;
  actorName: string | null;
  roleUsed: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  previousValue: unknown;
  newValue: unknown;
  reason: string | null;
  paymentId: string | null;
  transactionRef: string | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: string;
}

export function AuditPage() {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  const list = useList<AuditEntry>("/audit", {
    params: { action: action || undefined, entityType: entityType || undefined, transactionRef: transactionRef || undefined },
    page: Math.floor(offset / PAGE_SIZE) + 1,
    pageSize: PAGE_SIZE
  });

  const cols: Column<AuditEntry>[] = [
    { key: "when", header: "When", render: (r) => when(r.createdAt) },
    { key: "actor", header: "Who", render: (r) => <><strong>{r.actorName ?? r.actorUsername ?? "system"}</strong><div className="nx-faint">{r.roleUsed ?? "—"}</div></> },
    { key: "action", header: "Action", render: (r) => <Badge tone="neutral">{r.action.replace(/_/g, " ")}</Badge> },
    { key: "entity", header: "Entity", render: (r) => <>{String(r.entityType)}<div className="nx-faint">{String(r.entityId ?? "").slice(0, 8)}</div></> },
    { key: "ref", header: "Reference", render: (r) => (r.transactionRef ? <span className="nx-faint">{r.transactionRef}</span> : r.paymentId ? <span className="nx-faint">pay {r.paymentId.slice(0, 8)}</span> : "—") },
    {
      key: "trace",
      header: "",
      render: (r) =>
        r.paymentId ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); navigate(`/trace?type=payment&id=${encodeURIComponent(r.paymentId as string)}`); }}
          >
            Walk chain
          </Button>
        ) : null
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every action that changed or read money state, with the person, the role they used, and why."
        breadcrumbs={<Crumbs items={[{ label: "Audit" }]} />}
      />
      <div className="nx-toolbar">
        <label className="nx-field">
          <span>Action</span>
          <input value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} placeholder="e.g. loan.approved" />
        </label>
        <label className="nx-field">
          <span>Entity type</span>
          <input value={entityType} onChange={(e) => { setEntityType(e.target.value); setOffset(0); }} placeholder="e.g. loan_application" />
        </label>
        <label className="nx-field">
          <span>Transaction ref</span>
          <input value={transactionRef} onChange={(e) => { setTransactionRef(e.target.value); setOffset(0); }} placeholder="provider reference" />
        </label>
      </div>

      {list.loading ? <LoadingRow text="Loading the audit trail…" /> : list.error ? (
        <ErrorState title="Could not load the audit trail" detail={list.error} onRetry={list.reload} />
      ) : (
        <>
          <Table
            columns={cols}
            rows={list.rows}
            rowKey={(r) => String(r.id)}
            onRowClick={(r) => setDetail(r)}
            empty={<p className="nx-muted">No audit entries match these filters.</p>}
          />
          {list.total > PAGE_SIZE && (
            <div className="nx-toolbar">
              <span className="nx-faint">{list.total} entries</span>
              <span className="nx-grow" />
              <button className="nx-btn nx-btn--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Previous
              </button>
              <button className="nx-btn nx-btn--sm" onClick={() => setOffset(offset + PAGE_SIZE)}>
                Next
              </button>
            </div>
          )}
        </>
      )}

      {detail && <EntryModal entry={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function EntryModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={entry.action.replace(/_/g, " ")}>
      <KV
        items={[
          { label: "When", value: when(entry.createdAt) },
          { label: "Who", value: entry.actorName ?? entry.actorUsername ?? "system" },
          { label: "Role used", value: entry.roleUsed ?? "—" },
          { label: "Entity", value: `${entry.entityType} ${String(entry.entityId ?? "").slice(0, 8)}` },
          { label: "Reason", value: entry.reason ?? "—" },
          { label: "Transaction ref", value: entry.transactionRef ?? "—" },
          { label: "Payment", value: entry.paymentId ?? "—" },
          { label: "IP", value: entry.ipAddress ?? "—" },
          { label: "Request id", value: entry.requestId ?? "—" },
        ]}
      />
      <div className="nx-stack nx-stack--sm" style={{ marginTop: 12 }}>
        <div>
          <h4 className="nx-h3">Before</h4>
          <pre className="nx-code">{entry.previousValue == null ? "—" : JSON.stringify(entry.previousValue, null, 2)}</pre>
        </div>
        <div>
          <h4 className="nx-h3">After</h4>
          <pre className="nx-code">{entry.newValue == null ? "—" : JSON.stringify(entry.newValue, null, 2)}</pre>
        </div>
      </div>
    </Modal>
  );
}