import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconLayers,
  IconPlus,
  LoadingRow,
  PageHeader,
  StatusBadge,
  Table,
  formatDate,
  useToast,
  type Column
} from "@nexora/ui";
import { api, type Json } from "../lib/api";

interface DraftRow extends Json {
  id: string;
  name: string;
  slug: string;
  codePrefix: string;
  status: string;
  createdAt: string;
  setupComplete: boolean;
}

/** RULE 3.3.3 - drafts are saved, resumable and discardable; they never log in. */
export function DraftsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discard, setDiscard] = useState<DraftRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await api<{ items: DraftRow[] }>("/companies/drafts");
      setRows((page.items ?? []).filter((r) => !r.setupComplete || r.status === "in_setup"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmDiscard() {
    if (!discard) return;
    setBusy(true);
    try {
      await api(`/companies/drafts/${discard.id}`, { method: "DELETE" });
      toast({ title: "Draft discarded", text: `${discard.name ?? "The draft"} was removed permanently.`, tone: "success" });
      setDiscard(null);
      await load();
    } catch (err) {
      toast({ title: "Could not discard draft", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<DraftRow>[] = [
    {
      key: "name",
      header: "Draft",
      render: (r) => (
        <div className="nx-stack nx-stack--sm" style={{ gap: 2 }}>
          <strong>{r.name ?? "Untitled draft"}</strong>
          <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
            {r.slug ? `${r.slug}.nexora.app` : "no url yet"}
            {r.codePrefix ? ` - ${r.codePrefix}` : ""}
          </span>
        </div>
      )
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status ?? "in_setup"} /> },
    { key: "created", header: "Saved", hideBelow: "760px", render: (r) => <span title={formatDate(r.createdAt)}>{formatDate(r.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      width: "260px",
      render: (r) => (
        <div className="nx-row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <Button size="sm" variant="primary" onClick={() => navigate(`/companies/new?draft=${encodeURIComponent(r.id)}`)}>
            Resume
          </Button>
          <Button size="sm" variant="danger" onClick={() => setDiscard(r)}>
            Discard
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Drafts in setup"
        description="A draft company sits in setup, cannot be signed in to, and becomes live only when you complete the wizard and activate it (RULE 3.3.3)."
        actions={
          <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => navigate("/companies/new")}>
            New company
          </Button>
        }
      />

      <Card padded={false}>
        {loading ? (
          <LoadingRow text="Loading drafts…" />
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState title="Drafts could not load" detail={error} onRetry={() => void load()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconLayers size={26} />}
            title="No drafts waiting"
            text="Anything you save from the create-company wizard appears here until it is completed or discarded."
            action={<Button variant="primary" icon={<IconPlus size={15} />} onClick={() => navigate("/companies/new")}>Start the wizard</Button>}
          />
        ) : (
          <Table columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/companies/new?draft=${encodeURIComponent(r.id)}`)} />
        )}
      </Card>

      <div className="nx-row" style={{ gap: 8 }}>
        <Badge tone="warning" dot>in setup</Badge>
        <span className="nx-muted" style={{ fontSize: "var(--nx-text-sm)" }}>
          {rows.length} draft{rows.length === 1 ? "" : "s"} - each one can be resumed in two clicks from this page.
        </span>
      </div>

      <ConfirmDialog
        open={discard !== null}
        onClose={() => setDiscard(null)}
        onConfirm={() => void confirmDiscard()}
        title="Discard this draft?"
        body={`"${discard?.name ?? "Untitled draft"}" and everything saved in it will be permanently removed. This cannot be undone.`}
        confirmLabel="Discard draft"
        tone="danger"
        busy={busy}
      />
    </div>
  );
}
