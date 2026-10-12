import { useState } from "react";
import {
  Badge,
  Button,
  ErrorState,
  LoadingRow,
  Modal,
  PageHeader,
  Table,
  Tabs,
  useToast,
  type Column
} from "@nexora/ui";
import { useMe } from "../auth/SessionProvider";
import { api } from "../lib/api";
import { money, when } from "../lib/format";
import { useResource } from "../lib/useResource";
import { Crumbs } from "./parts";

type TabKey = "roles" | "permissions" | "products" | "chains";

interface RoleDefinition {
  roleKey?: string;
  name?: string;
  category?: string;
  description?: string;
  workspace?: string;
  permissions?: string[];
  enabled?: boolean;
  id?: string;
}

export function ControlPage() {
  const [tab, setTab] = useState<TabKey>("roles");

  return (
    <>
      <PageHeader
        title="Company control"
        description="Which roles this company runs, what each role may do, and the credit configuration."
        breadcrumbs={<Crumbs items={[{ label: "Control" }]} />}
      />
      <Tabs
        items={[
          { key: "roles", label: "Roles" },
          { key: "permissions", label: "Permissions" },
          { key: "products", label: "Loan products" },
          { key: "chains", label: "Approval chains" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "roles" && <Roles />}
        {tab === "permissions" && <Permissions />}
        {tab === "products" && <Products />}
        {tab === "chains" && <Chains />}
      </div>
    </>
  );
}

function Roles() {
  const me = useMe();
  const toast = useToast();
  const canConfigure = me.permissions.includes("configure");
  const catalogue = useResource<{ builtIn?: RoleDefinition[]; templates?: RoleDefinition[] }>(
    () => api.get("/roles/catalogue"),
    []
  );
  const enabled = useResource<RoleDefinition[]>(() => api.get("/roles").then((r) => (Array.isArray(r) ? r : [])), []);
  const [creating, setCreating] = useState(false);

  const enabledKeys = new Set((enabled.data ?? []).map((r) => String(r.roleKey ?? "")));
  const rows = [
    ...(catalogue.data?.builtIn ?? []).map((r) => ({ ...r, enabled: enabledKeys.has(String(r.roleKey)) })),
    ...(catalogue.data?.templates ?? []).map((r) => ({ ...r, custom: true, enabled: enabledKeys.has(String(r.roleKey)) })),
  ];

  const cols: Column<RoleDefinition & { custom?: boolean }>[] = [
    {
      key: "role",
      header: "Role",
      render: (r) => (
        <>
          <strong>{String(r.name ?? r.roleKey ?? "—")}</strong>
          <div className="nx-faint">{String(r.roleKey ?? "")}</div>
        </>
      )
    },
    { key: "category", header: "Category", render: (r) => String(r.category ?? "—").replace(/_/g, " ") },
    { key: "description", header: "Purpose", render: (r) => String(r.description ?? "—") },
    {
      key: "state",
      header: "State",
      render: (r) => (r.custom ? <Badge tone="info">custom template</Badge> : r.enabled ? <Badge tone="success">enabled</Badge> : <Badge tone="neutral">not enabled</Badge>)
    },
    {
      key: "action",
      header: "",
      render: (r) =>
        canConfigure && !r.custom ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              void api("/roles/enabled", { method: "POST", json: { roleKey: r.roleKey, enabled: !r.enabled } })
                .then(() => { toast({ title: r.enabled ? "Role disabled" : "Role enabled", tone: "success" }); enabled.reload(); })
                .catch((err: Error) => toast({ title: "Could not change the role", text: err.message, tone: "danger" }));
            }}
          >
            {r.enabled ? "Disable" : "Enable"}
          </Button>
        ) : null
    },
  ];

  return (
    <>
      <div className="nx-toolbar">
        <span className="nx-faint">A role must be enabled here before it can be assigned to a worker.</span>
        <span className="nx-grow" />
        {canConfigure && <Button size="sm" onClick={() => setCreating(true)}>Create custom role</Button>}
      </div>
      {catalogue.loading || enabled.loading ? (
        <LoadingRow text="Loading the role catalogue…" />
      ) : catalogue.error ? (
        <ErrorState title="Could not load the role catalogue" detail={catalogue.error} onRetry={catalogue.reload} />
      ) : (
        <Table columns={cols} rows={rows} rowKey={(r) => String(r.roleKey ?? r.name ?? "")} empty={<p className="nx-muted">No roles in the catalogue.</p>} />
      )}
      {creating && <CustomRoleModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); enabled.reload(); }} />}
    </>
  );
}

function CustomRoleModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceRoleKey, setSourceRoleKey] = useState("collection_officer");
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title="Create a custom role"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || name.trim().length < 2}
            onClick={() => {
              setBusy(true);
              void api("/roles/custom", { method: "POST", json: { name, description: description || undefined, sourceRoleKey } })
                .then(() => { toast({ title: "Custom role created", tone: "success" }); onDone(); })
                .catch((err: Error) => toast({ title: "Could not create the role", text: err.message, tone: "danger" }))
                .finally(() => setBusy(false));
            }}
          >
            Create
          </Button>
        </>
      }
    >
      <p className="nx-muted">A custom role copies a template's permissions; you can then adjust its verbs.</p>
      <div className="nx-form-grid">
        <label className="nx-field">
          <span>Name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="nx-field">
          <span>Template</span>
          <select value={sourceRoleKey} onChange={(e) => setSourceRoleKey(e.target.value)}>
            {["collection_officer", "senior_collection_officer", "customer_service_officer", "accountant", "assistant_accountant", "it_system_administrator"].map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="nx-field" style={{ gridColumn: "1 / -1" }}>
          <span>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
      </div>
    </Modal>
  );
}

