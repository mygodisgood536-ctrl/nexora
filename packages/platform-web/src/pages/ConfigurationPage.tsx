import { useEffect, useState } from "react";
import {
  Badge,
  Card,
  EmptyState,
  IconKey,
  IconLayers,
  IconProvider,
  LoadingRow,
  ErrorState,
  PageHeader,
  Table,
  type Column
} from "@nexora/ui";
import { BUILT_IN_ROLES, CUSTOM_ROLE_TEMPLATES, ROLE_CATEGORIES, roleWorldFor } from "@nexora/shared";
import { api, itemsOf, type Json } from "../lib/api";

/**
 * RULE 3.17 - platform configuration: the fixed references the Platform Owner
 * governs. Company-specific configuration (webhooks, payment providers,
 * retention) lives inside each tenant, so this page states that boundary
 * instead of pretending to edit it.
 */
export function ConfigurationPage() {
  const [providers, setProviders] = useState<Json[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setProviders(itemsOf<Json>(await api("/ai/providers")));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const roleColumns: Column<{ key: string; name: string; category: string }>[] = [
    { key: "name", header: "Role", render: (r) => <strong>{r.name}</strong> },
    { key: "key", header: "Key", render: (r) => <code style={{ fontSize: "0.78rem" }}>{r.key}</code> },
    {
      key: "category",
      header: "Category",
      hideBelow: "760px",
      render: (r) => ROLE_CATEGORIES.find((c) => c.key === r.category)?.label ?? r.category
    },
    {
      key: "world",
      header: "World",
      render: (r) => <Badge tone={roleWorldFor(r.key) === "branch" ? "accent" : "neutral"}>{roleWorldFor(r.key) === "branch" ? "branch" : "head office"}</Badge>
    }
  ];

  const catalogue = [
    ...BUILT_IN_ROLES.map((r) => ({ ...r, kind: "built-in" })),
    ...CUSTOM_ROLE_TEMPLATES.map((r) => ({ ...r, kind: "template" }))
  ];

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Platform configuration"
        description="The fixed platform references: the role catalogue ceiling, the AI provider list and the boundary of what this console configures."
      />

      <div className="nx-grid nx-grid--2">
        <Card title="Boundaries">
          <div className="nx-stack nx-stack--sm" style={{ fontSize: "var(--nx-text-sm)" }}>
            <div className="nx-row" style={{ gap: 8 }}><IconLayers size={15} /><span><strong>Configured here:</strong> role catalogue, branding law, global settings, AI provider choice per tenant.</span></div>
            <div className="nx-row" style={{ gap: 8 }}><IconKey size={15} /><span><strong>Configured in each company:</strong> payment providers, webhook endpoints, approval chains, retention.</span></div>
            <div className="nx-row" style={{ gap: 8 }}><IconProvider size={15} /><span><strong>Operational in production:</strong> PostgreSQL, background workers, the OpenCode AI gateway.</span></div>
            <p className="nx-faint" style={{ fontSize: "var(--nx-text-xs)", marginTop: 6 }}>
              This console never reaches into a tenant's financial configuration - that authority
              belongs to the company's own roles (RULE 1.5 / 5.5).
            </p>
          </div>
        </Card>

        <Card title="AI providers visible to the platform">
          {loading ? (
            <LoadingRow text="Loading providers…" />
          ) : error ? (
            <ErrorState title="Providers unavailable" detail={error} />
          ) : providers.length === 0 ? (
            <EmptyState
              icon={<IconProvider size={24} />}
              title="No AI providers reachable"
              text="The OpenCode runtime is not installed in this environment, so no providers are reported. Nothing is faked (RULE 9.8.1)."
            />
          ) : (
            <div className="nx-stack nx-stack--sm">
              {providers.map((p) => (
                <div key={String(p.id ?? p.name)} className="nx-row nx-row--between" style={{ borderBottom: "1px solid var(--nx-border)", paddingBottom: 8 }}>
                  <strong>{String(p.name ?? p.id)}</strong>
                  <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{String(p.id ?? "")}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title={`Role catalogue ceiling - ${catalogue.length} entries`} padded={false}>
        <div className="nx-contextbar">
          <span className="nx-muted" style={{ fontSize: "var(--nx-text-sm)" }}>
            Every company can enable at most these roles; tenants cannot invent new platform keys.
          </span>
          <div className="nx-grow" />
          <Badge tone="accent" dot>{BUILT_IN_ROLES.length} built-in</Badge>
          <Badge tone="neutral">{CUSTOM_ROLE_TEMPLATES.length} templates</Badge>
        </div>
        <Table columns={roleColumns} rows={catalogue} rowKey={(r) => r.key} />
      </Card>
    </div>
  );
}
