import { useState } from "react";
import {
  Badge,
  Button,
  ErrorState,
  LoadingRow,
  PageHeader,
  StatusBadge,
  Table,
  Tabs,
  useToast,
  type Column
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { when } from "../lib/format";
import { useResource } from "../lib/useResource";
import { Crumbs } from "./parts";

type TabKey = "webhooks" | "providers" | "integrity" | "sessions";

export function TechnicalPage() {
  const [tab, setTab] = useState<TabKey>("webhooks");

  return (
    <>
      <PageHeader
        title="Technical"
        description="Webhook exceptions, provider connection health, recovery integrity checks, and who is signed in."
        breadcrumbs={<Crumbs items={[{ label: "Technical" }]} />}
      />
      <Tabs
        items={[
          { key: "webhooks", label: "Webhook exceptions" },
          { key: "providers", label: "Provider health" },
          { key: "integrity", label: "Integrity checks" },
          { key: "sessions", label: "Sessions" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "webhooks" && <WebhookExceptions />}
        {tab === "providers" && <ProviderHealth />}
        {tab === "integrity" && <IntegrityChecks />}
        {tab === "sessions" && <Sessions />}
      </div>
    </>
  );
}

function WebhookExceptions() {
  const { data, loading, error, reload } = useResource<{ items?: Record<string, unknown>[]; total?: number }>(
    () => api.get("/webhook-exceptions?resolved=false&limit=100"),
    []
  );

  const cols: Column<Record<string, unknown>>[] = [
    { key: "provider", header: "Provider", render: (r) => String(r.provider ?? "—") },
    { key: "ref", header: "Transaction ref", render: (r) => <span className="nx-faint">{String(r.provider_txn_ref ?? r.providerTxnRef ?? "—")}</span> },
    { key: "reason", header: "Reason", render: (r) => <Badge tone="danger">{String(r.error ?? r.reason ?? "rejected")}</Badge> },
    { key: "seen", header: "Seen", render: (r) => when(r.created_at ?? r.received_at) },
    { key: "resolved", header: "State", render: (r) => (r.resolved_at ? <Badge tone="success">resolved</Badge> : <Badge tone="warning">open</Badge>) },
  ];

  if (loading) return <LoadingRow text="Loading webhook exceptions…" />;
  if (error) return <ErrorState title="Could not load webhook exceptions" detail={error} onRetry={reload} />;
  return (
    <>
      <p className="nx-muted">
        A webhook is rejected when its signature does not verify or its schema does not match. The raw event is kept; nothing is
        silently dropped.
      </p>
      <Table columns={cols} rows={data?.items ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No open webhook exceptions.</p>} />
    </>
  );
}

function ProviderHealth() {
  const toast = useToast();
  const me = useMe();
  const canConfigure = me.permissions.includes("configure");
  const { data, loading, error, reload } = useResource<{ items?: Record<string, unknown>[]; total?: number }>(
    () => api.get("/payment-providers"),
    []
  );
  const [testing, setTesting] = useState<string | null>(null);

  const cols: Column<Record<string, unknown>>[] = [
    { key: "provider", header: "Provider", render: (r) => <strong>{String(r.provider ?? "—")}</strong> },
    { key: "url", header: "API base URL", render: (r) => String(r.api_base_url ?? r.apiBaseUrl ?? "—") },
    { key: "key", header: "API key", render: (r) => <span className="nx-faint">{String(r.api_key_masked ?? r.apiKey ?? "—")}</span> },
    { key: "md", header: "MD approval", render: (r) => <StatusBadge status={(r.md_approved ?? r.mdApproved) ? "approved" : "pending"} /> },
    { key: "active", header: "Active", render: (r) => ((r.is_active ?? r.isActive) ? <Badge tone="success">active</Badge> : <Badge tone="neutral">inactive</Badge>) },
    {
      key: "test",
      header: "",
      render: (r) => (canConfigure ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            const id = String(r.id);
            setTesting(id);
            void api(`/payment-providers/${id}/test`, { method: "POST" })
              .then((res) => toast({ title: "Connection test", text: JSON.stringify(res) }))
              .catch((err: Error) => toast({ title: "Test failed", text: err.message, tone: "danger" }))
              .finally(() => setTesting(null));
          }}
        >
          {testing === String(r.id) ? "Testing…" : "Test"}
        </Button>
      ) : null)
    },
  ];

  if (loading) return <LoadingRow text="Loading provider connections…" />;
  if (error) return <ErrorState title="Could not load provider connections" detail={error} onRetry={reload} />;
  return <Table columns={cols} rows={data?.items ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No provider connection configured.</p>} />;
}

