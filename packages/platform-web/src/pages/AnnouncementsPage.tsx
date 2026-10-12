import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  IconMessage,
  IconPlus,
  Input,
  LoadingRow,
  Modal,
  PageHeader,
  Select,
  Table,
  Textarea,
  formatDateTime,
  formatRelative,
  useToast,
  type Column
} from "@nexora/ui";
import { api, itemsOf, type Json } from "../lib/api";

interface AnnouncementRow extends Json {
  id: string;
  title: string;
  body: string;
  severity: string;
  status: string;
  created_at: string;
}

const SEVERITIES = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" }
] as const;

/** RULE 3.14 - announcements: written, published, expired; critical ones need
 * an explicit confirmation before they go out (Part 12 PO section). */
export function AnnouncementsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<"info" | "warning" | "critical">("info");
  const [busy, setBusy] = useState(false);
  const [confirmCritical, setConfirmCritical] = useState<AnnouncementRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(itemsOf<AnnouncementRow>(await api("/announcements")));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/announcements", { method: "POST", json: { title: title.trim(), body: body.trim(), severity } });
      toast({ title: "Announcement drafted", text: "Publish it to make it visible across company dashboards.", tone: "success" });
      setOpen(false);
      setTitle("");
      setBody("");
      await load();
    } catch (err) {
      toast({ title: "Could not create announcement", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(row: AnnouncementRow, status: "active" | "expired") {
    if (row.severity === "critical" && status === "active") {
      setConfirmCritical(row);
      return;
    }
    await applyStatus(row, status);
  }

  async function applyStatus(row: AnnouncementRow, status: "active" | "expired") {
    setBusy(true);
    try {
      await api(`/announcements/${row.id}/${status}`, { method: "POST" });
      toast({ title: status === "active" ? "Announcement published" : "Announcement expired", tone: "success" });
      setConfirmCritical(null);
      await load();
    } catch (err) {
      toast({ title: "Action failed", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<AnnouncementRow>[] = [
    {
      key: "title",
      header: "Announcement",
      render: (r) => (
        <div className="nx-stack nx-stack--sm" style={{ gap: 2 }}>
          <strong>{r.title}</strong>
          <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{String(r.body ?? "").slice(0, 110)}</span>
        </div>
      )
    },
    {
      key: "severity",
      header: "Severity",
      render: (r) => (
        <Badge tone={r.severity === "critical" ? "danger" : r.severity === "warning" ? "warning" : "neutral"} dot>
          {r.severity}
        </Badge>
      )
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={r.status === "active" ? "success" : r.status === "draft" ? "warning" : "neutral"} dot>{r.status}</Badge>
    },
    { key: "created", header: "Created", hideBelow: "760px", render: (r) => <span title={formatDateTime(r.created_at)}>{formatRelative(r.created_at)}</span> },
    {
      key: "actions",
      header: "",
      width: "220px",
      render: (r) => (
        <div className="nx-row" style={{ gap: 6, justifyContent: "flex-end" }}>
          {r.status !== "active" && (
            <Button size="sm" variant="primary" onClick={() => void setStatus(r, "active")} loading={busy}>Publish</Button>
          )}
          {r.status === "active" && (
            <Button size="sm" onClick={() => void setStatus(r, "expired")} loading={busy}>Expire</Button>
          )}
        </div>
      )
    }
  ];

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Announcements"
        description="Write once for every company. Drafts stay private to the platform; publishing shows the message on tenant dashboards (RULE 3.14)."
        actions={
          <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setOpen(true)}>
            New announcement
          </Button>
        }
      />

      <Card padded={false}>
        {loading ? (
          <LoadingRow text="Loading announcements…" />
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState title="Announcements could not load" detail={error} onRetry={() => void load()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconMessage size={26} />}
            title="No announcements yet"
            text="Publish one to tell every company about maintenance windows, policy changes or new capabilities."
            action={<Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setOpen(true)}>Write the first one</Button>}
          />
        ) : (
          <Table columns={columns} rows={rows} rowKey={(r) => r.id} />
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New announcement"
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" type="submit" form="announcement-form" loading={busy} disabled={title.trim().length < 2 || body.trim().length < 2}>
              Save as draft
            </Button>
          </>
        }
      >
        <form id="announcement-form" className="nx-stack" onSubmit={(e) => void create(e)} noValidate>
          <Field label="Title" htmlFor="an-title" required>
            <Input id="an-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Scheduled maintenance on Sunday" />
          </Field>
          <Field label="Body" htmlFor="an-body" required>
            <Textarea id="an-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What is happening, when, and what companies should do." />
          </Field>
          <Field label="Severity" htmlFor="an-severity" required hint="Critical requires an extra confirmation before publishing">
            <Select id="an-severity" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmCritical !== null}
        onClose={() => setConfirmCritical(null)}
        onConfirm={() => confirmCritical && void applyStatus(confirmCritical, "active")}
        title="Publish a critical announcement?"
        body={`"${confirmCritical?.title ?? ""}" will be pushed to every company dashboard as critical. Confirm it is accurate and actionable.`}
        confirmLabel="Publish as critical"
        tone="danger"
        busy={busy}
      />
    </div>
  );
}
