import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Badge,
  Button,
  ErrorState,
  KV,
  PageHeader,
  Table,
  type Column
} from "@nexora/ui";
import { api } from "../lib/api";
import { Crumbs } from "./parts";

type NodeType =
  | "payment" | "webhook" | "virtual_account" | "customer" | "loan"
  | "schedule_row" | "allocation" | "journal_entry" | "branch"
  | "collection_officer" | "audit_entry";

interface TraceNode {
  type: NodeType;
  id: string;
  label: string;
  detail: Record<string, unknown>;
}

interface TraceEdge {
  from: NodeType;
  fromId: string;
  to: NodeType;
  toId: string;
  relationship: string;
}

interface TraceChain {
  anchor: { type: NodeType; id: string };
  nodes: TraceNode[];
  edges: TraceEdge[];
  complete: boolean;
  missing: Array<{ type: NodeType; id: string; reason: string }>;
}

const NODE_TYPES: NodeType[] = [
  "payment", "webhook", "virtual_account", "customer", "loan", "schedule_row",
  "allocation", "journal_entry", "branch", "collection_officer", "audit_entry",
];

const label = (t: string) => t.replace(/_/g, " ");

/**
 * RULE 10.9.1 / 6.5.4 - the traceability chain is a real relationship in the
 * data. The walk may start from ANY node, so this page anchors on a node the
 * user already has in hand rather than asking them to know a type in advance.
 */
