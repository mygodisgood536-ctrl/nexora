import { Crumbs } from "./parts";
import { useMemo } from "react";
import { Stat, PageHeader } from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { workspaceFor } from "../workspaces/descriptors";
import { api } from "../lib/api";
import { moneyLabel, whole, pct } from "../lib/format";
import { useResource } from "../lib/useResource";
import type { ReactNode } from "react";

interface BlockValue {
  label: string;
  value: string;
  hint?: string;
}

interface Fetcher {
  fetch: () => Promise<BlockValue>;
}

const moneyOf = (v: unknown) => moneyLabel(v ?? 0);
const countOf = (n: unknown) => whole(n ?? 0);

function metricFetchers(): Record<string, Fetcher | undefined> {
  const reportSummary = () =>
    api.get<{ data: Record<string, unknown> }>("/reports/summary", { params: new URLSearchParams({ format: "json" }) });
  const perfSummary = () =>
    api.get<{ performance?: Record<string, unknown> }>("/performance/summary", { params: new URLSearchParams() });
  const listTotal = (path: string, params: Record<string, string> = {}) =>
    api
      .get<{ items?: unknown[]; total?: number }>(path, { params: new URLSearchParams(params) })
      .then((r) => countOf(r.total));

  return {
    portfolio: { fetch: () => reportSummary().then((r) => ({ label: "Portfolio outstanding", value: moneyOf(r.data?.outstanding) })) },
    collections_today: { fetch: () => perfSummary().then((r) => ({ label: "Collections today", value: moneyOf(r.performance?.actual) })) },
    pending_approvals: {
      fetch: () =>
        api
          .get<{ items?: unknown[] }>("/loan-applications/approvals/mine", { params: new URLSearchParams() })
          .then((r) => ({ label: "Pending approvals", value: countOf(r.items?.length), hint: "decisions awaiting you in your inbox" })),
    },
    branches: { fetch: () => listTotal("/branches", { limit: "200" }).then((t) => ({ label: "Branches", value: t })) },
    workers: { fetch: () => listTotal("/workers", { limit: "200" }).then((t) => ({ label: "Workers", value: t })) },
    customers: { fetch: () => listTotal("/customers", { limit: "1" }).then((t) => ({ label: "Customers", value: t })) },
    branch_performance: { fetch: () => perfSummary().then((r) => ({ label: "Branch collections", value: moneyOf(r.performance?.actual) })) },
    exceptions: {
      fetch: () => listTotal("/reconciliation-items", { status: "open", limit: "200" }).then((t) => ({ label: "Reconciliation exceptions", value: t, hint: "open matching items" })),
    },
    unallocated: { fetch: () => listTotal("/payments/unallocated", { limit: "1" }).then((t) => ({ label: "Unallocated", value: t })) },
    unmatched: { fetch: () => listTotal("/payments/unmatched", { limit: "1" }).then((t) => ({ label: "Unmatched", value: t })) },
    portfolio_at_risk: { fetch: () => reportSummary().then((r) => ({ label: "Portfolio at risk", value: moneyOf(r.data?.overdue) })) },
    trial_balance: {
      fetch: () =>
        api
          .get<{ totalDebits?: string | number; balanced?: boolean }>("/accounting/trial-balance", { params: new URLSearchParams() })
          .then((r) => ({ label: "Trial balance", value: moneyOf(r.totalDebits ?? 0), hint: r.balanced === false ? "not balanced" : "balanced" })),
    },
    cash_position: {
      fetch: () =>
        api
          .get<{ net?: string | number }>("/accounting/cash-book", { params: new URLSearchParams() })
          .then((r) => ({ label: "Cash position", value: moneyOf(r.net ?? 0) })),
    },
    audit_events: { fetch: () => listTotal("/audit", { limit: "1" }).then((t) => ({ label: "Audit events", value: t })) },
    providers: {
      fetch: () =>
        api
          .get<unknown[]>("/payment-providers/registry", { params: new URLSearchParams() })
          .then((r) => ({ label: "Provider registry", value: countOf(Array.isArray(r) ? r.length : 0) })),
    },
    escalations: {
      fetch: () =>
        api
          .get<{ escalations?: unknown[] }>("/overdue-escalation/escalations", { params: new URLSearchParams({ limit: "200" }) })
          .then((r) => ({ label: "Overdue escalations", value: countOf(r.escalations?.length) })),
    },
    alerts: {
      fetch: () =>
        api
          .get<{ alerts?: unknown[] }>("/collection-watch/alerts", { params: new URLSearchParams({ limit: "200" }) })
          .then((r) => ({ label: "Collection alerts", value: countOf(r.alerts?.length) })),
    },
    applications_pending: {
      fetch: () => listTotal("/loan-applications", { status: "in_review", limit: "1" }).then((t) => ({ label: "Applications in review", value: t })),
    },
    disbursed_month: {
      fetch: () => listTotal("/loan-applications", { status: "approved", limit: "1" }).then((t) => ({ label: "Approved applications", value: t })),
    },
    expected_today: { fetch: () => perfSummary().then((r) => ({ label: "Expected collections", value: moneyOf(r.performance?.expected) })) },
    collection_rate: { fetch: () => perfSummary().then((r) => ({ label: "Collection rate", value: pct(r.performance?.collectionRate) })) },
    savings: { fetch: () => perfSummary().then((r) => ({ label: "Savings", value: moneyOf(r.performance?.expectedSavings) })) },
    roles_enabled: {
      fetch: () =>
        api
          .get<unknown[]>("/roles", { params: new URLSearchParams() })
          .then((r) => ({ label: "Enabled roles", value: countOf(Array.isArray(r) ? r.length : 0) })),
    },
    users_active: { fetch: () => listTotal("/workers", { limit: "1" }).then((t) => ({ label: "Workers", value: t })) },
    assignments_open: {
      fetch: () => listTotal("/customer-assignments", { limit: "1" }).then((t) => ({ label: "Customer assignments", value: t })),
    },
    findings: { fetch: () => Promise.resolve({ label: "Internal findings", value: "—" }) },
    reports_available: { fetch: () => Promise.resolve({ label: "Report surfaces", value: "3", hint: "summary, branches, staff" }) },
  } as Record<string, Fetcher | undefined>;
}

