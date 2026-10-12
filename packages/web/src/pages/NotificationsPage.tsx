import { useState } from "react";
import {
  Badge,
  Button,
  ErrorState,
  KV,
  LoadingRow,
  PageHeader,
  Table,
  useToast,
  type Column
} from "@nexora/ui";
import { api } from "../lib/api";
import { when } from "../lib/format";
import { useList } from "../lib/useResource";
import { Crumbs, PAGE_SIZE } from "./parts";

interface NotificationRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  channel: string;
  read_at: string | null;
  created_at: string;
}

export function NotificationsPage() {
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const list = useList<NotificationRow>("/notifications", {
    params: { read: onlyUnread ? "false" : undefined },
    page: Math.floor(offset / PAGE_SIZE) + 1,
    pageSize: PAGE_SIZE
  });

  const cols: Column<NotificationRow>[] = [
    { key: "kind", header: "Signal", render: (r) => <Badge tone="neutral">{r.kind.replace(/_/g, " ")}</Badge> },
    {
      key: "summary",
      header: "Detail",
      render: (r) => Object.entries(r.payload ?? {}).slice(0, 4).map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`).join(" · ") || "—"
    },
    { key: "channel", header: "Channel", render: (r) => String(r.channel ?? "in_app") },
    { key: "created", header: "Received", render: (r) => when(r.created_at) },
    { key: "state", header: "State", render: (r) => (r.read_at ? <Badge tone="success">read</Badge> : <Badge tone="warning">unread</Badge>) },
    {
      key: "action",
      header: "",
      render: (r) =>
        r.read_at ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              void api(`/notifications/${r.id}/read`, { method: "POST" })
                .then(() => { toast({ title: "Marked read", tone: "success" }); list.reload(); })
                .catch((err: Error) => toast({ title: "Could not mark read", text: err.message, tone: "danger" }));
            }}
          >
            Mark read
          </Button>
        )
    },
  ];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Your own inbox only. Nobody else's notifications are visible or touchable."
        actions={
          <Button
            size="sm"
            onClick={() => {
              void api("/notifications/read-all", { method: "POST" })
                .then((res) => {
                  toast({ title: "Inbox cleared", text: `${String((res as { updated?: number }).updated ?? 0)} marked read`, tone: "success" });
                  list.reload();
                })
                .catch((err: Error) => toast({ title: "Could not clear the inbox", text: err.message, tone: "danger" }));
            }}
          >
            Mark all read
          </Button>
        }
        breadcrumbs={<Crumbs items={[{ label: "Notifications" }]} />}
      />
      <div className="nx-toolbar">
        <label className="nx-check">
          <input type="checkbox" checked={onlyUnread} onChange={(e) => { setOnlyUnread(e.target.checked); setOffset(0); }} />
          <span>Unread only</span>
        </label>
        <span className="nx-grow" />
        <span className="nx-faint">{list.total} in your inbox</span>
      </div>

      {list.loading ? <LoadingRow text="Loading your inbox…" /> : list.error ? (
        <ErrorState title="Could not load your notifications" detail={list.error} onRetry={list.reload} />
      ) : (
        <Table columns={cols} rows={list.rows} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">Nothing in your inbox.</p>} />
      )}

      {list.total > PAGE_SIZE && (
        <div className="nx-toolbar">
          <span className="nx-grow" />
          <button className="nx-btn nx-btn--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </button>
          <button className="nx-btn nx-btn--sm" onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </button>
        </div>
      )}

      <section className="nx-panel" style={{ marginTop: 16 }}>
        <h3 className="nx-h3">How signals reach you</h3>
        <KV
          items={[
            { label: "Approval queue", value: "Loan decisions appear in Approvals, not here" },
            { label: "Escalations", value: "Overdue escalations notify the ladder's targets" },
            { label: "Collection watch", value: "Standing alerts about allocation and silent groups" },
            { label: "Channel", value: "In-app only — email and SMS are not wired in this deployment" },
          ]}
        />
      </section>
    </>
  );
}