interface RecoveryRun {
  id: string;
  check: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: Record<string, unknown>;
  raisedAt?: string;
}

interface SessionRow {
  id: string;
  userId: string;
  workerName: string;
  workerCode: string | null;
  status: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  createdIp: string | null;
  userAgent: string | null;
  live: boolean;
}

/**
 * Part 12 §12.31 — the Technical hub's "Sessions" surface. Read-only: it shows
 * who is signed in, from where and since when. It never exposes a token, and
 * it offers no way to end a session from here — sessions die through the
 * credential controls (freeze, hold, terminate), which are audited.
 */
function Sessions() {
  const [includeExpired, setIncludeExpired] = useState(false);
  const { data, loading, error, reload } = useResource<{ sessions?: SessionRow[] }>(
    () => api.get(`/recovery/sessions?includeExpired=${includeExpired ? "true" : "false"}`),
    [includeExpired]
  );

  const cols: Column<SessionRow>[] = [
    {
      key: "worker",
      header: "Worker",
      render: (r) => (
        <>
          <strong>{r.workerName}</strong>
          {r.workerCode && <div className="nx-faint">{r.workerCode}</div>}
        </>
      )
    },
    {
      key: "state",
      header: "State",
      render: (r) =>
        r.live ? <Badge tone="success">live</Badge> : <Badge tone="neutral">{r.status}</Badge>
    },
    { key: "started", header: "Signed in", render: (r) => when(r.createdAt) },
    { key: "expires", header: "Expires", render: (r) => when(r.expiresAt) },
    { key: "ip", header: "From", render: (r) => <span className="nx-faint">{r.createdIp ?? "—"}</span> },
    { key: "agent", header: "Client", render: (r) => <span className="nx-faint">{r.userAgent ?? "—"}</span> },
  ];

  return (
    <>
      <div className="nx-toolbar">
        <label className="nx-check">
          <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} />
          <span>Include expired and revoked</span>
        </label>
        <span className="nx-grow" />
        <span className="nx-faint">{(data?.sessions ?? []).filter((s) => s.live).length} live</span>
      </div>
      {loading ? (
        <LoadingRow text="Reading sessions…" />
      ) : error ? (
        <ErrorState title="Could not read sessions" detail={error} onRetry={reload} />
      ) : (
        <Table columns={cols} rows={data?.sessions ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No sessions.</p>} />
      )}
    </>
  );
}

function IntegrityChecks() {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<{ runs?: RecoveryRun[] }>(() => api.get("/recovery/checks?limit=25"), []);
  const [busy, setBusy] = useState<string | null>(null);

  const cols: Column<RecoveryRun>[] = [
    { key: "check", header: "Check", render: (r) => String(r.check ?? "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
    { key: "raised", header: "Raised", render: (r) => when(r.raisedAt ?? r.startedAt) },
    { key: "finished", header: "Finished", render: (r) => when(r.finishedAt) },
    {
      key: "summary",
      header: "Summary",
      render: (r) =>
        r.summary
          ? Object.entries(r.summary).slice(0, 4).map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`).join(" · ") || "—"
          : "—"
    },
  ];

  const run = (endpoint: string, label: string) => {
    setBusy(endpoint);
    void api(endpoint, { method: "POST", json: {} })
      .then(() => { toast({ title: `${label} finished`, tone: "success" }); reload(); })
      .catch((err: Error) => toast({ title: `${label} failed`, text: err.message, tone: "danger" }))
      .finally(() => setBusy(null));
  };

  return (
    <>
      <div className="nx-toolbar">
        <Button size="sm" onClick={() => run("/recovery/checks/referential-integrity", "Referential integrity")} disabled={busy !== null}>
          Referential integrity
        </Button>
        <Button size="sm" onClick={() => run("/recovery/checks/evidence-hashes", "Evidence hashes")} disabled={busy !== null}>
          Evidence hashes
        </Button>
        <Button size="sm" onClick={() => run("/recovery/checks/payment-reconciliation", "Payment reconciliation")} disabled={busy !== null}>
          Payment reconciliation
        </Button>
        <Button size="sm" onClick={() => run("/recovery/checks/restore-verification", "Restore verification")} disabled={busy !== null}>
          Restore verification
        </Button>
      </div>
      <p className="nx-muted">
        Integrity checks verify that the ledger, evidence hashes and cross-references hold. They never write financial rows.
      </p>
      {loading ? <LoadingRow text="Loading check history…" /> : error ? (
        <ErrorState title="Could not load check history" detail={error} onRetry={reload} />
      ) : (
        <Table columns={cols} rows={data?.runs ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No check has been run yet.</p>} />
      )}
    </>
  );
}