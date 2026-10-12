import { Crumbs } from "./parts";
import { useState } from "react";
import { Badge, ErrorState, LoadingRow, PageHeader, Stat, Tabs, Table, type Column } from "@nexora/ui";
import { api } from "../lib/api";
import { money, todayParam } from "../lib/format";
import { useResource } from "../lib/useResource";

type TabKey = "cash_book" | "trial_balance" | "ledger" | "cash_flow" | "income_statement" | "financial_position";

type Period = { from: string; to: string };

function periodParams(p: Period): URLSearchParams {
  return new URLSearchParams({ from: p.from, to: p.to });
}

function DateRange({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="nx-toolbar">
      <label className="nx-field" style={{ margin: 0 }}>
        <span>From</span>
        <input type="date" value={period.from} onChange={(e) => onChange({ ...period, from: e.target.value })} />
      </label>
      <label className="nx-field" style={{ margin: 0 }}>
        <span>To</span>
        <input type="date" value={period.to} onChange={(e) => onChange({ ...period, to: e.target.value })} />
      </label>
    </div>
  );
}

export function MoneyPage() {
  const [tab, setTab] = useState<TabKey>("cash_book");
  const today = todayParam();
  const [period, setPeriod] = useState<Period>({ from: `${today.slice(0, 4)}-01-01`, to: today });

  return (
    <>
      <PageHeader
        title="Money"
        description="Statements derived from the posted double-entry journal — read-only (Part 2 §38–39)."
        breadcrumbs={<Crumbs items={[{ label: "Money" }]} />}
      />
      <Tabs
        items={[
          { key: "cash_book", label: "Cash book" },
          { key: "trial_balance", label: "Trial balance" },
          { key: "ledger", label: "General ledger" },
          { key: "cash_flow", label: "Cash flow" },
          { key: "income_statement", label: "Income statement" },
          { key: "financial_position", label: "Financial position" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />
      <DateRange period={period} onChange={setPeriod} />
      <div style={{ marginTop: 8 }}>
        {tab === "cash_book" && <CashBook period={period} />}
        {tab === "trial_balance" && <TrialBalance period={period} />}
        {tab === "ledger" && <Ledger period={period} />}
        {tab === "cash_flow" && <CashFlow period={period} />}
        {tab === "income_statement" && <IncomeStatement period={period} />}
        {tab === "financial_position" && <FinancialPosition period={period} />}
      </div>
    </>
  );
}

function CashBook({ period }: { period: Period }) {
  const { data, loading, error, reload } = useResource<{
    items?: Array<Record<string, unknown>>;
    inflows?: string; outflows?: string; net?: string;
  }>(() => api.get("/accounting/cash-book", { params: periodParams(period) }), [period.from, period.to]);

  const cols: Column<Record<string, unknown>>[] = [
    { key: "date", header: "Date", render: (r) => String(r.entryDate ?? "—") },
    { key: "desc", header: "Description", render: (r) => String(r.description ?? "—") },
    { key: "source", header: "Source", render: (r) => String(r.source ?? "—") },
    { key: "gl", header: "Cash account", render: (r) => <span className="nx-faint">{String((r.glAccount as Record<string, unknown> | undefined)?.code ?? "—")}</span> },
    { key: "dir", header: "Direction", render: (r) => String(r.direction ?? "—") },
    { key: "amount", header: "Amount", numeric: true, render: (r) => money(r.amount) },
  ];

  if (loading) return <LoadingRow text="Loading cash book…" />;
  if (error) return <ErrorState title="Could not load the cash book" detail={error} onRetry={reload} />;
  return (
    <>
      <section className="nx-metrics">
        <Stat label="Inflows" value={money(data?.inflows ?? 0)} />
        <Stat label="Outflows" value={money(data?.outflows ?? 0)} />
        <Stat label="Net" value={money(data?.net ?? 0)} accent />
      </section>
      <Table columns={cols} rows={data?.items ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No cash movements in this period.</p>} />
    </>
  );
}

function TrialBalance({ period }: { period: Period }) {
  const { data, loading, error, reload } = useResource<{
    rows?: Array<Record<string, unknown>>;
    totalDebits?: string; totalCredits?: string; balanced?: boolean; asOf?: string;
  }>(() => api.get("/accounting/trial-balance", { params: new URLSearchParams({ asOf: period.to }) }), [period.to]);

  const cols: Column<Record<string, unknown>>[] = [
    { key: "code", header: "Code", render: (r) => String(r.code ?? "—") },
    { key: "name", header: "Account", render: (r) => String(r.name ?? "—") },
    { key: "type", header: "Type", render: (r) => String(r.accountType ?? "—") },
    { key: "cash", header: "Cash", render: (r) => r.isCash ? <Badge tone="info">cash</Badge> : null },
    { key: "debit", header: "Debits", numeric: true, render: (r) => money(r.debits) },
    { key: "credit", header: "Credits", numeric: true, render: (r) => money(r.credits) },
  ];

  if (loading) return <LoadingRow text="Loading trial balance…" />;
  if (error) return <ErrorState title="Could not load the trial balance" detail={error} onRetry={reload} />;
  return (
    <>
      <section className="nx-metrics">
        <Stat label="Total debits" value={money(data?.totalDebits ?? 0)} />
        <Stat label="Total credits" value={money(data?.totalCredits ?? 0)} />
        <Stat label="Balanced" value={data?.balanced ? "yes" : "no"} hint={`as at ${String(data?.asOf ?? "")}`} accent />
      </section>
      <Table columns={cols} rows={data?.rows ?? []} rowKey={(r) => String(r.code)} empty={<p className="nx-muted">No journal activity.</p>} />
    </>
  );
}

function Ledger({ period }: { period: Period }) {
  const { data, loading, error, reload } = useResource<{
    items?: Array<Record<string, unknown>>;
    accounts?: Array<Record<string, unknown>>;
    totals?: { debits?: string; credits?: string; balance?: string };
  }>(() => api.get("/accounting/ledger", { params: periodParams(period) }), [period.from, period.to]);

  const itemCols: Column<Record<string, unknown>>[] = [
    { key: "date", header: "Date", render: (r) => String(r.entryDate ?? "—") },
    { key: "desc", header: "Description", render: (r) => String(r.description ?? "—") },
    { key: "gl", header: "Account", render: (r) => <><strong>{String((r.glAccount as Record<string, unknown> | undefined)?.code ?? "")}</strong> <span className="nx-faint">{String((r.glAccount as Record<string, unknown> | undefined)?.name ?? "")}</span></> },
    { key: "dir", header: "Dr/Cr", render: (r) => String(r.direction ?? "—") },
    { key: "amount", header: "Amount", numeric: true, render: (r) => money(r.amount) },
    { key: "running", header: "Running", numeric: true, render: (r) => money(r.runningBalance) },
  ];

  const accCols: Column<Record<string, unknown>>[] = [
    { key: "code", header: "Account", render: (r) => String((r.glAccount as Record<string, unknown> | undefined)?.code ?? "—") },
    { key: "name", header: "Name", render: (r) => String((r.glAccount as Record<string, unknown> | undefined)?.name ?? "—") },
    { key: "debits", header: "Debits", numeric: true, render: (r) => money(r.debits) },
    { key: "credits", header: "Credits", numeric: true, render: (r) => money(r.credits) },
    { key: "balance", header: "Balance", numeric: true, render: (r) => money(r.balance) },
  ];

  if (loading) return <LoadingRow text="Loading ledger…" />;
  if (error) return <ErrorState title="Could not load the general ledger" detail={error} onRetry={reload} />;
  return (
    <>
      <section className="nx-metrics">
        <Stat label="Debits" value={money(data?.totals?.debits ?? 0)} />
        <Stat label="Credits" value={money(data?.totals?.credits ?? 0)} />
        <Stat label="Balance" value={money(data?.totals?.balance ?? 0)} accent />
      </section>
      <Table columns={itemCols} rows={data?.items ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No journal lines in this period.</p>} />
      <h3 className="nx-h3" style={{ marginTop: 20 }}>By account</h3>
      <Table columns={accCols} rows={data?.accounts ?? []} rowKey={(r) => String((r.glAccount as Record<string, unknown> | undefined)?.code ?? r.code)} empty={<p className="nx-muted">No accounts touched.</p>} />
    </>
  );
}

function CashFlow({ period }: { period: Period }) {
  const { data, loading, error, reload } = useResource<{
    openingBalance?: string; closingBalance?: string; netCashFlow?: string;
    categories?: Array<Record<string, unknown>>;
    totals?: { inflows?: string; outflows?: string };
  }>(() => api.get("/accounting/cash-flow", { params: periodParams(period) }), [period.from, period.to]);

  const cols: Column<Record<string, unknown>>[] = [
    { key: "source", header: "Category", render: (r) => String(r.source ?? "—") },
    { key: "in", header: "Inflows", numeric: true, render: (r) => money(r.inflows) },
    { key: "out", header: "Outflows", numeric: true, render: (r) => money(r.outflows) },
    { key: "net", header: "Net", numeric: true, render: (r) => money(r.net) },
  ];

  if (loading) return <LoadingRow text="Loading cash flow…" />;
  if (error) return <ErrorState title="Could not load the cash flow statement" detail={error} onRetry={reload} />;
  return (
    <>
      <section className="nx-metrics">
        <Stat label="Opening balance" value={money(data?.openingBalance ?? 0)} />
        <Stat label="Closing balance" value={money(data?.closingBalance ?? 0)} />
        <Stat label="Net cash flow" value={money(data?.netCashFlow ?? 0)} accent />
      </section>
      <Table columns={cols} rows={data?.categories ?? []} rowKey={(r) => String(r.source)} empty={<p className="nx-muted">No cash categories in this period.</p>} />
    </>
  );
}

function AccountList({ rows, totalLabel, total }: { rows: Array<Record<string, unknown>>; totalLabel: string; total: string }) {
  const cols: Column<Record<string, unknown>>[] = [
    { key: "code", header: "Code", render: (r) => String(r.code ?? "—") },
    { key: "name", header: "Account", render: (r) => String(r.name ?? "—") },
    { key: "amount", header: "Amount", numeric: true, render: (r) => money(r.amount) },
  ];
  return (
    <>
      <p className="nx-muted"><strong>{totalLabel}:</strong> {money(total)}</p>
      <Table columns={cols} rows={rows} rowKey={(r) => String(r.code)} empty={<p className="nx-muted">No accounts in this section.</p>} />
    </>
  );
}

function IncomeStatement({ period }: { period: Period }) {
  const { data, loading, error, reload } = useResource<{
    income?: Array<Record<string, unknown>>; expenses?: Array<Record<string, unknown>>;
    totalIncome?: string; totalExpenses?: string; netSurplus?: string;
  }>(() => api.get("/accounting/income-statement", { params: periodParams(period) }), [period.from, period.to]);

  if (loading) return <LoadingRow text="Loading income statement…" />;
  if (error) return <ErrorState title="Could not load the income statement" detail={error} onRetry={reload} />;
  return (
    <>
      <section className="nx-metrics">
        <Stat label="Income" value={money(data?.totalIncome ?? 0)} />
        <Stat label="Expenses" value={money(data?.totalExpenses ?? 0)} />
        <Stat label="Net surplus" value={money(data?.netSurplus ?? 0)} accent />
      </section>
      <h3 className="nx-h3">Income</h3>
      <AccountList rows={data?.income ?? []} totalLabel="Total income" total={data?.totalIncome ?? "0"} />
      <h3 className="nx-h3">Expenses</h3>
      <AccountList rows={data?.expenses ?? []} totalLabel="Total expenses" total={data?.totalExpenses ?? "0"} />
    </>
  );
}

function FinancialPosition({ period }: { period: Period }) {
  const { data, loading, error, reload } = useResource<{
    assets?: Array<Record<string, unknown>>; liabilities?: Array<Record<string, unknown>>; equity?: Array<Record<string, unknown>>;
    totalAssets?: string; totalLiabilities?: string; totalEquity?: string; retainedEarnings?: string; asAt?: string | null;
  }>(() => api.get("/accounting/financial-position", { params: new URLSearchParams({ to: period.to }) }), [period.to]);

  if (loading) return <LoadingRow text="Loading financial position…" />;
  if (error) return <ErrorState title="Could not load the financial position" detail={error} onRetry={reload} />;
  return (
    <>
      <section className="nx-metrics">
        <Stat label="Total assets" value={money(data?.totalAssets ?? 0)} hint={`as at ${String(data?.asAt ?? "")}`} />
        <Stat label="Total liabilities" value={money(data?.totalLiabilities ?? 0)} />
        <Stat label="Total equity" value={money(data?.totalEquity ?? 0)} hint={`retained earnings ${money(data?.retainedEarnings ?? 0)}`} accent />
      </section>
      <div className="nx-grid nx-grid--2">
        <div>
          <h3 className="nx-h3">Assets</h3>
          <AccountList rows={data?.assets ?? []} totalLabel="Total assets" total={data?.totalAssets ?? "0"} />
        </div>
        <div>
          <h3 className="nx-h3">Liabilities</h3>
          <AccountList rows={data?.liabilities ?? []} totalLabel="Total liabilities" total={data?.totalLiabilities ?? "0"} />
          <h3 className="nx-h3">Equity</h3>
          <AccountList rows={data?.equity ?? []} totalLabel="Total equity" total={data?.totalEquity ?? "0"} />
        </div>
      </div>
    </>
  );
}