import { useState } from "react";
import {
  Badge,
  Button,
  ErrorState,
  KV,
  LoadingRow,
  Modal,
  PageHeader,
  Stat,
  Table,
  Tabs,
  useToast,
  type Column
} from "@nexora/ui";
import { api } from "../lib/api";
import { money, pct, todayParam } from "../lib/format";
import { useList, useResource } from "../lib/useResource";
import { Crumbs } from "./parts";

type TabKey = "overview" | "workers" | "book";

interface WorkerBook {
  worker: {
    id: string;
    workerCode: string;
    username: string;
    fullName: string;
    status: string;
    credentialState: string;
    roleKeys: string[];
  };
  period: { from: string; to: string };
  assignedCustomers: Array<{ id: string; customer_code: string; first_name: string; last_name: string; status: string }>;
  assignedGroups: Array<{ id: string; name: string; status: string }>;
  loans: Array<{ id: string; customer_code: string; principal_amount: string; outstanding_principal: string; status: string; disbursed_at: string | null }>;
  disbursements: Array<{ loan_id: string; disbursed_at: string; principal_amount: string; customer_code: string }>;
  performance: { expected: string; actual: string; outstanding: string; overdue: string; collectionRate: string | null; graceDays: number };
}

export function WorkplacePage() {
  const toast = useToast();
  const branches = useList<Record<string, unknown>>("/branches", { pageSize: 100 });
  const [branchId, setBranchId] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const [bookFor, setBookFor] = useState<Record<string, unknown> | null>(null);
  const [period, setPeriod] = useState({ from: todayParam(), to: todayParam() });

  return (
    <>
      <PageHeader
        title="Branch workplace"
        description="Inspect a branch you supervise from your own portal — no second password (RULE 7.1.1)."
        breadcrumbs={<Crumbs items={[{ label: "Workplace" }]} />}
      />

      <div className="nx-toolbar">
        <label className="nx-field">
          <span>Branch</span>
          <select className="nx-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Choose a branch…</option>
            {branches.rows.map((b) => (
              <option key={String(b.id)} value={String(b.id)}>
                {String(b.name)} ({String(b.code)})
              </option>
            ))}
          </select>
        </label>
        <label className="nx-field">
          <span>From</span>
          <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
        </label>
        <label className="nx-field">
          <span>To</span>
          <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
        </label>
      </div>

      {!branchId ? (
        <p className="nx-muted">Choose a branch to open its workplace. Your entry is recorded in the audit trail.</p>
      ) : (
        <>
          <Tabs
            items={[
              { key: "overview", label: "Overview" },
              { key: "workers", label: "Workers" },
            ]}
            value={tab}
            onChange={(k) => setTab(k as TabKey)}
          />
          <div style={{ marginTop: 16 }}>
            {tab === "overview" && (
              <Overview
                branchId={branchId}
                period={period}
                onError={(m) => toast({ title: "Access refused", text: m, tone: "danger" })}
              />
            )}
            {tab === "workers" && (
              <Workers
                branchId={branchId}
                period={period}
                onOpenBook={(w) => setBookFor(w)}
                onError={(m) => toast({ title: "Access refused", text: m, tone: "danger" })}
              />
            )}
          </div>
          {bookFor && (
            <WorkerBookModal
              branchId={branchId}
              period={period}
              workerId={String(bookFor.id ?? bookFor.workerId ?? "")}
              name={String(bookFor.full_name ?? bookFor.worker_code ?? "Worker")}
              onClose={() => setBookFor(null)}
            />
          )}
        </>
      )}
    </>
  );
}

