import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  ConfirmDialog,
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
import { Crumbs } from "./parts";

type TabKey = "loan_decisions" | "corrections" | "providers";

export function ApprovalsPage() {
  const me = useMe();
  const [tab, setTab] = useState<TabKey>("loan_decisions");

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Your own inbox: only the decisions the chain has put in front of you (RULE 8.9)."
        breadcrumbs={<Crumbs items={[{ label: "Approvals" }]} />}
      />
      <Tabs
        items={[
          { key: "loan_decisions", label: "Loan decisions" },
          { key: "corrections", label: "Correction requests" },
          { key: "providers", label: "Provider changes" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "loan_decisions" && <LoanDecisions canApprove={me.permissions.includes("approve")} />}
        {tab === "corrections" && <Corrections canDecide={me.permissions.includes("approve")} />}
        {tab === "providers" && <ProviderApprovals canApprove={me.permissions.includes("configure")} />}
      </div>
    </>
  );
}

function LoanDecisions({ canApprove }: { canApprove: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useResource<{ items?: Record<string, unknown>[] }>(
    () => api.get<{ items?: Record<string, unknown>[] }>("/loan-applications/approvals/mine"),
    []
  );
  const [target, setTarget] = useState<Record<string, unknown> | null>(null);
  const queue = data?.items ?? [];

  const cols: Column<Record<string, unknown>>[] = [
    {
      key: "customer",
      header: "Customer",
      render: (r) => (
        <>
          <strong>{String(r.customerName ?? "—")}</strong>
          <div className="nx-faint">{String(r.customerCode ?? "")}</div>
        </>
      )
    },
    { key: "principal", header: "Principal", numeric: true, render: (r) => money(r.principalAmount ?? 0) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    {
      key: "stage",
      header: "Stage",
      render: (r) => (
        <>
          {String(r.stageOrder ?? "—")} <span className="nx-faint">{String(r.stepName ?? "")}</span>
        </>
      )
    },
    {
      key: "mandatory",
      header: "Mandatory",
      render: (r) => (r.mandatory ? <Badge tone="warning">mandatory</Badge> : <Badge tone="neutral">optional</Badge>)
    },
    { key: "waiting", header: "Waiting since", render: (r) => when(r.awaitingActionSince ?? r.createdAt) },
    {
      key: "action",
      header: "",
      render: (r) => (
        <>
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/credit/${String(r.applicationId)}`); }}>
            Open
          </Button>
          {canApprove && (
            <Button size="sm" onClick={(e) => { e.stopPropagation(); setTarget(r); }}>
              Decide
            </Button>
          )}
        </>
      )
    },
  ];

  return (
    <>
      {loading ? (
        <LoadingRow text="Loading your inbox…" />
      ) : error ? (
        <ErrorState title="Could not load your approval queue" detail={error} onRetry={reload} />
      ) : (
        <>
          <p className="nx-muted">
            {queue.length} item{queue.length === 1 ? "" : "s"} waiting in your inbox.
          </p>
          <Table
            columns={cols}
            rows={queue}
            rowKey={(r) => String(r.applicationId)}
            onRowClick={(r) => navigate(`/credit/${String(r.applicationId)}`)}
            empty={<p className="nx-muted">Nothing awaits your decision right now.</p>}
          />
        </>
      )}
      {target && (
        <DecisionModal
          onClose={() => setTarget(null)}
          onSubmit={(decision, reason) => {
            const applicationId = String(target.applicationId);
            setTarget(null);
            void api(`/loan-applications/${applicationId}/decide`, { method: "POST", json: { decision, reason } })
              .then(() => { toast({ title: "Decision recorded", tone: "success" }); reload(); })
              .catch((err: Error) => toast({ title: "Could not record decision", text: err.message, tone: "danger" }));
          }}
        />
      )}
    </>
  );
}

function Corrections({ canDecide }: { canDecide: boolean }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<{ corrections?: Record<string, unknown>[] }>(
    () => api.get<{ corrections?: Record<string, unknown>[] }>("/payments/corrections?status=requested"),
    []
  );
  const [target, setTarget] = useState<Record<string, unknown> | null>(null);
  const rows = data?.corrections ?? [];

  const cols: Column<Record<string, unknown>>[] = [
    { key: "payment", header: "Payment", render: (r) => <span className="nx-faint">{String(r.paymentId ?? "").slice(0, 8)}</span> },
    { key: "kind", header: "Kind", render: (r) => <Badge tone="neutral">{String(r.kind ?? "—")}</Badge> },
    { key: "reason", header: "Reason", render: (r) => String(r.reason ?? "—") },
    { key: "requested", header: "Requested", render: (r) => when(r.requestedAt) },
    {
      key: "action",
      header: "",
      render: (r) => (canDecide ? (
        <Button size="sm" onClick={(e) => { e.stopPropagation(); setTarget(r); }}>Decide</Button>
      ) : null)
    },
  ];

  return (
    <>
      {loading ? (
        <LoadingRow text="Loading correction requests…" />
      ) : error ? (
        <ErrorState title="Could not load correction requests" detail={error} onRetry={reload} />
      ) : (
        <Table columns={cols} rows={rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No correction requests awaiting a decision.</p>} />
      )}
      {target && (
        <DecisionModal
          kind="correction"
          onClose={() => setTarget(null)}
          onSubmit={(decision, reason) => {
            const id = String(target.id);
            setTarget(null);
            void api(`/payments/corrections/${id}/decision`, { method: "POST", json: { decision, reason } })
              .then(() => { toast({ title: "Correction decision recorded", tone: "success" }); reload(); })
              .catch((err: Error) => toast({ title: "Could not decide correction", text: err.message, tone: "danger" }));
          }}
        />
      )}
    </>
  );
}

function ProviderApprovals({ canApprove }: { canApprove: boolean }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<Record<string, unknown>[]>(
    () => api.get<Record<string, unknown>[]>("/payment-providers/approvals").then((r) => (Array.isArray(r) ? r : [])),
    []
  );
  const [target, setTarget] = useState<Record<string, unknown> | null>(null);
  const rows = data ?? [];
  const approved = (r: Record<string, unknown>) => Boolean(r.mdApproved ?? r.md_approved);

  const cols: Column<Record<string, unknown>>[] = [
    { key: "provider", header: "Provider", render: (r) => <strong>{String(r.provider ?? "—")}</strong> },
    { key: "branch", header: "Scope", render: (r) => (r.branchId ?? r.branch_id ? String(r.branchId ?? r.branch_id).slice(0, 8) : <Badge tone="neutral">company</Badge>) },
    { key: "url", header: "API base URL", render: (r) => String(r.apiBaseUrl ?? r.api_base_url ?? "—") },
    { key: "md", header: "MD approval", render: (r) => <StatusBadge status={approved(r) ? "approved" : "pending"} /> },
    {
      key: "active",
      header: "Active",
      render: (r) => ((r.isActive ?? r.is_active) ? <Badge tone="success">active</Badge> : <Badge tone="neutral">inactive</Badge>)
    },
    {
      key: "action",
      header: "",
      render: (r) => (canApprove && !approved(r) ? (
        <Button size="sm" onClick={(e) => { e.stopPropagation(); setTarget(r); }}>Approve</Button>
      ) : null)
    },
  ];

  return (
    <>
      {loading ? (
        <LoadingRow text="Loading provider changes…" />
      ) : error ? (
        <ErrorState title="Could not load provider changes" detail={error} onRetry={reload} />
      ) : (
        <Table columns={cols} rows={rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No provider change awaits MD approval.</p>} />
      )}
      {target && (
        <ConfirmDialog
          open
          title="Approve this provider change?"
          confirmLabel="Approve"
          onClose={() => setTarget(null)}
          onConfirm={() => {
            const id = String(target.id);
            setTarget(null);
            void api(`/payment-providers/${id}/approve`, { method: "POST" })
              .then(() => { toast({ title: "Provider change approved", tone: "success" }); reload(); })
              .catch((err: Error) => toast({ title: "Could not approve", text: err.message, tone: "danger" }));
          }}
          body="Provider changes are MD-authorised. The approval is written to the audit trail with your name, role and reason."
        />
      )}
    </>
  );
}

type Decision = "approve" | "reject" | "request_information";

function DecisionModal({
  kind = "loan",
  onClose,
  onSubmit
}: {
  kind?: "loan" | "correction";
  onClose: () => void;
  onSubmit: (decision: Decision, reason: string) => void;
}) {
  const minReason = kind === "correction" ? 5 : 3;
  const choices: Decision[] = kind === "correction" ? ["approve", "reject"] : ["approve", "reject", "request_information"];
  const [choice, setChoice] = useState<Decision>("approve");
  const [reason, setReason] = useState("");

  return (
    <Modal
      open
      onClose={onClose}
      title={kind === "correction" ? "Decide the correction request" : "Record your decision"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={reason.trim().length < minReason} onClick={() => onSubmit(choice, reason)}>Submit</Button>
        </>
      }
    >
      <p className="nx-muted">
        {kind === "correction"
          ? "Finance prepared this request; approving it posts a new linked reversal. Nothing is ever edited in place (RULE 5.6.3)."
          : "Your decision is permanent and is recorded against the chain stage you are sitting at."}
      </p>
      <div className="nx-form-grid">
        <label className="nx-field">
          <span>Decision *</span>
          <select value={choice} onChange={(e) => setChoice(e.target.value as Decision)}>
            {choices.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="nx-field">
          <span>Reason (min {minReason} chars) *</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} />
        </label>
      </div>
    </Modal>
  );
}