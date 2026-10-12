import { useParams } from "react-router-dom";
import { Badge, KV, PageHeader, Table, type Column } from "@nexora/ui";
import { Crumbs } from "./parts";

interface Capability {
  title: string;
  what: string;
  state: "absent" | "partial" | "present";
  where: string;
  detail: string;
}

/**
 * Every workspace link that points at /capability/<key> lands here. The rule is
 * the same everywhere: state plainly whether the platform has this capability,
 * say where the real surface lives, and never dress an absence up as work in
 * progress.
 */
const CAPABILITIES: Record<string, Capability> = {
  findings: {
    title: "Findings & annotations",
    what: "A register of compliance findings, the auditor who raised each one, and its remediation state.",
    state: "present",
    where: "/findings",
    detail:
      "Implemented during the Vision Audit. A finding carries its reference, severity, subject record, the raising role, and a forward-only lifecycle (open → acknowledged → closed) whose every transition is kept as an event. It never touches money.",
  },
  policy_checklist: {
    title: "Policy checklist",
    what: "A checklist of the control policies a company has adopted, with sign-off.",
    state: "absent",
    where: "/control",
    detail:
      "Roles, permissions and approval chains are configurable per company, but there is no policy-document or sign-off model behind them. The role catalogue is the closest thing that exists. Building it needs a new policy store and a sign-off workflow.",
  },
  tickets: {
    title: "Queries & tickets",
    what: "A support queue: customer query, owner, status, resolution.",
    state: "absent",
    where: "/service",
    detail:
      "There is no ticket store in the platform. A query that touches money is raised as a correction request under /service; anything else is handled outside the portal. Building it needs a tickets table, an ownership/queue model and SLA state.",
  },
  support: {
    title: "Raise a query",
    what: "The entry point for a customer to raise a non-financial question.",
    state: "absent",
    where: "/service",
    detail:
      "No query channel exists server-side. Correction requests are the only structured request the platform accepts today.",
  },
  report_builder: {
    title: "Report builder",
    what: "Ad-hoc column and filter selection over the performance engine.",
    state: "absent",
    where: "/reports",
    detail:
      "The report library exposes three fixed surfaces (company, branch, staff) computed by the shared engine. There is no builder to compose new columns, and totals are deliberately never derived independently of the engine. Building it needs a persisted query model plus engine support for composed columns.",
  },
  scheduled_reports: {
    title: "Scheduled reports",
    what: "Recurring report delivery by e-mail or file drop.",
    state: "partial",
    where: "/reports",
    detail:
      "Report generation and CSV export exist and work on demand. What is missing is the schedule store and the delivery worker, and delivery additionally needs the transactional email service. Export CSV from the report library and deliver it yourself in the meantime.",
  },
  system_logs: {
    title: "System logs",
    what: "Server log streaming and log-level control.",
    state: "absent",
    where: "/audit",
    detail:
      "Application logs are an operator concern of the deployment, not a tenant feature; structured logging (pino) already ships but is not surfaced in-product. What Nexora does keep per company is the audit trail, which is read-only and company-scoped.",
  },
  sessions: {
    title: "Active sessions",
    what: "A list of who is signed in, from where, and since when.",
    state: "present",
    where: "/technical",
    detail:
      "Implemented during the Vision Audit. Reads the existing refresh-token records, is company-scoped by RLS, shows no token material, and computes a session as live only while the credential behind it is live.",
  },
};

export function CapabilityPage() {
  const { key = "" } = useParams();
  const capability = CAPABILITIES[key];

  const rows: Array<{ label: string; value: string }> = [
    { label: "What it is", value: capability?.what ?? "This workspace link has no recorded capability." },
    {
      label: "Platform state",
      value:
        capability?.state === "absent"
          ? "Not implemented in the platform"
          : capability?.state === "partial"
            ? "Partially implemented"
            : "Implemented",
    },
    { label: "Where the real surface lives", value: capability?.where ?? "—" },
    { label: "What that means for you", value: capability?.detail ?? "Nothing is registered for this key." },
  ];

  const STATE_TONE = { present: "success", partial: "warning", absent: "danger" } as const;
  const STATE_WORD = { present: "implemented", partial: "partial", absent: "not implemented" } as const;

  const related: Column<{ key: string; label: string; state: "absent" | "partial" | "present" }>[] = [
    { key: "capability", header: "Capability", render: (r) => r.label },
    { key: "state", header: "State", render: (r) => <Badge tone={STATE_TONE[r.state]}>{STATE_WORD[r.state]}</Badge> },
    { key: "where", header: "Real surface", render: (r) => CAPABILITIES[r.key]?.where ?? "—" },
  ];

  return (
    <>
      <PageHeader
        title={capability?.title ?? "Capability"}
        eyebrow={key.replace(/_/g, " ")}
        description="What this workspace expects, and the truth about whether the platform has it."
        breadcrumbs={<Crumbs items={[{ label: "Capability", to: "/" }, { label: key.replace(/_/g, " ") }]} />}
      />
      <section className="nx-panel">
        <h3 className="nx-h3">Honest position</h3>
        <KV items={rows} />
      </section>
      <section className="nx-panel" style={{ marginTop: 16 }}>
        <h3 className="nx-h3">Every capability surface in this portal</h3>
        <Table
          columns={related}
          rows={Object.entries(CAPABILITIES).map(([k, c]) => ({ key: k, label: c.title, state: c.state }))}
          rowKey={(r) => String(r.key)}
        />
      </section>
    </>
  );
}