import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconBell,
  LoadingRow,
  PageHeader,
  StatusBadge,
  Timeline,
  formatDateTime
} from "@nexora/ui";
import { api, itemsOf, type Json } from "../lib/api";

interface AttentionItem {
  id: string;
  title: string;
  meta?: string;
  body?: string;
  tone: "success" | "warning" | "danger" | "neutral";
}

/**
 * RULE 3.7.3 - the attention queue: suspended tenants, stalled drafts, open
 * support sessions, active announcements and fresh audit events, ranked and
 * phrased in words before any badge.
 */
export function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [companies, drafts, sessions, announcements, audit] = await Promise.all([
        api<unknown>("/companies?limit=200"),
        api<unknown>("/companies/drafts"),
        api<unknown>("/support-access"),
        api<unknown>("/announcements"),
        api<unknown>("/audit?limit=20")
      ]);
      const companyRows = itemsOf<Json>(companies);
      const draftRows = itemsOf<Json>(drafts);
      const sessionRows = itemsOf<Json>(sessions);
      const announcementRows = itemsOf<Json>(announcements);
      const auditRows = itemsOf<Json>(audit);
      const queue: AttentionItem[] = [];

      for (const c of companyRows.filter((r) => r.status === "suspended")) {
        queue.push({
          id: `suspended-${String(c.id)}`,
          title: `${String(c.name)} is suspended`,
          meta: "sessions are invalidated",
          body: "Reactivate it from the company detail page when the issue is resolved.",
          tone: "danger"
        });
      }
      for (const d of draftRows) {
        queue.push({
          id: `draft-${String(d.id)}`,
          title: `${String(d.name ?? "Untitled draft")} is still in setup`,
          meta: "draft waiting",
          body: "Resume the wizard to complete and activate the tenant.",
          tone: "warning"
        });
      }
      for (const s of sessionRows.filter((r) => r.is_open === true)) {
        queue.push({
          id: `session-${String(s.id)}`,
          title: `Support access open for ${String(s.company_name ?? s.company_id)}`,
          meta: `expires ${s.expires_at ? formatDateTime(String(s.expires_at)) : "soon"}`,
          body: String(s.reason ?? ""),
          tone: "warning"
        });
      }
      for (const a of announcementRows.filter((r) => r.status === "active")) {
        queue.push({
          id: `announcement-${String(a.id)}`,
          title: String(a.title ?? "Announcement"),
          meta: `published - ${String(a.severity ?? "info")}`,
          body: String(a.body ?? "").slice(0, 160),
          tone: a.severity === "critical" ? "danger" : a.severity === "warning" ? "warning" : "neutral"
        });
      }
      for (const r of auditRows.slice(0, 8)) {
        queue.push({
          id: `audit-${String(r.id ?? r.created_at)}`,
          title: String(r.action ?? "platform event"),
          meta: r.created_at ? formatDateTime(String(r.created_at)) : undefined,
          body: `${String(r.entity ?? "platform")}${r.actor_email ? ` - ${String(r.actor_email)}` : ""}`,
          tone: "neutral"
        });
      }

      setItems(queue);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Notifications"
        description="The attention queue: what needs the Platform Owner's decision, newest first, phrased in words before colour (RULE 3.7.3 / 13.5.3)."
        actions={<Button onClick={() => void load()} disabled={loading}>Refresh</Button>}
      />

      {loading && <LoadingRow text="Assembling the attention queue…" />}
      {error && <ErrorState title="Notifications could not load" detail={error} onRetry={() => void load()} />}

      {!loading && !error && items.length === 0 && (
        <Card>
          <EmptyState
            icon={<IconBell size={26} />}
            title="Nothing needs your attention"
            text="Suspended tenants, stalled drafts, open support sessions and announcements all surface here the moment they appear."
            action={<Button variant="primary" onClick={() => navigate("/companies/new")}>Create a company</Button>}
          />
        </Card>
      )}

      {!loading && !error && items.length > 0 && (
        <Card title={`${items.length} items in the queue`} padded={false}>
          <div style={{ padding: 20 }}>
            <Timeline
              items={items.map((it) => ({
                id: it.id,
                title: (
                  <span className="nx-row" style={{ gap: 10 }}>
                    <strong>{it.title}</strong>
                    <Badge tone={it.tone} dot>{it.tone === "danger" ? "action needed" : it.tone === "warning" ? "review" : "info"}</Badge>
                  </span>
                ),
                meta: it.meta,
                body: it.body
              }))}
            />
          </div>
        </Card>
      )}

      <div className="nx-grid nx-grid--3">
        <Card title="Suspended tenants" padded>
          <StatusBadge status="suspended" label="locked out" />
          <p className="nx-muted" style={{ fontSize: "var(--nx-text-sm)", marginTop: 8 }}>
            Manage under Companies - suspension ends all sessions at once.
          </p>
        </Card>
        <Card title="Drafts in setup">
          <StatusBadge status="in_setup" label="cannot sign in" />
          <p className="nx-muted" style={{ fontSize: "var(--nx-text-sm)", marginTop: 8 }}>
            Resume from the Drafts page in one click.
          </p>
        </Card>
        <Card title="Support access">
          <StatusBadge status="open" label="time-bound sessions" />
          <p className="nx-muted" style={{ fontSize: "var(--nx-text-sm)", marginTop: 8 }}>
            Every open session is listed and closable under Support access.
          </p>
        </Card>
      </div>
    </div>
  );
}