function Overview({
  branchId,
  period,
  onError
}: {
  branchId: string;
  period: { from: string; to: string };
  onError: (m: string) => void;
}) {
  const { data, loading, error, reload } = useResource<Record<string, unknown>>(
    () => api.get(`/branch-workplace/overview?branch=${branchId}&from=${period.from}&to=${period.to}`),
    [branchId, period.from, period.to]
  );

  if (loading) return <LoadingRow text="Loading the branch…" />;
  if (error) {
    if (error.toLowerCase().includes("not granted")) onError(error);
    return <ErrorState title="Could not open this branch" detail={error} onRetry={reload} />;
  }
  if (!data) return <p className="nx-muted">No figures for this branch.</p>;

  const branch = (data.branch ?? {}) as Record<string, unknown>;
  const financials = (data.financials ?? {}) as Record<string, unknown>;
  const savings = (data.savings ?? {}) as Record<string, unknown>;
  const loans = (data.loans ?? {}) as Record<string, unknown>;
  const periodInfo = (data.period ?? {}) as Record<string, unknown>;

  return (
    <>
      <div className="nx-metrics">
        <Stat label="Branch" value={String(branch.branch_name ?? "—")} hint={String(branch.branch_status ?? "")} />
        <Stat label="Customers with loans" value={String(branch.customer_count ?? 0)} />
        <Stat label="Active loans" value={String(branch.active_loan_count ?? 0)} />
        <Stat label="Expected" value={money(financials.expected_amount ?? 0)} />
        <Stat label="Realised" value={money(financials.realised_amount ?? 0)} />
        <Stat label="Overdue" value={money(financials.overdue_amount ?? 0)} accent={Number(financials.overdue_amount ?? 0) > 0} />
        <Stat label="Savings collected" value={money(savings.collected_amount ?? savings.savings_amount ?? 0)} />
        <Stat label="Loans disbursed" value={String(loans.disbursed_count ?? 0)} />
      </div>
      <section className="nx-panel" style={{ marginTop: 16 }}>
        <h3 className="nx-h3">Identity</h3>
        <KV
          items={[
            { label: "Code", value: String(branch.branch_code ?? "—") },
            { label: "Status", value: <Badge tone={branch.branch_status === "active" ? "success" : "neutral"}>{String(branch.branch_status ?? "—")}</Badge> },
            { label: "Portal URL", value: String(branch.portal_url ?? "—") },
            { label: "Opened", value: String(branch.created_at ?? "—").slice(0, 10) },
            { label: "Period", value: `${String(periodInfo.from ?? "—")} → ${String(periodInfo.to ?? "—")}` },
            { label: "Grace days", value: String(periodInfo.grace_days ?? "—") },
          ]}
        />
      </section>
      <section className="nx-panel" style={{ marginTop: 16 }}>
        <h3 className="nx-h3">Raw sections</h3>
        <p className="nx-muted">Figures the workplace engine returns for this branch.</p>
        <KV
          items={Object.entries({ ...financials, savings, loans }).flatMap(([section, value]) =>
            Object.entries((value ?? {}) as Record<string, unknown>)
              .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
              .slice(0, 12)
              .map(([k, v]) => ({ label: `${section}.${k.replace(/_/g, " ")}`, value: String(v ?? "—") }))
          )}
        />
      </section>
    </>
  );
}

function Workers({
  branchId,
  period,
  onOpenBook,
  onError
}: {
  branchId: string;
  period: { from: string; to: string };
  onOpenBook: (w: Record<string, unknown>) => void;
  onError: (m: string) => void;
}) {
  const { data, loading, error, reload } = useResource<{ workers?: Record<string, unknown>[] }>(
    () => api.get(`/branch-workplace/workers?branch=${branchId}&from=${period.from}&to=${period.to}`),
    [branchId, period.from, period.to]
  );

  const cols: Column<Record<string, unknown>>[] = [
    { key: "worker", header: "Worker", render: (r) => <strong>{String(r.full_name ?? r.worker_code ?? "—")}</strong> },
    { key: "code", header: "Code", render: (r) => String(r.worker_code ?? "—") },
    { key: "role", header: "Role", render: (r) => String(r.role_key ?? "").replace(/_/g, " ") || "—" },
    { key: "customers", header: "Customers", numeric: true, render: (r) => String(r.assigned_customers ?? r.customers ?? 0) },
    { key: "expected", header: "Expected", numeric: true, render: (r) => money(r.expected_amount ?? 0) },
    { key: "actual", header: "Realised", numeric: true, render: (r) => money(r.realised_amount ?? 0) },
    { key: "overdue", header: "Overdue", numeric: true, render: (r) => money(r.overdue_amount ?? 0) },
    {
      key: "action",
      header: "",
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpenBook(r); }}>
          Open book
        </Button>
      )
    },
  ];

  if (loading) return <LoadingRow text="Loading branch workers…" />;
  if (error) {
    if (error.toLowerCase().includes("not granted")) onError(error);
    return <ErrorState title="Could not read the branch workers" detail={error} onRetry={reload} />;
  }

  return <Table columns={cols} rows={data?.workers ?? []} rowKey={(r) => String(r.id ?? r.worker_code ?? "")} empty={<p className="nx-muted">This branch has no active workers.</p>} />;
}

