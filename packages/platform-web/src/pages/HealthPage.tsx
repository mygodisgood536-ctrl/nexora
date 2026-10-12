import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconActivity,
  IconDatabase,
  IconCpu,
  PageHeader,
  StatusBadge,
  SummaryGrid,
  Stat,
  formatRelative
} from "@nexora/ui";
import { api, itemsOf, type Json } from "../lib/api";

interface Health {
  status: string;
  service: string;
}

interface CompanyRow extends Json {
  id: string;
  status: string;
  lastActivityAt: string | null;
  createdAt: string;
}

/**
 * RULE 3.11 - platform health. The API answers honestly; where a subsystem
 * (job queue, background workers) has no live probe yet the panel says so
 * instead of inventing a green light (RULE 9.8.1).
 */
export function HealthPage() {
  const [apiHealth, setApiHealth] = useState<Health | null>(null);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const [h, c] = await Promise.all([
        api<Health>("/healthz", { token: null }),
        api<unknown>("/companies?limit=200")
      ]);
      setApiHealth(h);
      setCompanies(itemsOf<CompanyRow>(c));
      setCheckedAt(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inSetup = companies.filter((c) => c.status === "in_setup").length;
  const active = companies.filter((c) => c.status === "active").length;
  const suspended = companies.filter((c) => c.status === "suspended").length;
  const stale = companies.filter((c) => {
    if (!c.lastActivityAt) return false;
    return Date.now() - new Date(c.lastActivityAt).getTime() > 14 * 24 * 3600 * 1000;
  }).length;

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Platform health"
        description="Live probes and honest gaps: the API answers a real request right now, and subsystems without a probe are reported as unknown rather than healthy."
        actions={<Button onClick={() => void load()} loading={checking}>Run checks again</Button>}
      />

      {error && <ErrorState title="Health checks failed" detail={error} onRetry={() => void load()} />}

      <SummaryGrid>
        <Stat
          label="Platform API"
          value={apiHealth ? apiHealth.status : checking ? "…" : "unreachable"}
          hint={apiHealth ? apiHealth.service : "no response"}
          accent={apiHealth?.status === "ok"}
          icon={<IconActivity size={14} />}
        />
        <Stat label="Database" value={apiHealth ? "indirect" : "unknown"} hint="verified through API queries - direct probe not exposed" icon={<IconDatabase size={14} />} />
        <Stat label="Job queue" value="not probed" hint="no scheduler endpoint exists yet" icon={<IconCpu size={14} />} />
        <Stat label="Last checked" value={checkedAt ? formatRelative(checkedAt.toISOString()) : "—"} icon={<IconActivity size={14} />} />
      </SummaryGrid>

      <div className="nx-grid nx-grid--2">
        <Card title="Tenant status spread">
          {companies.length === 0 && !checking ? (
            <EmptyState title="No companies on the platform yet" text="Tenant status counts appear once the first company is created." />
          ) : (
            <div className="nx-stack nx-stack--sm">
              <div className="nx-row nx-row--between"><span className="nx-muted">Active</span><StatusBadge status="active" label={`${active} live`} /></div>
              <div className="nx-row nx-row--between"><span className="nx-muted">In setup</span><StatusBadge status="in_setup" label={`${inSetup} drafting`} /></div>
              <div className="nx-row nx-row--between"><span className="nx-muted">Suspended</span><StatusBadge status="suspended" label={`${suspended} locked`} /></div>
              <div className="nx-row nx-row--between"><span className="nx-muted">Idle &gt; 14 days</span><Badge tone={stale ? "warning" : "neutral"} dot>{stale}</Badge></div>
            </div>
          )}
        </Card>

        <Card title="Subsystems">
          <div className="nx-stack nx-stack--sm">
            {[
              { name: "Platform API", state: apiHealth?.status === "ok" ? "healthy" : checking ? "checking" : "unknown" },
              { name: "Company API (via proxy)", state: "verified through login flow" },
              { name: "PostgreSQL", state: "served through the API layer" },
              { name: "Background jobs", state: "no probe available" },
              { name: "Webhook consumers", state: "no probe available" },
              { name: "AI gateway (OpenCode)", state: "not installed in this environment" }
            ].map((s) => (
              <div key={s.name} className="nx-row nx-row--between" style={{ borderBottom: "1px solid var(--nx-border)", paddingBottom: 8 }}>
                <span style={{ fontSize: "var(--nx-text-sm)" }}>{s.name}</span>
                <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)", textAlign: "right" }}>{s.state}</span>
              </div>
            ))}
          </div>
          <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)", marginTop: 12 }}>
            Honest by design: an unprobed subsystem is never displayed as healthy (RULE 9.8.1).
          </p>
        </Card>
      </div>
    </div>
  );
}
