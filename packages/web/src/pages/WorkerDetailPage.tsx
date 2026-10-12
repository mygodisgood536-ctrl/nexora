import { Crumbs } from "./parts";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  KV,
  LoadingRow,
  Modal,
  PageHeader,
  StatusBadge,
  Table,
  useToast,
  type Column
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { day, personName, when } from "../lib/format";
import { useResource } from "../lib/useResource";

export function WorkerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const toast = useToast();
  const { data: worker, loading, error, reload } = useResource<Record<string, unknown>>(() => api<Record<string, unknown>>(`/workers/${id}`), [id]);
  const { data: assignments, reload: reloadAssignments } = useResource<unknown[]>(() => api<Record<string, unknown>>(`/workers/${id}/assignments`).then((r) => (Array.isArray(r) ? (r as unknown[]) : ((r as { items?: unknown[] }).items ?? []))), [id]);
  const [confirm, setConfirm] = useState<null | { action: "activate" | "suspend" | "reactivate" | "terminate"; label: string }>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);

  const canManage = me.permissions.includes("manage_workers");
  const canConfigure = me.permissions.includes("configure");
  const canAssign = me.permissions.includes("assign");

  if (loading) return <LoadingRow text="Loading worker…" />;
  if (error || !worker) return <ErrorState title="Could not load this worker" detail={error ?? undefined} onRetry={reload} />;

  const status = String(worker.status ?? "unknown");

  const runStatus = (action: "activate" | "suspend" | "reactivate" | "terminate") => {
    setConfirm(null);
    void api(`/workers/${id}/status`, { method: "POST", json: { action } })
      .then(() => {
        toast({ title: `Worker ${action.replace(/e$/, "ed")}`, tone: "success" });
        reload();
      })
      .catch((err: Error) => toast({ title: "Could not update worker status", text: err.message, tone: "danger" }));
  };

  const actions = (
    <>
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>Back</Button>
      {canManage && status !== "active" && status !== "terminated" && (
        <Button size="sm" onClick={() => setConfirm({ action: "activate", label: "Activate" })}>Activate</Button>
      )}
      {canManage && status === "active" && (
        <Button variant="secondary" size="sm" onClick={() => setConfirm({ action: "suspend", label: "Suspend" })}>Suspend</Button>
      )}
      {canManage && <Button size="sm" onClick={() => setAssignOpen(true)}>Assign role</Button>}
      {canConfigure && <Button variant="secondary" size="sm" onClick={() => setResetOpen(true)}>Reset password</Button>}
      {canManage && (
        <Badge tone="neutral">
          <Button variant="ghost" size="sm" onClick={() => setHoldOpen(true)}>Hold portfolio</Button>
        </Badge>
      )}
    </>
  );

  const assignCols: Column<Record<string, unknown>>[] = [
    { key: "role", header: "Role", render: (r) => <><strong>{String(r.role_name ?? "—")}</strong><div className="nx-faint">{String(r.role_key ?? "")}</div></> },
    { key: "scope", header: "Scope", render: (r) => String(r.scope_type ?? "").replace(/_/g, " ") || "—" },
    { key: "type", header: "Type", render: (r) => <Badge tone={String(r.status) === "active" ? "success" : "neutral"}>{String(r.assignment_type ?? "—")}</Badge> },
    { key: "starts", header: "Starts", render: (r) => r.starts_at ? day(r.starts_at) : "—" },
    { key: "ends", header: "Ends", render: (r) => r.ends_at ? day(r.ends_at) : "—" },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status ?? "unknown")} /> },
  ];

  return (
    <>
      <PageHeader
        title={personName(worker)}
        eyebrow={String(worker.worker_code ?? "")}
        description={`${String(worker.username ?? "")} · ${String((worker.branch_id as string | null | undefined)?.slice?.(0, 8) ?? "no branch")}`}
        actions={actions}
        breadcrumbs={<Crumbs items={[{ label: "People" }, { label: personName(worker) }]} />}
      />
      <div className="nx-grid nx-grid--2">
        <section className="nx-panel">
          <h3 className="nx-h3">Profile</h3>
          <KV items={[
            { label: "Full name", value: personName(worker) },
            { label: "Worker code", value: String(worker.worker_code ?? "—") },
            { label: "Username", value: String(worker.username ?? "—") },
            { label: "Phone", value: String(worker.phone ?? "—") },
            { label: "Status", value: <StatusBadge status={status} /> },
            { label: "Credentials", value: <StatusBadge status={String(worker.credential_state ?? "unknown")} label={String(worker.credential_state ?? "unknown").replace(/_/g, " ")} /> },
            { label: "Must change password", value: worker.must_change_password ? <Badge tone="warning">yes</Badge> : "no" },
            { label: "Last login", value: when(worker.last_login_at) },
            { label: "Created", value: day(worker.created_at) },
          ]} />
        </section>
        <section className="nx-panel">
          <h3 className="nx-h3">Role assignments</h3>
          {!canAssign && <p className="nx-muted">Roles {"you can"} not view assignment history with your current lens.</p>}
          <Table columns={assignCols} rows={(assignments ?? []) as Record<string, unknown>[]} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No role assignments.</p>} />
        </section>
      </div>

      {confirm && (
        <ConfirmDialog
          open
          title={`${confirm.label} this worker?`}
          confirmLabel={confirm.label}
          onClose={() => setConfirm(null)}
          onConfirm={() => runStatus(confirm.action)}
          body="This worker will be recorded in the audit trail."
        />
      )}
      {resetOpen && (
        <ResetModal
          onClose={() => setResetOpen(false)}
          onDone={(secret) => {
            setResetOpen(false);
            toast({ title: "Password reset", text: secret });
            reload();
          }}
        />
      )}
      {assignOpen && <AssignRoleModal onClose={() => setAssignOpen(false)} onDone={() => { setAssignOpen(false); reloadAssignments(); toast({ title: "Role assigned", tone: "success" }); }} />}
      {holdOpen && (
        <HoldPortfolioModal onClose={() => setHoldOpen(false)} onDone={() => { setHoldOpen(false); toast({ title: "Portfolio held", tone: "success" }); reload(); }} />
      )}
    </>
  );

  function ResetModal({ onClose, onDone }: { onClose: () => void; onDone: (secret: string) => void }) {
    const toast = useToast();
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    return (
      <Modal open onClose={onClose} title="Reset password" footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || reason.trim().length < 5} onClick={() => {
            setBusy(true);
            void api(`/workers/${id}/reset-password`, { method: "POST", json: { reason } })
              .then((r) => onDone((r as { temporaryPassword?: string }).temporaryPassword ?? "Password reset."))
              .catch((err: Error) => toast({ title: "Could not reset password", text: err.message, tone: "danger" }))
              .finally(() => setBusy(false));
          }}>Reset</Button>
        </>
      }>
        <label className="nx-field">
          <span>Reason (min 5 chars) *</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </label>
      </Modal>
    );
  }

  function HoldPortfolioModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
    const toast = useToast();
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    return (
      <Modal open onClose={onClose} title="Hold portfolio" footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || reason.trim().length < 5} onClick={() => {
            setBusy(true);
            void api(`/workers/${id}/portfolio/hold`, { method: "POST", json: { reason } })
              .then(() => onDone())
              .catch((err: Error) => toast({ title: "Could not hold portfolio", text: err.message, tone: "danger" }))
              .finally(() => setBusy(false));
          }}>Hold portfolio</Button>
        </>
      }>
        <p className="nx-muted">The held worker {"can't"} collect or follow up; their book is paused until release.</p>
        <label className="nx-field">
          <span>Reason (min 5 chars) *</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </label>
      </Modal>
    );
  }

  function AssignRoleModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
    const toast = useToast();
    const [roleKey, setRoleKey] = useState("collection_officer");
    const [scopeType, setScopeType] = useState("single_branch");
    const [branchIds, setBranchIds] = useState("");
    const [busy, setBusy] = useState(false);
    return (
      <Modal open onClose={onClose} title="Assign a role" footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => {
            setBusy(true);
            void api(`/workers/${id}/assignments`, {
              method: "POST",
              json: {
                roleKey,
                scopeType,
                branchIds: branchIds.trim() ? branchIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
                reason: scopeType
              }
            })
              .then(() => onDone())
              .catch((err: Error) => toast({ title: "Could not assign role", text: err.message, tone: "danger" }))
              .finally(() => setBusy(false));
          }}>Assign</Button>
        </>
      }>
        <div className="nx-form-grid">
          <label className="nx-field">
            <span>Role key</span>
            <select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
              {["collection_officer", "senior_collection_officer", "recovery_officer", "customer_service_officer", "accountant", "assistant_accountant", "hr_officer", "mis_reporting_officer", "internal_auditor", "compliance_officer"].map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <label className="nx-field">
            <span>Scope type</span>
            <select value={scopeType} onChange={(e) => setScopeType(e.target.value)}>
              <option value="single_branch">Single branch</option>
              <option value="multi_branch">Multi branch</option>
              <option value="head_office">Head office</option>
              <option value="company_wide">Company wide</option>
              <option value="assigned_customers_groups_loans">Assigned customers / groups / loans</option>
            </select>
          </label>
          {scopeType === "multi_branch" && (
            <label className="nx-field">
              <span>Branch ids (comma separated)</span>
              <input value={branchIds} onChange={(e) => setBranchIds(e.target.value)} placeholder="uuid, uuid…" />
            </label>
          )}
        </div>
      </Modal>
    );
  }
}