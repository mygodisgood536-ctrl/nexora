import { useState } from "react";
import {
  Button,
  ConfirmDialog,
  ErrorState,
  KV,
  LoadingRow,
  PageHeader,
  Stat,
  useToast
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { when } from "../lib/format";
import { useResource } from "../lib/useResource";
import { Crumbs } from "./parts";

interface EodSummary {
  date: string;
  timezone: string;
  graceDays: number;
  cutoffDate: string;
  assignmentsEnded: number;
  loansMarkedOverdue: number;
  vaRetriesActivated: number;
  reconciliationItemsAdded: number;
  notificationsCreated: number;
  ranAt: string;
}

export function EodPage() {
  const me = useMe();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const last = useResource<EodSummary | null>(() => api.get("/eod/last"), []);

  const allowed = me.roles.some((r) =>
    [
      "md", "deputy_md", "gm", "assistant_gm", "operations_manager",
      "assistant_operations_manager", "head_office_administrator",
      "finance_manager", "internal_auditor", "audit_officer",
    ].includes(r.roleKey)
  );
  const canRun = allowed && me.permissions.includes("approve");

  return (
    <>
      <PageHeader
        title="End of day"
        description="The company-wide settlement step: expiring assignments, overdue transitions, virtual-account retries and the notification fan-out."
        actions={canRun ? <Button size="sm" onClick={() => setConfirming(true)}>Run end of day</Button> : undefined}
        breadcrumbs={<Crumbs items={[{ label: "End of day" }]} />}
      />

      {!allowed && (
        <section className="nx-panel" style={{ marginBottom: 16 }}>
          <h3 className="nx-h3">Not an end-of-day operator</h3>
          <p className="nx-muted">
            End-of-day operations require a Head Office operating role. Your roles do not grant it, so the run and its history are
            not shown here rather than shown empty.
          </p>
        </section>
      )}

      {allowed && (
        <>
          {last.loading ? (
            <LoadingRow text="Reading the last run…" />
          ) : last.error ? (
            <ErrorState title="Could not read the last run" detail={last.error} onRetry={last.reload} />
          ) : !last.data ? (
            <p className="nx-muted">End of day has not run for this company yet.</p>
          ) : (
            <>
              <div className="nx-metrics">
                <Stat label="Date" value={String(last.data.date)} hint={last.data.timezone} />
                <Stat label="Assignments ended" value={String(last.data.assignmentsEnded)} />
                <Stat label="Loans marked overdue" value={String(last.data.loansMarkedOverdue)} />
                <Stat label="VA retries activated" value={String(last.data.vaRetriesActivated)} />
                <Stat label="Reconciliation items" value={String(last.data.reconciliationItemsAdded)} />
                <Stat label="Notifications" value={String(last.data.notificationsCreated)} />
              </div>
              <section className="nx-panel">
                <h3 className="nx-h3">Last run</h3>
                <KV
                  items={[
                    { label: "Date", value: String(last.data.date) },
                    { label: "Timezone", value: String(last.data.timezone) },
                    { label: "Grace days applied", value: String(last.data.graceDays) },
                    { label: "Cutoff date", value: String(last.data.cutoffDate) },
                    { label: "Ran at", value: when(last.data.ranAt) },
                  ]}
                />
              </section>
            </>
          )}

          <section className="nx-panel" style={{ marginTop: 16 }}>
            <h3 className="nx-h3">How it is meant to run</h3>
            <p className="nx-muted">
              In production the deployment scheduler invokes this once per day per company in the company's configured timezone.
              The button above is the manual equivalent for an operator, and every run is audited with your name and role.
            </p>
          </section>
        </>
      )}

      {confirming && (
        <ConfirmDialog
          open
          title="Run end of day now?"
          confirmLabel="Run end of day"
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            setBusy(true);
            void api("/eod", { method: "POST", json: {} })
              .then((res) => {
                const s = res as EodSummary;
                toast({
                  title: "End of day finished",
                  text: `${String(s.loansMarkedOverdue ?? 0)} loans marked overdue, ${String(s.notificationsCreated ?? 0)} notifications`,
                  tone: "success"
                });
                last.reload();
              })
              .catch((err: Error) => toast({ title: "End of day failed", text: err.message, tone: "danger" }))
              .finally(() => setBusy(false));
          }}
          body={busy ? "Running…" : "This changes financial state company-wide: expiring assignments, overdue transitions and the notification fan-out. It cannot be undone by hand."}
        />
      )}
    </>
  );
}