import { Crumbs } from "./parts";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  KV,
  LoadingRow,
  Modal,
  PageHeader,
  StatusBadge,
  Table,
  useToast,
  type Column
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { day, money } from "../lib/format";
import { useResource } from "../lib/useResource";

interface Preview {
  application?: Record<string, unknown>;
  customer?: { fullName?: string; customerCode?: string; phone?: string | null; status?: string } | null;
  guarantor?: Record<string, unknown> | null;
  group?: { name?: string; groupNumber?: string | null; role?: string | null } | null;
  loanCycle?: { cycleNumber?: number; isReturningCustomer?: boolean; priorLoanCount?: number };
  savingsBalance?: string | null;
  terms?: Record<string, unknown> | null;
  bankDetails?: Record<string, unknown> | null;
  fees?: Record<string, unknown>[];
  stages?: { resumeStageKey?: string | null; stages?: Record<string, unknown>[] };
  missingEvidence?: string[];
  readyForSubmission?: boolean;
}

export function CreditDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const toast = useToast();
  const { data: preview, loading, error, reload } = useResource<Preview>(() => api.get(`/loan-applications/${id}/preview`), [id]);
  const [decision, setDecision] = useState<"approve" | "reject" | "request_information" | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [disbursing, setDisbursing] = useState(false);

  const canDecide = me.permissions.includes("approve") || me.permissions.includes("reject");
  const canEdit = me.permissions.includes("edit");
  const canDisburse = me.permissions.includes("disburse");

  if (loading) return <LoadingRow text="Loading application…" />;
  if (error || !preview) return <ErrorState title="Could not load this application" detail={error ?? undefined} onRetry={reload} />;

  const app = preview.application ?? {};
  const terms = preview.terms;
  const fees = preview.fees ?? [];
  const stages = preview.stages?.stages ?? [];
  const g = preview.guarantor;

  const feeCols: Column<Record<string, unknown>>[] = [
    { key: "type", header: "Fee", render: (r) => String(r.fee_type ?? "—") },
    { key: "amount", header: "Amount", numeric: true, render: (r) => money(r.amount) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
  ];

  const stageCols: Column<Record<string, unknown>>[] = [
    { key: "key", header: "Stage", render: (r) => String(r.stage_key ?? "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    { key: "updated", header: "Updated", render: (r) => day(r.updated_at ?? r.created_at) },
  ];

  const act = (path: string, json: Record<string, unknown>, ok: string) => {
    void api(path, { method: "POST", json })
      .then(() => {
        toast({ title: ok, tone: "success" });
        reload();
      })
      .catch((err: Error) => toast({ title: "Action failed", text: err.message, tone: "danger" }));
  };

  return (
    <>
      <PageHeader
        title={`Application ${String(app.id).slice(0, 8)}`}
        eyebrow={`${preview.customer?.customerCode ?? ""} ${preview.customer?.fullName ?? ""}`}
        description={`Principal ${money(app.principal_amount)} · status ${String(app.status ?? "").replace(/_/g, " ")}`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>Back</Button>
            {canEdit && ["submitted", "in_review", "information_requested", "draft"].includes(String(app.status)) && (
              <Button variant="secondary" size="sm" onClick={() => setWithdrawing(true)}>Withdraw</Button>
            )}
            {canDecide && ["submitted", "in_review"].includes(String(app.status)) && (
              <Button size="sm" onClick={() => setDecision("approve")}>Decide</Button>
            )}
            {canDisburse && String(app.status) === "approved" && (
              <Button size="sm" onClick={() => setDisbursing(true)}>Disburse</Button>
            )}
          </>
        }
        breadcrumbs={<Crumbs items={[{ label: "Credit" }, { label: `Application ${String(app.id).slice(0, 8)}` }]} />}
      />

      <div className="nx-grid nx-grid--2">
        <section className="nx-panel">
          <h3 className="nx-h3">Application</h3>
          <KV items={[
            { label: "Status", value: <StatusBadge status={String(app.status ?? "unknown")} /> },
            { label: "Principal", value: money(app.principal_amount) },
            { label: "Current stage", value: String(app.current_stage_order ?? "—") },
            { label: "Product", value: String(app.product_id ?? "—").slice(0, 8) },
            { label: "Chain", value: String(app.chain_id ?? "—").slice(0, 8) },
            { label: "Created", value: day(app.created_at) },
            { label: "Decided", value: day(app.decided_at) },
            { label: "Rejection reason", value: String(app.rejection_reason ?? "—") },
            { label: "Disbursed", value: day(app.disbursed_at) },
            { label: "Ready for submission", value: preview.readyForSubmission ? <Badge tone="success">yes</Badge> : <Badge tone="warning">not yet</Badge> },
            { label: "Missing evidence", value: preview.missingEvidence?.length ? preview.missingEvidence.join(", ") : "none" },
          ]} />
        </section>

        <section className="nx-panel">
          <h3 className="nx-h3">Customer & context</h3>
          <KV items={[
            { label: "Customer", value: `${preview.customer?.fullName ?? "—"} (${preview.customer?.customerCode ?? "—"})` },
            { label: "Phone", value: preview.customer?.phone ?? "—" },
            { label: "Group", value: preview.group ? `${preview.group.name ?? ""} ${preview.group.role ? `· ${preview.group.role}` : ""}` : "—" },
            { label: "Loan cycle", value: preview.loanCycle ? `${preview.loanCycle.cycleNumber ?? "—"} (prior loans: ${preview.loanCycle.priorLoanCount ?? 0})` : "—" },
            { label: "Savings balance", value: money(preview.savingsBalance ?? 0) },
          ]} />
        </section>
      </div>

      <div className="nx-grid nx-grid--2" style={{ marginTop: 16 }}>
        <section className="nx-panel">
          <h3 className="nx-h3">Terms</h3>
          {terms ? (
            <KV items={[
              { label: "Repayment mode", value: String(terms.repayment_mode ?? "—") },
              { label: "Periods", value: String(terms.repayment_periods ?? "—") },
              { label: "Interest %", value: String(terms.interest_percentage ?? "—") },
              { label: "Repayment amount", value: money(terms.repayment_amount) },
              { label: "Calculated interest", value: money(terms.calculated_interest) },
              { label: "Total repayment", value: money(terms.calculated_total_repayment) },
              { label: "Tally", value: <StatusBadge status={String(terms.tally_status ?? "unknown")} /> },
            ]} />
          ) : (
            <p className="nx-muted">No terms saved yet — terms are captured during the application stages.</p>
          )}
        </section>

        <section className="nx-panel">
          <h3 className="nx-h3">Guarantor</h3>
          {g ? (
            <KV items={[
              { label: "Full name", value: String(g.full_name ?? "—") },
              { label: "Relationship", value: String(g.relationship ?? "—") },
              { label: "Phone", value: String(g.phone ?? "—") },
              { label: "Address", value: String(g.address ?? "—") },
              { label: "Occupation", value: String(g.occupation ?? "—") },
            ]} />
          ) : (
            <p className="nx-muted">No guarantor recorded for this application.</p>
          )}
          <h3 className="nx-h3" style={{ marginTop: 20 }}>Bank details (disbursement target)</h3>
          {preview.bankDetails ? (
            <KV items={[
              { label: "Bank", value: String(preview.bankDetails.bank_name ?? "—") },
              { label: "Account number", value: String(preview.bankDetails.account_number ?? "—") },
              { label: "Account name", value: String(preview.bankDetails.account_name ?? "—") },
            ]} />
          ) : (
            <p className="nx-muted">No bank details saved yet.</p>
          )}
        </section>
      </div>

      <div className="nx-grid nx-grid--2" style={{ marginTop: 16 }}>
        <section className="nx-panel">
          <h3 className="nx-h3">Fees</h3>
          <Table columns={feeCols} rows={fees} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No fees recorded.</p>} />
        </section>
        <section className="nx-panel">
          <h3 className="nx-h3">Form stages</h3>
          <Table columns={stageCols} rows={stages} rowKey={(r) => String(r.id ?? r.stage_key)} empty={<p className="nx-muted">No stages started.</p>} />
        </section>
      </div>

      {decision && (
        <DecisionModal
          decision={decision}
          onClose={() => setDecision(null)}
          onSubmit={(reason) => {
            setDecision(null);
            act(`/loan-applications/${id}/decide`, { decision: decision, reason }, "Decision recorded");
          }}
        />
      )}

      {withdrawing && (
        <ConfirmDialog
          open
          title="Withdraw this application?"
          confirmLabel="Withdraw"
          onClose={() => setWithdrawing(false)}
          onConfirm={() => {
            setWithdrawing(false);
            act(`/loan-applications/${id}/withdraw`, { reason: "Withdrawn from the application view" }, "Application withdrawn");
          }} body={
            "The applicant can resubmit later; the withdrawal is recorded with a reason."
          } />
      )}

      {disbursing && (
        <ConfirmDialog
          open
          title="Disburse this application?"
          confirmLabel="Disburse"
          onClose={() => setDisbursing(false)}
          onConfirm={() => {
            setDisbursing(false);
            act(`/loan-disbursements`, { applicationId: id }, "Disbursement requested");
          }} body={
            "Disbursement creates the loan, the repayment schedule and the virtual account. This action is irreversible."
          } />
      )}
    </>
  );
}

function DecisionModal({ decision, onClose, onSubmit }: { decision: "approve" | "reject" | "request_information"; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title={`${decision.replace(/_/g, " ")} application`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={reason.trim().length < 3} onClick={() => onSubmit(reason)}>Submit decision</Button>
        </>
      }
    >
      <label className="nx-field">
        <span>Reason (min 3 chars) *</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} />
      </label>
    </Modal>
  );
}