import { useState } from "react";
import {
  Button,
  ErrorState,
  KV,
  LoadingRow,
  PageHeader,
  Stat,
  Table,
  Tabs,
  useToast,
  type Column
} from "@nexora/ui";
import { api, apiUrl, getToken } from "../lib/api";
import { money, pct, todayParam } from "../lib/format";
import { useResource } from "../lib/useResource";
import { Crumbs } from "./parts";

type TabKey = "summary" | "branches" | "staff";

export interface PerformanceSet {
  expected: string;
  actual: string;
  outstanding: string;
  overdue: string;
  collectionRate: string | null;
  noCollectionsDue: boolean;
  expectedSavings: string;
  actualSavings: string;
  savingsVariance: string;
  customersExpected: number;
  customersPaid: number;
  customersMissed: number;
  activeCustomers: number;
  activeLoans: number;
  overdueCustomers: number;
}

function usePeriod(): [{ from: string; to: string }, (p: { from: string; to: string }) => void] {
  const [period, setPeriod] = useState({ from: todayParam(), to: todayParam() });
  return [period, setPeriod];
}

function Range({ period, onChange }: { period: { from: string; to: string }; onChange: (p: { from: string; to: string }) => void }) {
  return (
    <div className="nx-toolbar">
      <label className="nx-field">
        <span>From</span>
        <input type="date" value={period.from} onChange={(e) => onChange({ ...period, from: e.target.value })} />
      </label>
      <label className="nx-field">
        <span>To</span>
        <input type="date" value={period.to} onChange={(e) => onChange({ ...period, to: e.target.value })} />
      </label>
      <span className="nx-grow" />
      <span className="nx-faint">Report figures come from the shared performance engine; totals always equal the rows shown.</span>
    </div>
  );
}

/** Summary tiles reused by the report and performance views. */
export function PerformanceStats({ p }: { p: PerformanceSet | undefined }) {
  if (!p) return null;
  return (
    <div className="nx-metrics">
      <Stat label="Expected" value={money(p.expected)} hint={`${p.customersExpected} customers due`} />
      <Stat label="Actual" value={money(p.actual)} hint={`${p.customersPaid} paid, ${p.customersMissed} missed`} />
      <Stat label="Collection rate" value={p.noCollectionsDue ? "no collections due" : pct(p.collectionRate ?? 0)} />
      <Stat label="Outstanding" value={money(p.outstanding)} />
      <Stat label="Overdue" value={money(p.overdue)} hint={`${p.overdueCustomers} customers`} accent={Number(p.overdue) > 0} />
      <Stat label="Savings" value={money(p.actualSavings)} hint={`expected ${money(p.expectedSavings)} · variance ${money(p.savingsVariance)}`} />
      <Stat label="Active loans" value={String(p.activeLoans)} />
      <Stat label="Active customers" value={String(p.activeCustomers)} />
    </div>
  );
}