function Permissions() {
  const me = useMe();
  const toast = useToast();
  const canConfigure = me.permissions.includes("configure");
  const roles = useResource<RoleDefinition[]>(() => api.get("/roles").then((r) => (Array.isArray(r) ? r : [])), []);
  const [roleId, setRoleId] = useState("");
  const verbs = useResource<string[]>(
    () => (roleId ? api.get<string[]>(`/roles/${roleId}/permissions`).then((r) => (Array.isArray(r) ? r : [])) : Promise.resolve([])),
    [roleId]
  );
  const [draft, setDraft] = useState<string[] | null>(null);

  const known = [
    "view", "create", "edit", "approve", "reject", "disburse", "allocate", "register_customer",
    "manage_workers", "assign", "configure", "create_branch", "view_branches", "view_performance", "transact",
  ];
  const current = draft ?? verbs.data ?? [];

  return (
    <>
      <div className="nx-toolbar">
        <label className="nx-field">
          <span>Role</span>
          <select className="nx-select" value={roleId} onChange={(e) => { setRoleId(e.target.value); setDraft(null); }}>
            <option value="">Choose a role…</option>
            {(roles.data ?? []).map((r) => (
              <option key={String(r.id ?? r.roleKey)} value={String(r.id ?? "")}>
                {String(r.name ?? r.roleKey ?? "")}
              </option>
            ))}
          </select>
        </label>
        <span className="nx-grow" />
        {canConfigure && roleId && draft && (
          <Button
            size="sm"
            onClick={() => {
              void api(`/roles/${roleId}/permissions`, { method: "PUT", json: { verbs: draft } })
                .then(() => { toast({ title: "Permissions saved", tone: "success" }); setDraft(null); verbs.reload(); })
                .catch((err: Error) => toast({ title: "Could not save permissions", text: err.message, tone: "danger" }));
            }}
          >
            Save verbs
          </Button>
        )}
      </div>
      {!roleId ? (
        <p className="nx-muted">Choose a role to see exactly which verbs it carries.</p>
      ) : verbs.loading ? (
        <LoadingRow text="Loading permissions…" />
      ) : verbs.error ? (
        <ErrorState title="Could not load permissions" detail={verbs.error} onRetry={verbs.reload} />
      ) : (
        <div className="nx-form-grid">
          {known.map((verb) => (
            <label key={verb} className="nx-check">
              <input
                type="checkbox"
                checked={current.includes(verb)}
                disabled={!canConfigure}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...current, verb]
                    : current.filter((v) => v !== verb);
                  setDraft(next);
                }}
              />
              <span>{verb.replace(/_/g, " ")}</span>
            </label>
          ))}
        </div>
      )}
    </>
  );
}

function Products() {
  const { data, loading, error, reload } = useResource<Record<string, unknown>[]>(
    () => api.get("/loan-products").then((r) => (Array.isArray(r) ? r : ((r as { items?: Record<string, unknown>[] }).items ?? []))),
    []
  );

  const cols: Column<Record<string, unknown>>[] = [
    { key: "name", header: "Product", render: (r) => <strong>{String(r.name ?? "—")}</strong> },
    { key: "interest", header: "Interest", numeric: true, render: (r) => String(r.interest_rate ?? "—") },
    { key: "cycle", header: "Cycle (days)", numeric: true, render: (r) => String(r.cycle_days ?? "—") },
    { key: "max", header: "Maximum principal", numeric: true, render: (r) => money(r.max_principal_amount ?? r.maximum_principal ?? 0) },
    { key: "min", header: "Minimum principal", numeric: true, render: (r) => money(r.min_principal_amount ?? r.minimum_principal ?? 0) },
    { key: "savings", header: "Savings", render: (r) => String(r.savings_requirement ?? r.savings_required ?? "—") },
    { key: "status", header: "Status", render: (r) => String(r.status ?? "—") },
  ];

  if (loading) return <LoadingRow text="Loading loan products…" />;
  if (error) return <ErrorState title="Could not load loan products" detail={error} onRetry={reload} />;
  return <Table columns={cols} rows={data ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No loan product configured.</p>} />;
}

function Chains() {
  const { data, loading, error, reload } = useResource<Record<string, unknown>[]>(
    () => api.get("/approval-chains").then((r) => (Array.isArray(r) ? r : ((r as { items?: Record<string, unknown>[] }).items ?? []))),
    []
  );

  const cols: Column<Record<string, unknown>>[] = [
    { key: "name", header: "Chain", render: (r) => <strong>{String(r.name ?? "—")}</strong> },
    { key: "product", header: "Product", render: (r) => String(r.product_name ?? r.product_id ?? "—").slice(0, 24) },
    { key: "stages", header: "Stages", render: (r) => String(r.stage_count ?? (r.stages as unknown[] | undefined)?.length ?? "—") },
    { key: "active", header: "Active", render: (r) => (r.is_active ?? r.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">inactive</Badge>) },
    { key: "created", header: "Created", render: (r) => when(r.created_at) },
  ];

  if (loading) return <LoadingRow text="Loading approval chains…" />;
  if (error) return <ErrorState title="Could not load approval chains" detail={error} onRetry={reload} />;
  return <Table columns={cols} rows={data ?? []} rowKey={(r) => String(r.id)} empty={<p className="nx-muted">No approval chain configured.</p>} />;
}