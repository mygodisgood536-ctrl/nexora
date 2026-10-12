import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  IconUsers,
  LoadingRow,
  PageHeader,
  Stat,
  StatusBadge,
  SummaryGrid,
  Table,
  formatDate,
  type Column
} from "@nexora/ui";
import { api, type Json } from "../lib/api";

interface CompanyRow extends Json {
  id: string;
  name: string;
  status: string;
  planTier: string | null;
  createdAt: string;
  branches: number;
  workers: number;
  rolesEnabled: number;
}

/**
 * RULE 3.10 - platform users and usage. Aggregate structural counts only;
 * worker identities inside a tenant are reachable solely through a
 * time-bound support session (RULE 3.7.2).
 */
export function UsagePage() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await api<{ items: CompanyRow[] }>("/companies?limit=200");
      setRows(page.items ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = {
    companies: rows.length,
    workers: rows.reduce((n, r) => n + (Number(r.workers) || 0), 0),
    branches: rows.reduce((n, r) => n + (Number(r.branches) || 0), 0),
    roles: rows.reduce((n, r) => n + (Number(r.rolesEnabled) || 0), 0),
    plans: rows.reduce<Record<string, number>>((acc, r) => {
      const k = r.planTier ?? "standard";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {})
  };

  const byWorkers = [...rows].sort((a, b) => (b.workers ?? 0) - (a.workers ?? 0)).slice(0, 10);

  const columns: Column<CompanyRow>[] = [
    { key: "name", header: "Company", render: (r) => <strong>{r.name}</strong> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "plan", header: "Plan", hideBelow: "760px", render: (r) => <Badge tone="neutral">{r.planTier ?? "standard"}</Badge> },
    { key: "branches", header: "Branches", numeric: true, render: (r) => <span className="nx-num">{r.branches}</span> },
    { key: "workers", header: "Workers", numeric: true, render: (r) => <span className="nx-num">{r.workers}</span> },
    { key: "roles", header: "Roles", numeric: true, hideBelow: "760px", render: (r) => <span className="nx-num">{r.rolesEnabled}</span> },
    { key: "created", header: "Created", hideBelow: "1000px", render: (r) => formatDate(r.createdAt) }
  ];

  if (loading) return <LoadingRow text="Loading usage…" />;
  if (error) return <ErrorState title="Usage could not load" detail={error} onRetry={() => void load()} />;

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Platform users and usage"
        description="Whole-platform structural totals: companies, branches, workers and enabled roles. No individual person is identified here (RULE 3.6.2 / 3.7.2)."
      />

      <SummaryGrid>
        <Stat label="Companies" value={totals.companies} icon={<IconUsers size={14} />} />
        <Stat label="Workers provisioned" value={totals.workers} accent icon={<IconUsers size={14} />} />
        <Stat label="Branches" value={totals.branches} />
        <Stat label="Enabled role slots" value={totals.roles} hint="company x role combinations" />
      </SummaryGrid>

      <div className="nx-grid nx-grid--2">
        <Card title="Plan distribution">
          {Object.keys(totals.plans).length === 0 ? (
            <EmptyState title="No companies yet" text="Plan counts appear once companies exist." />
          ) : (
            <div className="nx-stack nx-stack--sm">
              {Object.entries(totals.plans).map(([plan, n]) => (
                <div key={plan} className="nx-row nx-row--between" style={{ fontSize: "var(--nx-text-sm)" }}>
                  <Badge tone="neutral">{plan}</Badge>
                  <strong className="nx-num">{n} companies</strong>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="By oldest company">
          {[...rows]
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .slice(0, 5)
            .map((r) => (
              <div key={r.id} className="nx-row nx-row--between" style={{ fontSize: "var(--nx-text-sm)", padding: "6px 0" }}>
                <span>{r.name}</span>
                <span className="nx-faint">{formatDate(r.createdAt)}</span>
              </div>
            ))}
        </Card>
      </div>

      <Card title="Highest usage (workers per company)" padded={false}>
        {byWorkers.length === 0 ? (
          <EmptyState title="Nothing to show yet" text="Usage totals appear as soon as companies provision workers." />
        ) : (
          <Table columns={columns} rows={byWorkers} rowKey={(r) => r.id} />
        )}
      </Card>
    </div>
  );
}
