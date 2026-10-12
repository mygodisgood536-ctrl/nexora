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
  PageHeader,
  StatusBadge,
  Table,
  useToast,
  type Column
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { day, money, personName, when } from "../lib/format";
import { useResource } from "../lib/useResource";

export function CustomerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const toast = useToast();
  const { data: c, loading, error, reload } = useResource<Record<string, unknown>>(() => api.get(`/customers/${id}`), [id]);
  const { data: history } = useResource<{ loans?: Record<string, unknown>[]; savingsBalance?: string; canApplyForLoan?: boolean }>(
    () => api.get<{ loans?: Record<string, unknown>[]; savingsBalance?: string; canApplyForLoan?: boolean }>(`/customers/${id}/loan-history`),
    [id]
  );
  const { data: portal } = useResource<Record<string, unknown>>(() => api.get(`/customers/${id}/portal-access`), [id]);
  const [confirmStatus, setConfirmStatus] = useState<"suspend" | "reactivate" | "close" | null>(null);

  const canEdit = me.permissions.includes("edit");
  const customer = c as Record<string, unknown> | null;

  if (loading) return <LoadingRow text="Loading customer…" />;
  if (error || !customer) return <ErrorState title="Could not load this customer" detail={error ?? undefined} onRetry={reload} />;

  const name = personName(customer);
  const loans = history?.loans ?? [];

  const loanCols: Column<Record<string, unknown>>[] = [
    { key: "disbursed", header: "Disbursed", render: (r) => day(r.disbursed_at) },
    { key: "principal", header: "Principal", numeric: true, render: (r) => money(r.principal_amount) },
    { key: "outstanding", header: "Outstanding", numeric: true, render: (r) => money(r.outstanding_principal) },
    { key: "rate", header: "Rate", numeric: true, render: (r) => String(r.interest_rate ?? "—") },
    { key: "cycle", header: "Cycle", render: (r) => `${String(r.cycle_count ?? "—")} × ${String(r.cycle_days ?? "—")}d` },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
  ];

  const doStatus = (action: "suspend" | "reactivate" | "close") => {
    setConfirmStatus(null);
    void api(`/customers/${id}/status`, { method: "POST", json: { action, reason: "From the customer profile" } })
      .then(() => {
        toast({ title: `Customer ${action}`, tone: "success" });
        reload();
      })
      .catch((err: Error) => toast({ title: "Could not update customer", text: err.message, tone: "danger" }));
  };

  return (
    <>
      <PageHeader
        title={name}
        eyebrow={String(customer.customer_code ?? "")}
        description={`${String(customer.phone ?? "no phone")} · ${String(customer.email ?? "no email")}`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>Back</Button>
            {canEdit && String(customer.status) === "active" && <Button variant="secondary" size="sm" onClick={() => setConfirmStatus("suspend")}>Suspend</Button>}
            {canEdit && String(customer.status) === "suspended" && <Button size="sm" onClick={() => setConfirmStatus("reactivate")}>Reactivate</Button>}
            {canEdit && <Button variant="secondary" size="sm" onClick={() => setConfirmStatus("close")}>Close</Button>}
          </>
        }
        breadcrumbs={<Crumbs items={[{ label: "Customers" }, { label: name }]} />}
      />

      <div className="nx-grid nx-grid--2">
        <section className="nx-panel">
          <h3 className="nx-h3">Profile</h3>
          <KV items={[
            { label: "Full name", value: name },
            { label: "Address", value: String(customer.address ?? "—") },
            { label: "Status", value: <StatusBadge status={String(customer.status ?? "unknown")} /> },
            { label: "KYC", value: customer.kyc_complete ? <Badge tone="success">complete</Badge> : <Badge tone="warning">incomplete</Badge> },
            { label: "Profile", value: customer.profile_complete ? <Badge tone="success">complete</Badge> : <Badge tone="warning">incomplete</Badge> },
            { label: "Gender", value: String(customer.gender ?? "—") },
            { label: "Marital status", value: String((customer.marital_status ?? "—").toString().replace(/_/g, " ")) },
            { label: "Occupation", value: String(customer.occupation ?? "—") },
            { label: "Business type", value: String(customer.business_type ?? "—") },
            { label: "Created", value: day(customer.created_at) },
          ]} />
        </section>

        <section className="nx-panel">
          <h3 className="nx-h3">Savings & eligibility</h3>
          <KV items={[
            { label: "Savings balance", value: money(history?.savingsBalance ?? 0) },
            { label: "Can apply for loan", value: history?.canApplyForLoan ? <Badge tone="success">yes</Badge> : <Badge tone="neutral">no — has an open loan</Badge> },
            { label: "Next of kin", value: String(customer.next_of_kin_name ?? "—") },
            { label: "Guarantor", value: String(customer.guarantor_name ?? "—") },
          ]} />
          <h3 className="nx-h3" style={{ marginTop: 20 }}>Portal access</h3>
          {portal?.provisioned ? (
            <KV items={[
              { label: "Username", value: String(portal.username ?? "—") },
              { label: "Status", value: <StatusBadge status={String(portal.status ?? "unknown")} /> },
              { label: "Portal URL", value: String(portal.portalUrl ?? "—") },
              { label: "Last login", value: when(portal.lastLoginAt) },
            ]} />
          ) : (
            <p className="nx-muted">Portal access is provisioned at loan disbursement time.</p>
          )}
        </section>
      </div>

      <section className="nx-panel" style={{ marginTop: 16 }}>
        <h3 className="nx-h3">Loan history</h3>
        <Table
          columns={loanCols}
          rows={loans}
          rowKey={(r) => String(r.id)}
          empty={<p className="nx-muted">No loans disbursed yet.</p>}
          onRowClick={(r) => navigate(`/credit/${String(r.application_id ?? r.id)}`)}
        />
      </section>

      {confirmStatus && (
        <ConfirmDialog
          open
          title={`${confirmStatus} this customer?`}
          confirmLabel={confirmStatus}
          onClose={() => setConfirmStatus(null)}
          onConfirm={() => doStatus(confirmStatus)} body={
            "A reason is required by the API; this action will be recorded in the audit trail."
          } />
      )}
    </>
  );
}