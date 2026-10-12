import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  IconShield,
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

interface SessionRow extends Json {
  id: string;
  company_id: string;
  company_name: string;
  reason: string;
  requested_by: string;
  opened_at: string;
  expires_at: string;
  closed_at: string | null;
  is_open: boolean;
}

interface CompanyOption {
  id: string;
  name: string;
}

/**
 * RULE 3.7 - support access: time-bound, reason-recorded sessions that unlock
 * aggregate-only drill-down. Nothing individual is ever exposed (RULE 3.7.2).
 */
export function SupportAccessPage() {
  const toast = useToast();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [busy, setBusy] = useState(false);
  const [toClose, setToClose] = useState<SessionRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, c] = await Promise.all([
        api<unknown>("/support-access"),
        api<unknown>("/companies?limit=200")
      ]);
      setSessions(itemsOf<SessionRow>(s));
      setCompanies(
        itemsOf<{ id: string; name: string }>(c).map((x) => ({ id: x.id, name: x.name }))
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openSession(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/support-access", {
        method: "POST",
        json: { companyId, reason: reason.trim(), durationMinutes: Number(minutes) }
      });
      toast({ title: "Support session opened", text: "Aggregate drill-down is unlocked for this window only.", tone: "success" });
      setOpen(false);
      setReason("");
      await load();
    } catch (err) {
      toast({ title: "Could not open session", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function closeSession() {
    if (!toClose) return;
    setBusy(true);
    try {
      await api(`/support-access/${toClose.id}/close`, { method: "POST" });
      toast({ title: "Session closed", text: `${toClose.company_name} is no longer accessible.`, tone: "success" });
      setToClose(null);
      await load();
    } catch (err) {
      toast({ title: "Could not close session", text: (err as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<SessionRow>[] = [
    {
      key: "company",
      header: "Company",
      render: (s) => (
        <div className="nx-stack nx-stack--sm" style={{ gap: 2 }}>
          <strong>{s.company_name}</strong>
          <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>{s.reason}</span>
        </div>
      )
    },
    {
      key: "state",
      header: "State",
      render: (s) =>
        s.is_open ? (
          <Badge tone="warning" dot>open until {formatRelative(s.expires_at)}</Badge>
        ) : s.closed_at ? (
          <Badge tone="neutral" dot>closed</Badge>
        ) : (
          <Badge tone="neutral" dot>expired</Badge>
        )
    },
    { key: "opened", header: "Opened", hideBelow: "760px", render: (s) => <span title={formatDateTime(s.opened_at)}>{formatRelative(s.opened_at)}</span> },
    { key: "by", header: "Opened by", hideBelow: "1000px", render: (s) => <span className="nx-faint">{s.requested_by}</span> },
    {
      key: "actions",
      header: "",
      width: "120px",
      render: (s) =>
        s.is_open ? (
          <div style={{ textAlign: "right" }}>
            <Button size="sm" variant="danger" onClick={() => setToClose(s)}>Close</Button>
          </div>
        ) : (
          <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)", textAlign: "right", display: "block" }}>
            {s.expires_at ? `ended ${formatRelative(s.expires_at)}` : "—"}
          </span>
        )
    }
  ];

  return (
    <div className="nx-stack nx-stack--lg">
      <PageHeader
        eyebrow="Platform"
        title="Support access"
        description="Open a session with a recorded reason and a duration between 5 and 480 minutes. Only aggregate counts are available inside a session - never individual records (RULE 3.7.2)."
        actions={
          <Button variant="primary" icon={<IconShield size={15} />} onClick={() => setOpen(true)}>
            Open support session
          </Button>
        }
      />

      <Card padded={false}>
        {loading ? (
          <LoadingRow text="Loading sessions…" />
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState title="Support sessions could not load" detail={error} onRetry={() => void load()} />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<IconShield size={26} />}
            title="No support sessions yet"
            text="Every session you open is logged with your reason, your identity and its expiry - this list is the record."
            action={
              <Button variant="primary" icon={<IconShield size={15} />} onClick={() => setOpen(true)}>
                Open support session
              </Button>
            }
          />
        ) : (
          <Table columns={columns} rows={sessions} rowKey={(s) => s.id} />
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Open support session" footer={
        <>
          <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" form="support-form" type="submit" loading={busy} disabled={!companyId || reason.trim().length < 10}>
            Open session
          </Button>
        </>
      }>
        <form id="support-form" className="nx-stack" onSubmit={(e) => void openSession(e)} noValidate>
          <Field label="Company" htmlFor="sa-company" required>
            <Select id="sa-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
              <option value="">Select a company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (recorded in the audit trail)" htmlFor="sa-reason" required hint="At least 10 characters - be specific">
            <Textarea id="sa-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Investigating reconciliation mismatch ticket #1042" />
          </Field>
          <Field label="Duration (minutes)" htmlFor="sa-minutes" required hint="5 - 480; the session ends automatically">
            <Input id="sa-minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={toClose !== null}
        onClose={() => setToClose(null)}
        onConfirm={() => void closeSession()}
        title="Close this support session?"
        body={`${toClose?.company_name ?? "The company"} becomes inaccessible again immediately. The closure is recorded in the audit trail.`}
        confirmLabel="Close session"
        tone="danger"
        busy={busy}
      />
    </div>
  );
}
