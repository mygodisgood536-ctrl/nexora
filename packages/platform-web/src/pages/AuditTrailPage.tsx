import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingRow,
  PageHeader,
  SearchInput,
  Select,
  Table,
  formatDate,
  formatDateTime,
  type Column
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
 * RULE 3.15 - the platform audit trail: append-only, filterable, exportable.
 * Entries are read-only by design; the export carries exactly what is shown.
 */
export function AuditTrailPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState("");
  const [limit, setLimit] = useState(250);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(itemsOf<AuditRow>(await api(`/audit?limit=${limit}`)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const entities = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.entity && set.add(String(r.entity)));
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (entity && String(r.entity ?? "") !== entity) return false;
      if (!q) return true;
      return [r.action, r.entity, r.entity_id, r.actor, r.actor_email, r.company_id]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(q));
    });
  }, [rows, query, entity]);

  function exportCsv() {
    const header = ["created_at", "actor_email", "actor", "action", "entity", "entity_id", "company_id"];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [header.join(","), ...filtered.map((r) => header.map((h) => escape((r as Json)[h])).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `platform-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns: Column<AuditRow>[] = [
    {
      key: "at",
      header: "When",
      width: "170px",
      render: (r) => {
        const at = String(r.created_at ?? "");
        return <span style={{ fontSize: "var(--nx-text-xs)" }} title={at}>{at ? formatDateTime(at) : "—"}</span>;
      }
    },
    {
      key: "action",
      header: "Action",
      render: (r) => <strong style={{ fontSize: "var(--nx-text-sm)" }}>{String(r.action ?? "—")}</strong>
    },
    { key: "entity", header: "Entity", render: (r) => <Badge tone="neutral">{String(r.entity ?? "platform")}</Badge> },
    {
      key: "entity_id",
      header: "Record",
      hideBelow: "760px",
      render: (r) => (r.entity_id ? <span className="nx-num" style={{ fontSize: "var(--nx-text-xs)" }}>{String(r.entity_id)}</span> : <span className="nx-faint">—</span>)
    },
    {
      key: "actor",
      header: "Actor",
      hideBelow: "1000px",
      render: (r) => <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{String(r.actor_email ?? r.actor ?? "system")}</span>
    },
    {
      key: "company",
      header: "Company",
      hideBelow: "1000px",
      render: (r) => (r.company_id ? <span className="nx-num" style={{ fontSize: "var(--nx-text-xs)" }}>{String(r.company_id).slice(0, 13)}…</span> : <span className="nx-faint">platform</span>)
    }
  ];

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Platform audit trail"
        description="Append-only record of every platform action. Rows can be filtered and exported but never edited or removed (RULE 3.7.1 / Part 12)."
        actions={<Button onClick={exportCsv} disabled={filtered.length === 0}>Export CSV</Button>}
      />

      <Card padded={false}>
        <div className="nx-contextbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search action, actor, entity or record id…" />
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter by entity" style={{ width: 180 }}>
            <option value="">All entities</option>
            {entities.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </Select>
          <Select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Row limit" style={{ width: 130 }}>
            <option value="100">100 rows</option>
            <option value="250">250 rows</option>
            <option value="500">500 rows</option>
          </Select>
          <div className="nx-grow" />
          <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{filtered.length} of {rows.length}</span>
          <Button size="sm" onClick={() => void load()} disabled={loading}>Refresh</Button>
        </div>

        {loading ? (
          <LoadingRow text="Loading audit trail…" />
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState title="Audit trail could not load" detail={error} onRetry={() => void load()} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No matching entries" text="Adjust the filters. The trail only contains events that actually happened." />
        ) : (
          <>
            <Table columns={columns} rows={filtered} rowKey={(r) => String(r.id ?? `${r.created_at}-${r.action}-${r.entity_id ?? ""}`)} />
            <div style={{ padding: "10px 20px", borderTop: "1px solid var(--nx-border)" }}>
              <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
                Showing {filtered.length} entries - CSV export contains exactly this view ({formatDate(new Date())}).
              </span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
