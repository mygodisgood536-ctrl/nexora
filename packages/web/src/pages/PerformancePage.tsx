import { useState } from "react";
import { Button, ErrorState, LoadingRow, PageHeader, Table, Tabs, type Column } from "@nexora/ui";
import { api } from "../lib/api";
import { money, pct, todayParam } from "../lib/format";
import { useResource } from "../lib/useResource";
import { Crumbs } from "./parts";
import { PerformanceStats, type PerformanceSet } from "./ReportsPage";

type TabKey = "summary" | "branches" | "staff";

interface BranchRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  collectionOfficers: number;
  performance: PerformanceSet;
}

interface StaffRow {
  staffId: string;
  username: string;
  firstName: string;
  lastName: string;
  roleKeys: string[];
  branchId: string | null;
  assignedCustomers: number;
  assignedGroups: number;
  performance: PerformanceSet;
}

export function PerformancePage() {
  const [tab, setTab] = useState<TabKey>("summary");
  const [period, setPeriod] = useState({ from: todayParam(), to: todayParam() });

  return (
    <>
      <PageHeader
        title="Performance"
        description="Expected against realised money for a period, computed by the shared engine (RULE 11.3.1)."
        breadcrumbs={<Crumbs items={[{ label: "Performance" }]} />}
      />
      <Tabs
        items={[
          { key: "summary", label: "My figures" },
          { key: "branches", label: "Branches" },
          { key: "staff", label: "Staff" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />
      <div style={{ marginTop: 16 }}>
        <div className="nx-toolbar">
          <label className="nx-field">
            <span>From</span>
            <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
          </label>
          <label className="nx-field">
            <span>To</span>
            <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
          </label>
          <span className="nx-grow" />
          <Button size="sm" onClick={() => setPeriod({ from: todayParam(), to: todayParam() })}>Today</Button>
        </div>
        {tab === "summary" && <Summary period={period} />}
        {tab === "branches" && <Branches period={period} />}
        {tab === "staff" && <Staff period={period} />}
      </div>
    </>
  );
}

function Summary({ period }: { period: { from: string; to: string } }) {
  const { data, loading, error, reload } = useResource<{
    period: { from: string; to: string };
    scope: { branchId: string | null; staffId: string | null };
    performance: PerformanceSet;
  }>(() => api.get(`/performance/summary?from=${period.from}&to=${period.to}`), [period.from, period.to]);

  if (loading) return <LoadingRow text="Calculating…" />;
  if (error) return <ErrorState title="Could not read performance" detail={error} onRetry={reload} />;
  if (!data) return <p className="nx-muted">No figures for this period.</p>;

  return (
    <>
      <p className="nx-muted">
        {data.scope.staffId ? "Your own figures." : data.scope.branchId ? "Your branch." : "Company-wide."}{" "}
        {data.performance.noCollectionsDue ? "Nothing was due in this period." : ""}
      </p>
      <PerformanceStats p={data.performance} />
    </>
  );
}

function Branches({ period }: { period: { from: string; to: string } }) {
  const { data, loading, error, reload } = useResource<{ branches?: BranchRow[]; total?: PerformanceSet }>(
    () => api.get(`/performance/branches?from=${period.from}&to=${period.to}`),
    [period.from, period.to]
  );

  const cols: Column<BranchRow>[] = [
    { key: "branch", header: "Branch", render: (r) => <><strong>{String(r.branchName ?? "")}</strong><div className="nx-faint">{String(r.branchCode ?? "")}</div></> },
    { key: "officers", header: "Officers", numeric: true, render: (r) => String(r.collectionOfficers ?? 0) },
    { key: "expected", header: "Expected", numeric: true, render: (r) => money(r.performance.expected) },
    { key: "actual", header: "Actual", numeric: true, render: (r) => money(r.performance.actual) },
    { key: "rate", header: "Rate", numeric: true, render: (r) => (r.performance.noCollectionsDue ? "—" : pct(r.performance.collectionRate ?? 0)) },
    { key: "overdue", header: "Overdue", numeric: true, render: (r) => money(r.performance.overdue) },
    { key: "loans", header: "Active loans", numeric: true, render: (r) => String(r.performance.activeLoans ?? 0) },
  ];

  if (loading) return <LoadingRow text="Calculating branches…" />;
  if (error) return <ErrorState title="Could not read branch performance" detail={error} onRetry={reload} />;

  return (
    <>
      <Table columns={cols} rows={data?.branches ?? []} rowKey={(r) => String(r.branchId)} empty={<p className="nx-muted">No branches in your scope.</p>} />
      {data?.total ? (
        <section className="nx-panel" style={{ marginTop: 12 }}>
          <h3 className="nx-h3">Scope total</h3>
          <PerformanceStats p={data.total} />
        </section>
      ) : null}
    </>
  );
}

function Staff({ period }: { period: { from: string; to: string } }) {
  const { data, loading, error, reload } = useResource<{ staff?: StaffRow[]; total?: PerformanceSet }>(
    () => api.get(`/performance/staff?from=${period.from}&to=${period.to}`),
    [period.from, period.to]
  );

  const cols: Column<StaffRow>[] = [
    {
      key: "worker",
      header: "Worker",
      render: (r) => (
        <>
          <strong>{[r.firstName, r.lastName].filter(Boolean).join(" ") || String(r.username ?? "")}</strong>
          <div className="nx-faint">{(r.roleKeys ?? []).map((k) => k.replace(/_/g, " ")).join(", ")}</div>
        </>
      )
    },
    { key: "book", header: "Book", numeric: true, render: (r) => `${r.assignedCustomers ?? 0} customers · ${r.assignedGroups ?? 0} groups` },
    { key: "expected", header: "Expected", numeric: true, render: (r) => money(r.performance.expected) },
    { key: "actual", header: "Actual", numeric: true, render: (r) => money(r.performance.actual) },
    { key: "rate", header: "Rate", numeric: true, render: (r) => (r.performance.noCollectionsDue ? "—" : pct(r.performance.collectionRate ?? 0)) },
    { key: "missed", header: "Missed", numeric: true, render: (r) => String(r.performance.customersMissed ?? 0) },
    { key: "overdue", header: "Overdue", numeric: true, render: (r) => money(r.performance.overdue) },
  ];

  if (loading) return <LoadingRow text="Calculating staff…" />;
  if (error) return <ErrorState title="Could not read staff performance" detail={error} onRetry={reload} />;

  return (
    <>
      <Table columns={cols} rows={data?.staff ?? []} rowKey={(r) => String(r.staffId)} empty={<p className="nx-muted">No staff carry a book in your scope.</p>} />
      {data?.total ? (
        <section className="nx-panel" style={{ marginTop: 12 }}>
          <h3 className="nx-h3">Scope total</h3>
          <PerformanceStats p={data.total} />
        </section>
      ) : null}
    </>
  );
}