function WorkerBookModal({
  branchId,
  period,
  workerId,
  name,
  onClose
}: {
  branchId: string;
  period: { from: string; to: string };
  workerId: string;
  name: string;
  onClose: () => void;
}) {
  const { data, loading, error } = useResource<WorkerBook>(
    () => api.get(`/branch-workplace/workers/${workerId}?branch=${branchId}&from=${period.from}&to=${period.to}`),
    [branchId, workerId, period.from, period.to]
  );

  const p = data?.performance;

  return (
    <Modal open onClose={onClose} title={`${name}'s book`}>
      {loading ? <LoadingRow text="Loading the book…" /> : error ? (
        <ErrorState title="Could not open the book" detail={error} />
      ) : !data ? (
        <p className="nx-muted">Nothing recorded.</p>
      ) : (
        <div className="nx-stack">
          <div className="nx-metrics">
            <Stat label="Expected" value={money(p?.expected ?? 0)} />
            <Stat label="Realised" value={money(p?.actual ?? 0)} />
            <Stat label="Rate" value={p?.collectionRate ? pct(p.collectionRate) : "—"} />
            <Stat label="Outstanding" value={money(p?.outstanding ?? 0)} />
            <Stat label="Overdue" value={money(p?.overdue ?? 0)} accent={Number(p?.overdue ?? 0) > 0} />
          </div>
          <KV
            items={[
              { label: "Worker code", value: String(data.worker.workerCode ?? "—") },
              { label: "Username", value: String(data.worker.username ?? "—") },
              { label: "Status", value: String(data.worker.status ?? "—") },
              { label: "Roles", value: data.worker.roleKeys.map((k) => k.replace(/_/g, " ")).join(", ") || "—" },
            ]}
          />
          <div>
            <h4 className="nx-h3">Assigned customers</h4>
            <Table
              columns={[
                { key: "code", header: "Code", render: (r: { customer_code: string }) => String(r.customer_code) },
                { key: "name", header: "Name", render: (r: { first_name: string; last_name: string }) => `${r.first_name} ${r.last_name}` },
                { key: "status", header: "Status", render: (r: { status: string }) => <Badge tone="neutral">{String(r.status)}</Badge> },
              ]}
              rows={data.assignedCustomers}
              rowKey={(r) => String(r.id)}
              empty={<p className="nx-muted">No assigned customers.</p>}
            />
          </div>
          <div>
            <h4 className="nx-h3">Assigned groups</h4>
            <Table
              columns={[
                { key: "name", header: "Group", render: (r: { name: string }) => String(r.name) },
                { key: "status", header: "Status", render: (r: { status: string }) => <Badge tone="neutral">{String(r.status)}</Badge> },
              ]}
              rows={data.assignedGroups}
              rowKey={(r) => String(r.id)}
              empty={<p className="nx-muted">No assigned groups.</p>}
            />
          </div>
          <div>
            <h4 className="nx-h3">Loans carried</h4>
            <Table
              columns={[
                { key: "code", header: "Customer", render: (r: { customer_code: string }) => String(r.customer_code) },
                { key: "principal", header: "Principal", numeric: true, render: (r: { principal_amount: string }) => money(r.principal_amount) },
                { key: "outstanding", header: "Outstanding", numeric: true, render: (r: { outstanding_principal: string }) => money(r.outstanding_principal) },
                { key: "status", header: "Status", render: (r: { status: string }) => String(r.status) },
              ]}
              rows={data.loans}
              rowKey={(r) => String(r.id)}
              empty={<p className="nx-muted">No loans carried.</p>}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}