function Block({ fetcher, label }: { fetcher: Fetcher; label: ReactNode }) {
  const { data, loading } = useResource<BlockValue>(() => fetcher.fetch(), []);
  if (loading) return <Stat label={label} value="…" />;
  if (!data) return <Stat label={label} value="—" />;
  return <Stat label={data.label} value={data.value} hint={data.hint} />;
}

export function DashboardPage() {
  const me = useMe();
  const ws = useMemo(() => workspaceFor(me.activeRoleKey), [me.activeRoleKey]);
  const fetchers = useMemo(() => metricFetchers(), []);

  return (
    <>
      <PageHeader
        title="Good day"
        description={ws.purpose}
        breadcrumbs={<Crumbs items={[{ label: "Home" }, { label: "Overview" }]} />}
      />
      {/* The reference's hairline grid: a line-coloured surface with 1px gaps
          reads as one composed block rather than a row of loose cards. */}
      <section className="nx-hairgrid nx-hairgrid--metrics">
        {ws.blocks.map((b) => {
          const f = fetchers[b.metric];
          if (!f) return <Stat key={b.metric} label={b.label} value={"—"} />;
          return <Block key={b.metric} fetcher={f} label={b.label} />;
        })}
      </section>
      <p className="nx-muted" style={{ marginTop: "var(--nx-space-4)", fontSize: "var(--nx-text-sm)" }}>
        Figures come from your role scopes in the live API; anything your roles cannot access reads “—”.
      </p>
    </>
  );
}