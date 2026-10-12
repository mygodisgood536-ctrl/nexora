import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconCpu,
  IconTrend,
  LoadingRow,
  PageHeader,
  Stat,
  SummaryGrid,
  StatusBadge,
  Table,
  formatDate,
  type Column
} from "@nexora/ui";
import { api, itemsOf, type Json } from "../lib/api";

interface CompanyRow extends Json {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  lastActivityAt: string | null;
  branches: number;
  workers: number;
}

interface Insight {
  id: string;
  title: string;
  body: string;
  tone: "success" | "warning" | "danger" | "neutral";
}

/**
 * RULE 3.18 - AI platform insights. The signals are computed from real
 * platform state with deterministic rules; the generative layer is only used
 * when an OpenCode gateway is actually configured, so the page stays honest
 * when it is absent (RULE 9.8.1 / 21.x).
 */
export function AiInsightsPage() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [freeModels, setFreeModels] = useState<Json[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, m] = await Promise.all([
        api<unknown>("/companies?limit=200"),
        api<unknown>("/ai/free-models").catch(() => [] as unknown)
      ]);
      setCompanies(itemsOf<CompanyRow>(c));
      setFreeModels(itemsOf<Json>(m));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const insights: Insight[] = [];
  const stalled = companies.filter((c) => c.status === "in_setup");
  const dormant = companies.filter((c) => c.status === "active" && c.lastActivityAt && Date.now() - new Date(c.lastActivityAt).getTime() > 30 * 24 * 3600 * 1000);
  const noBranches = companies.filter((c) => c.status === "active" && c.branches === 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const newThisMonth = companies.filter((c) => new Date(c.createdAt) >= monthStart);

  if (stalled.length > 0) {
    insights.push({
      id: "stalled",
      title: `${stalled.length} compan${stalled.length === 1 ? "y is" : "ies are"} stalled in setup`,
      body: `Drafts such as ${stalled.slice(0, 3).map((c) => c.name).join(", ")} were never completed. They cannot sign in until activated - resume the wizard or discard them.`,
      tone: "warning"
    });
  }
  if (dormant.length > 0) {
    insights.push({
      id: "dormant",
      title: `${dormant.length} active compan${dormant.length === 1 ? "y has" : "ies have"} no activity for 30+ days`,
      body: `${dormant.slice(0, 3).map((c) => c.name).join(", ")} are live but idle. Consider checking whether onboarding finished on their side.`,
      tone: "neutral"
    });
  }
  if (noBranches.length > 0) {
    insights.push({
      id: "branches",
      title: `${noBranches.length} active compan${noBranches.length === 1 ? "y has" : "ies have"} no branches`,
      body: `${noBranches.slice(0, 3).map((c) => c.name).join(", ")} are running company-wide without a branch workplace yet.`,
      tone: "warning"
    });
  }
  insights.push({
    id: "growth",
    title: `${newThisMonth.length} new compan${newThisMonth.length === 1 ? "y" : "ies"} this month`,
    body: companies.length === 0
      ? "The platform is empty - the first company created will start the trend line."
      : `Total portfolio is ${companies.length} companies. Growth is measured from real creation timestamps only.`,
    tone: companies.length === 0 ? "neutral" : "success"
  });
  if (freeModels.length === 0) {
    insights.push({
      id: "gateway",
      title: "No AI gateway reachable",
      body: "Free-model discovery needs the OpenCode runtime installed. In production, configure the gateway and select a provider per tenant from any company's AI configuration tab.",
      tone: "neutral"
    });
  }

  const topColumns: Column<CompanyRow>[] = [
    { key: "name", header: "Company", render: (r) => <strong>{r.name}</strong> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "branches", header: "Branches", numeric: true, render: (r) => <span className="nx-num">{r.branches}</span> },
    { key: "workers", header: "Workers", numeric: true, render: (r) => <span className="nx-num">{r.workers}</span> },
    { key: "created", header: "Created", hideBelow: "760px", render: (r) => formatDate(r.createdAt) }
  ];

  if (loading) return <LoadingRow text="Computing platform insights…" />;
  if (error) return <ErrorState title="Insights could not load" detail={error} onRetry={() => void load()} />;

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="AI platform insights"
        description="Deterministic signals over real platform state - stalled drafts, dormant tenants, footprint gaps and growth. Generated commentary is only added when an AI gateway is genuinely configured."
        actions={<Button onClick={() => void load()}>Recompute</Button>}
      />

      <SummaryGrid>
        <Stat label="Signals" value={insights.length} accent icon={<IconTrend size={14} />} />
        <Stat label="Stalled in setup" value={stalled.length} hint="cannot sign in yet" />
        <Stat label="Dormant 30+ days" value={dormant.length} hint="active but idle" />
        <Stat label="New this month" value={newThisMonth.length} icon={<IconTrend size={14} />} />
      </SummaryGrid>

      <div className="nx-grid nx-grid--2">
        {insights.map((ins) => (
          <Card key={ins.id}>
            <div className="nx-stack nx-stack--sm">
              <div className="nx-row" style={{ gap: 10 }}>
                <Badge tone={ins.tone} dot>{ins.tone === "warning" ? "review" : ins.tone === "success" ? "positive" : ins.tone === "danger" ? "action" : "note"}</Badge>
                <strong>{ins.title}</strong>
              </div>
              <p className="nx-muted" style={{ fontSize: "var(--nx-text-sm)" }}>{ins.body}</p>
            </div>
          </Card>
        ))}
        <Card>
          <div className="nx-stack nx-stack--sm">
            <div className="nx-row" style={{ gap: 10 }}>
              <IconCpu size={16} />
              <strong>Generative layer</strong>
            </div>
            <p className="nx-muted" style={{ fontSize: "var(--nx-text-sm)" }}>
              {freeModels.length > 0
                ? `${freeModels.length} free models are reachable through the configured gateway.`
                : "No OpenCode gateway is reachable in this environment, so no model is offered and none is simulated."}
            </p>
            <Button size="sm" onClick={() => navigate("/configuration")}>See configuration boundary</Button>
          </div>
        </Card>
      </div>

      <Card title="Portfolio context" padded={false}>
        {companies.length === 0 ? (
          <EmptyState title="No companies yet" text="Insights are computed only from real state - create a company to populate this page." action={<Button variant="primary" onClick={() => navigate("/companies/new")}>Create company</Button>} />
        ) : (
          <Table columns={topColumns} rows={[...companies].sort((a, b) => b.workers - a.workers).slice(0, 8)} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/companies/${r.id}`)} />
        )}
      </Card>
    </div>
  );
}
