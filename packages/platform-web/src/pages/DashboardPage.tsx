import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconBuilding,
  IconPlus,
  LoadingRow,
  PageHeader,
  Stat,
  SummaryGrid,
  StatusBadge,
  Table,
  formatDateTime,
  formatRelative,
  type Column
} from "@nexora/ui";
import { api, itemsOf, type Json } from "../lib/api";

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  planTier?: string | null;
  createdAt?: string;
  branches?: number;
  workers?: number;
}

export function DashboardPage() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [audit, setAudit] = useState<Json[]>([]);
  const [announcements, setAnnouncements] = useState<Json[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, a, an] = await Promise.all([
        api<unknown>("/companies?limit=200"),
        api<unknown>("/audit?limit=25"),
        api<unknown>("/announcements")
      ]);
      setCompanies(itemsOf<CompanyRow>(c));
      setAudit(itemsOf<Json>(a));
      setAnnouncements(itemsOf<Json>(an));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const active = companies.filter((c) => c.status === "active").length;
    const suspended = companies.filter((c) => c.status === "suspended").length;
    const inSetup = companies.filter((c) => c.status === "in_setup").length;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const newThisMonth = companies.filter((c) => c.createdAt && new Date(c.createdAt) >= monthStart).length;
    const branches = companies.reduce((n, c) => n + (Number(c.branches) || 0), 0);
    const workers = companies.reduce((n, c) => n + (Number(c.workers) || 0), 0);
    return { active, suspended, inSetup, newThisMonth, branches, workers, total: companies.length };
  }, [companies]);

  const growth = useMemo(() => {
    const buckets: Array<{ label: string; count: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleDateString("en-GB", { month: "short" });
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      buckets.push({
        label,
        count: companies.filter((c) => {
          if (!c.createdAt) return false;
          const at = new Date(c.createdAt);
          return at >= start && at < end;
        }).length
      });
    }
    return buckets;
  }, [companies]);
  const maxGrowth = Math.max(1, ...growth.map((g) => g.count));

  const liveAnnouncements = announcements.filter((a) => a.status === "active" || a.status === "published");

  const activityColumns: Column<Json>[] = [
    {
      key: "action",
      header: "Event",
      render: (r) => <strong style={{ fontSize: "var(--nx-text-sm)" }}>{String(r.action ?? r.event ?? "activity")}</strong>
    },
    {
      key: "company",
      header: "Company",
      render: (r) => (r.company_name ?? r.companyName ?? r.company_id ? String(r.company_name ?? r.companyName ?? r.company_id) : <span className="nx-faint">platform</span>)
    },
    {
      key: "at",
      header: "When",
      render: (r) => {
        const at = (r.created_at ?? r.createdAt ?? r.timestamp) as string | undefined;
        return <span title={at ? formatDateTime(at) : undefined}>{at ? formatRelative(at) : "—"}</span>;
      }
    }
  ];

  if (loading) return <LoadingRow text="Loading platform dashboard…" />;
  if (error) return <ErrorState title="Dashboard could not load" detail={error} onRetry={() => void load()} />;

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Dashboard"
        description="Platform KPIs, status breakdown, growth and the live activity feed. Everything on this page is aggregate or structural - never a company's financial records (RULE 3.6.2)."
        actions={
          <>
            <Button icon={<IconPlus size={15} />} variant="primary" onClick={() => navigate("/companies/new")}>
              Create company
            </Button>
            <Button onClick={() => navigate("/companies")}>Companies workspace</Button>
          </>
        }
      />

      {liveAnnouncements.length > 0 && (
        <Card padded={false}>
          <div className="nx-contextbar">
            <Badge tone="accent">Announcement</Badge>
            <strong>{String(liveAnnouncements[0]?.title ?? "")}</strong>
            <span className="nx-muted nx-hide-mobile">{String(liveAnnouncements[0]?.body ?? "")}</span>
            <div className="nx-grow" />
            <Button size="sm" onClick={() => navigate("/announcements")}>Open announcements</Button>
          </div>
        </Card>
      )}

      <SummaryGrid>
        <Stat label="Companies" value={stats.total} hint={`${stats.newThisMonth} new this month`} icon={<IconBuilding size={14} />} />
        <Stat label="Active" value={stats.active} hint="live and able to sign in" accent />
        <Stat label="In setup" value={stats.inSetup} hint="drafts awaiting completion" />
        <Stat label="Suspended" value={stats.suspended} hint="sessions invalidated" />
      </SummaryGrid>

      <div className="nx-grid nx-grid--2">
        <Card title="Growth - new companies by month" headId="growth-title">
          <div className="nxp-chart" role="img" aria-label="New companies per month for the last six months">
            {growth.map((g, i) => (
              <div
                key={g.label}
                className={cxBar(i === growth.length - 1)}
                style={{ height: `${Math.max(6, (g.count / maxGrowth) * 100)}%` }}
                title={`${g.label}: ${g.count}`}
              >
                <span className="nxp-chart__label">{g.label}</span>
              </div>
            ))}
          </div>
          <div className="nx-row" style={{ marginTop: 26, gap: 16, fontSize: "var(--nx-text-xs)", color: "var(--nx-text-muted)" }}>
            <span className="nx-row" style={{ gap: 6 }}><span className="nx-dot" style={{ background: "var(--nx-color-accent)" }} /> latest month</span>
            <span className="nx-row" style={{ gap: 6 }}><span className="nx-dot" style={{ background: "var(--nx-chart-2)" }} /> earlier months</span>
          </div>
        </Card>

        <Card title="Status breakdown" headId="status-title">
          <div className="nx-stack">
            {[
              { label: "Active", value: stats.active, tone: "success" as const },
              { label: "In setup", value: stats.inSetup, tone: "warning" as const },
              { label: "Suspended", value: stats.suspended, tone: "danger" as const },
              { label: "Other", value: Math.max(0, stats.total - stats.active - stats.inSetup - stats.suspended), tone: "neutral" as const }
            ].map((row) => {
              const pct = stats.total ? (row.value / stats.total) * 100 : 0;
              return (
                <div key={row.label} className="nx-stack nx-stack--sm">
                  <div className="nx-row nx-row--between" style={{ fontSize: "var(--nx-text-sm)" }}>
                    <span className="nx-row" style={{ gap: 8 }}>
                      <Badge tone={row.tone} dot>{row.label}</Badge>
                    </span>
                    <strong className="nx-num">{row.value} ({pct.toFixed(0)}%)</strong>
                  </div>
                  <div className="nx-progress">
                    <div
                      className="nx-progress__bar"
                      style={{ width: `${pct}%`, background: row.tone === "success" ? "var(--nx-success)" : row.tone === "warning" ? "var(--nx-warning)" : row.tone === "danger" ? "var(--nx-danger)" : "var(--nx-chart-2)" }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="nx-row" style={{ gap: 16, marginTop: 6, fontSize: "var(--nx-text-sm)" }}>
              <span className="nx-muted">Branches provisioned: <strong className="nx-num">{stats.branches}</strong></span>
              <span className="nx-muted">Workers: <strong className="nx-num">{stats.workers}</strong></span>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Platform activity"
        padded={false}
        actions={<Button size="sm" onClick={() => navigate("/activity")}>Open activity</Button>}
      >
        {audit.length === 0 ? (
          <EmptyState title="No platform events yet" text="Actions such as company creation, suspensions and support sessions appear here the moment they happen." />
        ) : (
          <Table
            columns={activityColumns}
            rows={audit.slice(0, 8)}
            rowKey={(r) => String(r.id ?? `${String(r.action ?? "event")}-${String(r.created_at ?? r.createdAt ?? "")}`)}
            onRowClick={() => navigate("/activity")}
          />
        )}
      </Card>

      <div className="nx-grid nx-grid--3">
        <Card title="Quick actions">
          <div className="nx-stack nx-stack--sm">
            <Button block variant="primary" icon={<IconPlus size={15} />} onClick={() => navigate("/companies/new")}>Create company</Button>
            <Button block onClick={() => navigate("/drafts")}>Resume a draft</Button>
            <Button block onClick={() => navigate("/support")}>Open support access</Button>
            <Button block onClick={() => navigate("/announcements")}>Publish announcement</Button>
          </div>
        </Card>
        <Card title="Portfolio at a glance">
          <div className="nx-stack nx-stack--sm" style={{ fontSize: "var(--nx-text-md)" }}>
            <div className="nx-row nx-row--between"><span className="nx-muted">Companies total</span><strong className="nx-num">{stats.total}</strong></div>
            <div className="nx-row nx-row--between"><span className="nx-muted">Branches</span><strong className="nx-num">{stats.branches}</strong></div>
            <div className="nx-row nx-row--between"><span className="nx-muted">Workers</span><strong className="nx-num">{stats.workers}</strong></div>
            <div className="nx-row nx-row--between"><span className="nx-muted">New this month</span><strong className="nx-num">{stats.newThisMonth}</strong></div>
          </div>
        </Card>
        <Card title="Attention queue">
          <div className="nx-stack nx-stack--sm">
            <div className="nx-row nx-row--between">
              <span className="nx-muted">Stalled in setup</span>
              <StatusBadge status={stats.inSetup > 0 ? "attention" : "clear"} label={`${stats.inSetup} companies`} />
            </div>
            <div className="nx-row nx-row--between">
              <span className="nx-muted">Suspended tenants</span>
              <StatusBadge status={stats.suspended > 0 ? "attention" : "clear"} label={`${stats.suspended} companies`} />
            </div>
            <Button block size="sm" onClick={() => navigate("/notifications")}>Open notifications</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function cxBar(lead: boolean): string {
  return lead ? "nxp-chart__bar is-lead" : "nxp-chart__bar";
}
