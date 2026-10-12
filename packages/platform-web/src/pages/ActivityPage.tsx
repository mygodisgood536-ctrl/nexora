import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingRow,
  PageHeader,
  SearchInput,
  Timeline,
  formatDateTime
} from "@nexora/ui";
import { api, itemsOf, type Json } from "../lib/api";

interface AuditRow extends Json {
  id?: string;
  action?: string;
  entity?: string;
  entity_id?: string;
  actor?: string;
  actor_email?: string;
  company_id?: string;
  created_at?: string;
}

/**
 * RULE 3.12 - platform activity as a chronological, words-first feed. The
 * tabular, exportable view of the same trail lives under Audit trail.
 */
export function ActivityPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(itemsOf<AuditRow>(await api("/audit?limit=120")));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) =>
        [r.action, r.entity, r.entity_id, r.actor, r.actor_email, r.company_id]
          .map((v) => String(v ?? "").toLowerCase())
          .some((v) => v.includes(q))
      )
    : rows;

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Platform activity"
        description="A chronological feed of every platform-level event, newest first. Events are append-only - nothing here can be edited away (RULE 3.7.1)."
        actions={<Button onClick={() => void load()} disabled={loading}>Refresh</Button>}
      />

      <Card padded={false}>
        <div className="nx-contextbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Filter the feed by action, actor or entity…" />
          <div className="nx-grow" />
          <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{filtered.length} events</span>
        </div>

        {loading ? (
          <LoadingRow text="Loading activity…" />
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState title="Activity could not load" detail={error} onRetry={() => void load()} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No matching events" text="Every platform action lands here the moment it is taken. Clear the filter to see the whole feed." />
        ) : (
          <div style={{ padding: 20 }}>
            <Timeline
              items={filtered.slice(0, 60).map((r, i) => ({
                id: String(r.id ?? `${r.action}-${r.created_at}-${i}`),
                title: (
                  <span className="nx-row" style={{ gap: 10 }}>
                    <strong>{String(r.action ?? "platform event")}</strong>
                    <Badge tone={r.entity === "companies" ? "accent" : "neutral"}>{String(r.entity ?? "platform")}</Badge>
                  </span>
                ),
                meta: (
                  <span className="nx-row" style={{ gap: 8 }}>
                    <span className="nx-faint">{String(r.actor_email ?? r.actor ?? "system")}</span>
                    {r.created_at && <span className="nx-faint">{formatDateTime(String(r.created_at))}</span>}
                    {r.company_id && <span className="nx-faint">company {String(r.company_id).slice(0, 8)}…</span>}
                  </span>
                ),
                body: r.entity_id ? <code style={{ fontSize: "0.72rem" }}>{String(r.entity_id)}</code> : undefined
              }))}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
