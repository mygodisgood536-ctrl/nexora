import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  IconSettings,
  LoadingRow,
  Modal,
  PageHeader,
  Table,
  formatDateTime,
  useToast,
  type Column
} from "@nexora/ui";
import { api, itemsOf, type Json } from "../lib/api";

interface SettingRow extends Json {
  key: string;
  value: unknown;
  updated_at: string;
}

/** RULE 3.16 - global settings: platform-wide keys, edited with a recorded
 * before/after in the audit trail. Unknown keys are never invented client-side. */
export function GlobalSettingsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SettingRow | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(itemsOf<SettingRow>(await api("/global-settings")));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(row: SettingRow) {
    setEditing(row);
    setText(typeof row.value === "string" ? row.value : JSON.stringify(row.value, null, 2));
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      let value: unknown = text;
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed === "true" || trimmed === "false" || trimmed === "null" || /^-?\d+(\.\d+)?$/.test(trimmed)) {
        try {
          value = JSON.parse(trimmed);
        } catch {
          value = text;
        }
      }
      await api(`/global-settings/${encodeURIComponent(editing.key)}`, { method: "PUT", json: { value } });
      toast({ title: "Setting saved", text: `${editing.key} was updated and recorded in the audit trail.`, tone: "success" });
      setEditing(null);
      await load();
    } catch (err) {
      toast({ title: "Could not save setting", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<SettingRow>[] = [
    { key: "key", header: "Key", render: (r) => <strong className="nx-num" style={{ fontSize: "var(--nx-text-sm)" }}>{r.key}</strong> },
    {
      key: "value",
      header: "Value",
      render: (r) => (
        <code style={{ fontSize: "0.78rem" }}>
          {typeof r.value === "string" ? r.value : JSON.stringify(r.value)}
        </code>
      )
    },
    { key: "updated", header: "Updated", hideBelow: "760px", render: (r) => (r.updated_at ? formatDateTime(r.updated_at) : "—") },
    {
      key: "actions",
      header: "",
      width: "110px",
      render: (r) => (
        <div style={{ textAlign: "right" }}>
          <Button size="sm" onClick={() => openEdit(r)}>Edit</Button>
        </div>
      )
    }
  ];

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Global settings"
        description="Platform-wide configuration keys. Only keys that exist in the database are editable - this console never fabricates a setting (RULE 3.16)."
        actions={<Button onClick={() => void load()} disabled={loading}>Refresh</Button>}
      />

      <Card padded={false}>
        {loading ? (
          <LoadingRow text="Loading settings…" />
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState title="Settings could not load" detail={error} onRetry={() => void load()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconSettings size={26} />}
            title="No global settings recorded yet"
            text="Settings rows are seeded by migrations. Until they exist there is nothing to edit - and nothing is faked."
          />
        ) : (
          <Table columns={columns} rows={rows} rowKey={(r) => r.key} />
        )}
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.key ?? ""}`}
        footer={
          <>
            <Button onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} loading={busy}>Save setting</Button>
          </>
        }
      >
        <div className="nx-stack">
          <Field label="Value" htmlFor="gs-value" hint="JSON is accepted (objects, arrays, numbers, booleans); plain text is stored as text">
            <Input id="gs-value" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="nx-row" style={{ gap: 8 }}>
            <Badge tone="warning" dot>audited</Badge>
            <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
              The previous value is written to the audit trail before the change is applied.
            </span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