export function ReportsPage() {
  const [tab, setTab] = useState<TabKey>("summary");
  const [period, setPeriod] = usePeriod();

  return (
    <>
      <PageHeader
        title="Report library"
        description="Company, branch and staff performance for a chosen period, with CSV export (RULE 11.6.2)."
        breadcrumbs={<Crumbs items={[{ label: "Reports" }]} />}
      />
      <Tabs
        items={[
          { key: "summary", label: "Company summary" },
          { key: "branches", label: "Branches" },
          { key: "staff", label: "Staff" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />
      <div style={{ marginTop: 16 }}>
        <Range period={period} onChange={setPeriod} />
        {tab === "summary" && <ReportSummary period={period} />}
        {tab === "branches" && <BranchReport period={period} />}
        {tab === "staff" && <StaffReport period={period} />}
      </div>
    </>
  );
}

function ReportSummary({ period }: { period: { from: string; to: string } }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<PerformanceSet>(
    () => api.get<PerformanceSet>(`/reports/summary?from=${period.from}&to=${period.to}`),
    [period.from, period.to]
  );

  if (loading) return <LoadingRow text="Building the company summary…" />;
  if (error) return <ErrorState title="Could not build the summary" detail={error} onRetry={reload} />;
  if (!data) return <p className="nx-muted">No figures for this period.</p>;

  return (
    <>
      <PerformanceStats p={data} />
      <div className="nx-toolbar" style={{ marginTop: 12 }}>
        <CsvButton
          label="Download CSV"
          path={`/reports/summary?from=${period.from}&to=${period.to}&format=csv`}
          filename={`performance-summary-${period.from}-to-${period.to}.csv`}
          onError={(m) => toast({ title: "Download failed", text: m, tone: "danger" })}
        />
      </div>
    </>
  );
}

function BranchReport({ period }: { period: { from: string; to: string } }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<{
    rows?: Array<PerformanceSet & { branchId: string; branchCode: string; collectionOfficers: number }>;
    total?: PerformanceSet;
  }>(() => api.get(`/reports/branches?from=${period.from}&to=${period.to}`), [period.from, period.to]);

  const cols: Column<PerformanceSet & { branchId: string; branchCode: string; collectionOfficers: number }>[] = [
    { key: "code", header: "Branch", render: (r) => <strong>{String(r.branchCode ?? "")}</strong> },
    { key: "officers", header: "Officers", numeric: true, render: (r) => String(r.collectionOfficers ?? 0) },
    { key: "expected", header: "Expected", numeric: true, render: (r) => money(r.expected) },
    { key: "actual", header: "Actual", numeric: true, render: (r) => money(r.actual) },
    { key: "rate", header: "Rate", numeric: true, render: (r) => (r.noCollectionsDue ? "—" : pct(r.collectionRate ?? 0)) },
    { key: "overdue", header: "Overdue", numeric: true, render: (r) => money(r.overdue) },
  ];

  if (loading) return <LoadingRow text="Building the branch table…" />;
  if (error) return <ErrorState title="Could not build the branch table" detail={error} onRetry={reload} />;
  const rows = data?.rows ?? [];

  return (
    <>
      <Table columns={cols} rows={rows} rowKey={(r) => String(r.branchId)} empty={<p className="nx-muted">No branches in scope for this period.</p>} />
      {data?.total ? (
        <section className="nx-panel" style={{ marginTop: 12 }}>
          <h3 className="nx-h3">Scope total</h3>
          <PerformanceStats p={data.total} />
        </section>
      ) : null}
      <div className="nx-toolbar" style={{ marginTop: 12 }}>
        <CsvButton
          label="Download CSV"
          path={`/reports/branches?from=${period.from}&to=${period.to}&format=csv`}
          filename={`branch-performance-${period.from}-to-${period.to}.csv`}
          onError={(m) => toast({ title: "Download failed", text: m, tone: "danger" })}
        />
      </div>
    </>
  );
}

function StaffReport({ period }: { period: { from: string; to: string } }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<{
    rows?: Array<PerformanceSet & { staffId: string; workerCode: string; roleKey: string }>;
    total?: PerformanceSet;
  }>(() => api.get(`/reports/staff?from=${period.from}&to=${period.to}`), [period.from, period.to]);

  const cols: Column<PerformanceSet & { staffId: string; workerCode: string; roleKey: string }>[] = [
    { key: "worker", header: "Worker", render: (r) => <><strong>{String(r.workerCode ?? "")}</strong><div className="nx-faint">{String(r.roleKey ?? "").replace(/_/g, " ")}</div></> },
    { key: "expected", header: "Expected", numeric: true, render: (r) => money(r.expected) },
    { key: "actual", header: "Actual", numeric: true, render: (r) => money(r.actual) },
    { key: "rate", header: "Rate", numeric: true, render: (r) => (r.noCollectionsDue ? "—" : pct(r.collectionRate ?? 0)) },
    { key: "missed", header: "Missed", numeric: true, render: (r) => String(r.customersMissed ?? 0) },
    { key: "overdue", header: "Overdue", numeric: true, render: (r) => money(r.overdue) },
  ];

  if (loading) return <LoadingRow text="Building the staff table…" />;
  if (error) return <ErrorState title="Could not build the staff table" detail={error} onRetry={reload} />;
  const rows = data?.rows ?? [];

  return (
    <>
      <Table columns={cols} rows={rows} rowKey={(r) => String(r.staffId)} empty={<p className="nx-muted">No staff figures for this period.</p>} />
      {data?.total ? (
        <section className="nx-panel" style={{ marginTop: 12 }}>
          <h3 className="nx-h3">Scope total</h3>
          <PerformanceStats p={data.total} />
        </section>
      ) : null}
      <div className="nx-toolbar" style={{ marginTop: 12 }}>
        <CsvButton
          label="Download CSV"
          path={`/reports/staff?from=${period.from}&to=${period.to}&format=csv`}
          filename={`staff-performance-${period.from}-to-${period.to}.csv`}
          onError={(m) => toast({ title: "Download failed", text: m, tone: "danger" })}
        />
      </div>
    </>
  );
}

/** CSV export: fetches the raw text (not JSON) and saves it as a file. */
export function CsvButton({
  path,
  filename,
  label = "Download CSV",
  onError
}: {
  path: string;
  filename: string;
  label?: string;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void (async () => {
          try {
            const token = getToken();
            const res = await fetch(apiUrl(path), {
              credentials: "include",
              headers: token ? { authorization: `Bearer ${token}` } : {}
            });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const text = await res.text();
            const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
          } catch (err) {
            onError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      {busy ? "Preparing…" : label}
    </Button>
  );
}

/** Small helper reused by Field/Workplace pages for definition-style panels. */
export function Facts({ items }: { items: Array<{ label: string; value: string }> }) {
  return <KV items={items.map((i) => ({ label: i.label, value: i.value }))} />;
}