export function TracePage() {
  const [params] = useSearchParams();
  const initialType = (params.get("type") ?? "payment") as NodeType;
  const [type, setType] = useState<NodeType>(NODE_TYPES.includes(initialType) ? initialType : "payment");
  const [id, setId] = useState(params.get("id") ?? "");
  const [chain, setChain] = useState<TraceChain | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<TraceNode | null>(null);

  const walk = (nodeType: NodeType, nodeId: string) => {
    const trimmed = nodeId.trim();
    if (!trimmed) {
      setError("Enter the identifier of the record to walk from.");
      setChain(null);
      return;
    }
    setLoading(true);
    setError(null);
    void api.get<TraceChain>(`/traceability/chain?type=${nodeType}&id=${encodeURIComponent(trimmed)}`)
      .then((res) => setChain(res))
      .catch((err: Error) => { setError(err.message); setChain(null); })
      .finally(() => setLoading(false));
  };

  // An anchor arriving in the query string (from an audit row, for example)
  // renders the chain straight away rather than leaving a filled-in form.
  const anchorKey = `${params.get("type") ?? ""}:${params.get("id") ?? ""}`;
  const [walkedAnchor, setWalkedAnchor] = useState<string>("");
  if (anchorKey !== ":" && anchorKey !== walkedAnchor && id.trim() !== "") {
    setWalkedAnchor(anchorKey);
    walk(type, id);
  }

  const nodeCols: Column<TraceNode>[] = [
    { key: "type", header: "Node", render: (n) => <Badge tone="neutral">{label(n.type)}</Badge> },
    { key: "label", header: "Record", render: (n) => <strong>{n.label}</strong> },
    { key: "id", header: "Identifier", render: (n) => <span className="nx-faint">{n.id.slice(0, 8)}</span> },
    {
      key: "detail",
      header: "Detail",
      render: (n) =>
        Object.entries(n.detail)
          .filter(([, v]) => v !== null && ["string", "number", "boolean"].includes(typeof v))
          .slice(0, 4)
          .map(([k, v]) => `${label(k)}: ${String(v)}`)
          .join(" · ") || "—"
    },
    {
      key: "action",
      header: "",
      render: (n) => (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setPicked(n); }}>
          Walk from here
        </Button>
      )
    },
  ];

  const edgeCols: Column<TraceEdge>[] = [
    { key: "from", header: "From", render: (e) => <>{label(e.from)} <span className="nx-faint">{e.fromId.slice(0, 8)}</span></> },
    { key: "relationship", header: "Relationship", render: (e) => String(e.relationship) },
    { key: "to", header: "To", render: (e) => <>{label(e.to)} <span className="nx-faint">{e.toId.slice(0, 8)}</span></> },
    {
      key: "walk",
      header: "",
      render: (e) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(ev) => { ev.stopPropagation(); walk(e.to, e.toId); }}
        >
          Continue
        </Button>
      )
    },
  ];

  return (
    <>
      <PageHeader
        title="Traceability chain"
        description="Walk any money movement end to end: webhook → payment → allocation → schedule row → journal entry → audit entry."
        breadcrumbs={<Crumbs items={[{ label: "Audit" }, { label: "Traceability" }]} />}
      />

      <div className="nx-toolbar">
        <label className="nx-field">
          <span>Start from</span>
          <select className="nx-select" value={type} onChange={(e) => setType(e.target.value as NodeType)}>
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>{label(t)}</option>
            ))}
          </select>
        </label>
        <label className="nx-field">
          <span>Identifier (uuid)</span>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="the record's id" />
        </label>
        <Button size="sm" onClick={() => walk(type, id)} disabled={loading}>
          {loading ? "Walking…" : "Walk the chain"}
        </Button>
      </div>

      {error && <ErrorState title="Could not walk the chain" detail={error} onRetry={() => walk(type, id)} />}

      {!chain && !error && (
        <p className="nx-muted">
          Choose a record and walk from it. Every node the platform holds for that record is listed, with the real relationships
          between them and anything the chain could not reach named explicitly.
        </p>
      )}

      {chain && (
        <>
          <section className="nx-panel">
            <h3 className="nx-h3">Anchor</h3>
            <KV
              items={[
                { label: "Started from", value: `${label(chain.anchor.type)} ${chain.anchor.id.slice(0, 8)}` },
                { label: "Nodes", value: String(chain.nodes.length) },
                { label: "Relationships", value: String(chain.edges.length) },
                {
                  label: "Completeness",
                  value: chain.complete ? <Badge tone="success">chain complete</Badge> : <Badge tone="warning">gaps present</Badge>
                },
              ]}
            />
            {chain.missing.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <h4 className="nx-h3">What the chain could not reach</h4>
                <Table
                  columns={[
                    { key: "type", header: "Node", render: (r: { type: NodeType }) => <Badge tone="warning">{label(r.type)}</Badge> },
                    { key: "id", header: "Identifier", render: (r: { id: string }) => <span className="nx-faint">{r.id.slice(0, 8)}</span> },
                    { key: "reason", header: "Reason", render: (r: { reason: string }) => String(r.reason) },
                  ]}
                  rows={chain.missing}
                  rowKey={(r) => `${r.type}:${r.id}`}
                />
              </div>
            )}
          </section>

          <section className="nx-panel" style={{ marginTop: 16 }}>
            <h3 className="nx-h3">Records in this chain</h3>
            <Table columns={nodeCols} rows={chain.nodes} rowKey={(n) => `${n.type}:${n.id}`} empty={<p className="nx-muted">No records returned.</p>} />
          </section>

          <section className="nx-panel" style={{ marginTop: 16 }}>
            <h3 className="nx-h3">How they connect</h3>
            <Table columns={edgeCols} rows={chain.edges} rowKey={(e) => `${e.from}:${e.fromId}->${e.to}:${e.toId}`} empty={<p className="nx-muted">No relationships between these records.</p>} />
          </section>
        </>
      )}

      {picked && (
        <div className="nx-toolbar" style={{ marginTop: 16 }}>
          <span className="nx-muted">
            Walking from {label(picked.type)} — {picked.label}
          </span>
          <Button size="sm" onClick={() => { walk(picked.type, picked.id); setPicked(null); }}>
            Continue from this node
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Cancel</Button>
        </div>
      )}
    </>
  );
}