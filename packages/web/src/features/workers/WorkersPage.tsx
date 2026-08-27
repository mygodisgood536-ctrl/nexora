import { useEffect, useState } from "react";

/**
 * Stage 6 — Worker management page (packages/web).
 *
 * Minimum UI required for the Stage 6 gate:
 *   - list workers in the caller's tenant scope (RLS-scoped server-side)
 *   - create-worker form (one worker + initial role assignment at a time)
 *   - status controls (suspend/reactivate/terminate) with mandatory reason
 *   - reset-password action surfaces the new temporary password ONCE
 *
 * Real role-specific dashboards (Stage 10) will reuse this primitive for
 * HR Manager / Head Office Administrator / Branch Manager scoped views, each
 * as its own component tree per the spec's "no cross-role conditional reuse"
 * rule.
 */

interface WorkerRow {
  id: string;
  workerCode: string;
  username: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  branchId: string;
  status: "invited" | "active" | "suspended" | "terminated";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface BranchOption {
  id: string;
  code: string;
  name: string;
}

interface BuiltInRoleOption {
  key: string;
  name: string;
  category: string;
}

interface CatalogueResponse {
  builtIn: BuiltInRoleOption[];
  templates: BuiltInRoleOption[];
}

const STATUS_COLOR: Record<WorkerRow["status"], string> = {
  invited: "#1E40AF",
  active: "#0F766E",
  suspended: "#B45309",
  terminated: "#7F1D1D"
};

export function WorkersPage(): JSX.Element {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [roles, setRoles] = useState<BuiltInRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    username: "",
    phone: "",
    branchId: "",
    roleKey: "",
    scopeType: "single_branch"
  });
  const [lastCreated, setLastCreated] = useState<{
    workerCode: string;
    username: string;
    temporaryPassword: string;
    expiresAt: string;
  } | null>(null);

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!form.branchId || !form.roleKey) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/workers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          username: form.username,
          phone: form.phone || undefined,
          branchId: form.branchId,
          roleKey: form.roleKey,
          scopeType: form.scopeType,
          branchIds: [form.branchId]
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `create ${res.status}`);
      }
      const created = (await res.json()) as {
        workerCode: string;
        username: string;
        temporaryPassword: string;
        temporaryPasswordExpiresAt: string;
      };
      setLastCreated({
        workerCode: created.workerCode,
        username: created.username,
        temporaryPassword: created.temporaryPassword,
        expiresAt: created.temporaryPasswordExpiresAt
      });
      setForm({
        firstName: "",
        lastName: "",
        username: "",
        phone: "",
        branchId: "",
        roleKey: "",
        scopeType: "single_branch"
      });
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleStatus(
    id: string,
    action: string,
    reason: string
  ): Promise<void> {
    const res = await fetch(`/api/v1/workers/${id}/status`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
  return (
    <div className="p-6 max-w-6xl mx-auto" data-testid="workers-page">
      <h1 className="text-2xl font-semibold mb-4" style={{ color: "var(--nx-text)" }}>
        Workers
      </h1>
      {error && (
        <div className="mb-4 p-3 rounded" style={{ background: "#FEE2E2", color: "#7F1D1D" }}>
          {error}
        </div>
      )}
      {lastCreated && (
        <div className="mb-4 p-3 rounded" style={{ background: "#D1FAE5", color: "#065F46" }} data-testid="created-banner">
          Created {lastCreated.workerCode} ({lastCreated.username}). Temporary
          password (hand to the worker; never emailed):{" "}
          <code data-testid="temp-password">{lastCreated.temporaryPassword}</code>
          {" "}— expires {new Date(lastCreated.expiresAt).toLocaleString()}.
        </div>
      )}
      <section className="mb-8 p-4 rounded shadow" style={{ background: "var(--nx-surface)" }}>
        <h2 className="text-lg font-semibold mb-3">Create worker</h2>
        <form className="grid grid-cols-1 md:grid-cols-3 gap-3" onSubmit={handleCreate}>
          <input className="p-2 border rounded" placeholder="First name" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <input className="p-2 border rounded" placeholder="Last name" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <input className="p-2 border rounded" placeholder="Username (a-z 0-9 . _ -)" required pattern="[a-z0-9._-]+" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className="p-2 border rounded" placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <select className="p-2 border rounded" required value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
      <section className="p-4 rounded shadow" style={{ background: "var(--nx-surface)" }}>
        <h2 className="text-lg font-semibold mb-3">Workers in scope</h2>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left p-2">Code</th>
              <th className="text-left p-2">Username</th>
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} className="border-t" data-testid="worker-row">
                <td className="p-2 font-mono">{w.workerCode}</td>
                <td className="p-2">{w.username}</td>
                <td className="p-2">{[w.firstName, w.middleName, w.lastName].filter(Boolean).join(" ")}</td>
                <td className="p-2">
                  <span className="px-2 py-1 rounded text-white text-xs" style={{ background: STATUS_COLOR[w.status] }}>
                    {w.status}
                  </span>
                </td>
                <td className="p-2 space-x-2">
                  {w.status === "active" && (
                    <button className="px-2 py-1 rounded text-white" style={{ background: "#B45309" }} onClick={() => { const reason = window.prompt("Reason for suspension?"); if (reason) void handleStatus(w.id, "suspend", reason); }}>
                      Suspend
                    </button>
                  )}
                  {w.status === "suspended" && (
                    <button className="px-2 py-1 rounded text-white" style={{ background: "#0F766E" }} onClick={() => void handleStatus(w.id, "reactivate", "reactivate")}>
                      Reactivate
                    </button>
                  )}
                  {w.status !== "terminated" && (
                    <button className="px-2 py-1 rounded text-white" style={{ background: "#7F1D1D" }} onClick={() => { const reason = window.prompt("Reason for termination?"); if (reason) void handleStatus(w.id, "terminate", reason); }}>
                      Terminate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default WorkersPage;
            <option value="">Branch…</option>
            {branches.map((b) => (<option key={b.id} value={b.id}>{b.code} — {b.name}</option>))}
          </select>
          <select className="p-2 border rounded" required value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
            <option value="">Initial role…</option>
            {roles.map((r) => (<option key={r.key} value={r.key}>{r.name} ({r.category})</option>))}
          </select>
          <button type="submit" disabled={creating} className="col-span-1 md:col-span-3 p-2 rounded text-white" style={{ background: "var(--nx-primary)" }}>
            {creating ? "Creating…" : "Create worker"}
          </button>
        </form>
      </section>
      body: JSON.stringify({ action, reason })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `status ${res.status}`);
      return;
    }
    await loadAll();
  }

  if (loading) return <div className="p-6">Loading workers…</div>;
  async function loadAll(): Promise<void> {
    try {
      setLoading(true);
      const [wRes, bRes, cRes] = await Promise.all([
        fetch("/api/v1/workers", { credentials: "include" }),
        fetch("/api/v1/branches", { credentials: "include" }),
        fetch("/api/v1/roles/catalogue", { credentials: "include" })
      ]);
      if (!wRes.ok) throw new Error(`workers ${wRes.status}`);
      if (!bRes.ok) throw new Error(`branches ${bRes.status}`);
      if (!cRes.ok) throw new Error(`catalogue ${cRes.status}`);
      setWorkers((await wRes.json()) as WorkerRow[]);
      setBranches((await bRes.json()) as BranchOption[]);
      const cat = (await cRes.json()) as CatalogueResponse;
      setRoles(cat.builtIn);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);