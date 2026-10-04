import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

export type TraceNodeType =
  | "payment"
  | "webhook"
  | "virtual_account"
  | "customer"
  | "loan"
  | "schedule_row"
  | "allocation"
  | "journal_entry"
  | "branch"
  | "collection_officer"
  | "audit_entry";

export interface TraceNode {
  type: TraceNodeType;
  id: string;
  label: string;
  detail: Record<string, unknown>;
}

export interface TraceEdge {
  from: TraceNodeType;
  fromId: string;
  to: TraceNodeType;
  toId: string;
  relationship: string;
}

export interface TraceChain {
  anchor: { type: TraceNodeType; id: string };
  nodes: TraceNode[];
  edges: TraceEdge[];
  complete: boolean;
  missing: Array<{ type: TraceNodeType; id: string; reason: string }>;
}

export interface TraceabilityActor {
  userId: string;
  companyId: string;
  branchId: string | null;
}

function nodeKey(type: TraceNodeType, id: string): string {
  return `${type}:${id}`;
}

function labelOf(rows: Array<Record<string, unknown>>, joiner = " "): string {
  const parts = ["first_name", "middle_name", "last_name"]
    .map((key) => rows[0]?.[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return parts.length > 0 ? parts.join(joiner) : String(rows[0]?.id ?? "").slice(0, 8);
}

/**
 * RULE 10.9.1 / 6.5.4 — the traceability chain is a real relationship in the
 * data, not a report-time guess:
 *   Payment -> Webhook -> Transaction -> Customer -> Virtual account -> Loan
 *           -> Allocation -> Ledger -> Accounting -> Branch -> Collection Officer
 *           -> Audit trail
 * Every link below is an actual foreign key, so an authorised user can move
 * from any node to its neighbours and the Auditor can walk the whole chain in
 * either direction.
 */
export async function getTraceabilityChain(
  actor: TraceabilityActor,
  type: TraceNodeType,
  id: string
): Promise<TraceChain> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid identifier");

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const nodes = new Map<string, TraceNode>();
    const edges: TraceEdge[] = [];
    const missing: TraceChain["missing"] = [];

    const addNode = (node: TraceNode): TraceNode => {
      const key = nodeKey(node.type, node.id);
      if (!nodes.has(key)) nodes.set(key, node);
      return nodes.get(key)!;
    };
    const link = (
      from: { type: TraceNodeType; id: string },
      to: { type: TraceNodeType; id: string },
      relationship: string
    ): void => {
      const exists = edges.some(
        (edge) =>
          edge.from === from.type && edge.fromId === from.id &&
          edge.to === to.type && edge.toId === to.id
      );
      if (!exists) {
        edges.push({
          from: from.type, fromId: from.id, to: to.type, toId: to.id, relationship
        });
      }
    };

    // Resolve the anchor and walk the whole chain from whichever end we start at.
    let customerId: string | null = null;
    let branchId: string | null = null;
    let anchorNode: TraceNode | null = null;

    if (type === "payment") {
      const payment = await db.query<Record<string, unknown>>(
        `SELECT p.id, p.provider, p.provider_txn_ref, p.amount, p.status, p.received_at,
                p.customer_id, p.branch_id, p.virtual_account_id, p.webhook_event_id
           FROM payments p WHERE p.id=$1`,
        [id]
      );
      if ((payment.rowCount ?? 0) === 0) throw AppError.notFound("Payment not found");
      const p = payment.rows[0]!;
      customerId = String(p.customer_id);
      branchId = String(p.branch_id);
      anchorNode = addNode({
        type: "payment",
        id,
        label: `${p.provider} ${p.provider_txn_ref}`,
        detail: {
          amount: p.amount,
          status: p.status,
          received_at: (p.received_at as Date).toISOString()
        }
      });
      if (p.virtual_account_id) {
        link({ type: "payment", id }, { type: "virtual_account", id: String(p.virtual_account_id) },
          "payment received into virtual account");
      }
      if (p.webhook_event_id) {
        link({ type: "payment", id }, { type: "webhook", id: String(p.webhook_event_id) },
          "recorded from verified webhook");
      }
    } else if (type === "webhook") {
      const event = await db.query<Record<string, unknown>>(
        `SELECT id, provider, event_type, provider_event_id, signature_valid, received_at,
                company_id, branch_id
           FROM webhook_events WHERE id=$1`,
        [id]
      );
      if ((event.rowCount ?? 0) === 0) throw AppError.notFound("Webhook event not found");
      const e = event.rows[0]!;
      anchorNode = addNode({
        type: "webhook",
        id,
        label: `${e.provider} ${e.event_type}`,
        detail: {
          provider_event_id: e.provider_event_id,
          signature_valid: e.signature_valid,
          received_at: (e.received_at as Date).toISOString()
        }
      });
      const payments = await db.query<{ id: string; customer_id: string; branch_id: string }>(
        `SELECT id, customer_id, branch_id FROM payments WHERE webhook_event_id=$1`,
        [id]
      );
      for (const payment of payments.rows) {
        link({ type: "webhook", id }, { type: "payment", id: payment.id },
          "webhook produced payment");
        customerId ??= payment.customer_id;
        branchId ??= payment.branch_id;
      }
      if ((payments.rowCount ?? 0) === 0) {
        missing.push({
          type: "payment",
          id,
          reason: "no payment was produced from this webhook (rejected, duplicate or unmatched)"
        });
      }
    } else if (type === "virtual_account" || type === "customer") {
      if (type === "customer") {
        const found = await db.query<{ id: string }>(`SELECT id FROM customers WHERE id=$1`, [id]);
        if ((found.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
        customerId = found.rows[0]!.id;
      } else {
        const found = await db.query<{ customer_id: string }>(
          `SELECT customer_id FROM virtual_accounts WHERE id=$1`, [id]
        );
        if ((found.rowCount ?? 0) === 0) throw AppError.notFound("Virtual account not found");
        customerId = found.rows[0]!.customer_id;
      }
    } else if (type === "loan") {
      const loan = await db.query<{ customer_id: string; branch_id: string }>(
        `SELECT customer_id, branch_id FROM loans WHERE id=$1`, [id]
      );
      if ((loan.rowCount ?? 0) === 0) throw AppError.notFound("Loan not found");
      customerId = loan.rows[0]!.customer_id;
      branchId = loan.rows[0]!.branch_id;
    } else if (type === "schedule_row") {
      const row = await db.query<{ loan_id: string }>(
        `SELECT loan_id FROM repayment_schedule_rows WHERE id=$1`, [id]
      );
      if ((row.rowCount ?? 0) === 0) throw AppError.notFound("Schedule row not found");
      const loan = await db.query<{ customer_id: string; branch_id: string }>(
        `SELECT customer_id, branch_id FROM loans WHERE id=$1`, [row.rows[0]!.loan_id]
      );
      customerId = loan.rows[0]!.customer_id;
      branchId = loan.rows[0]!.branch_id;
    } else if (type === "allocation") {
      const allocation = await db.query<{ payment_id: string; loan_id: string | null; schedule_row_id: string | null }>(
        `SELECT payment_id, loan_id, schedule_row_id FROM payment_allocations WHERE id=$1`, [id]
      );
      if ((allocation.rowCount ?? 0) === 0) throw AppError.notFound("Allocation not found");
      const payment = await db.query<{ customer_id: string; branch_id: string }>(
        `SELECT customer_id, branch_id FROM payments WHERE id=$1`, [allocation.rows[0]!.payment_id]
      );
      customerId = payment.rows[0]!.customer_id;
      branchId = payment.rows[0]!.branch_id;
    } else if (type === "journal_entry") {
      const entry = await db.query<{ company_id: string; payment_id: string | null }>(
        `SELECT company_id, payment_id FROM journal_entries WHERE id=$1`, [id]
      );
      if ((entry.rowCount ?? 0) === 0) throw AppError.notFound("Journal entry not found");
      if (entry.rows[0]!.payment_id) {
        const payment = await db.query<{ customer_id: string; branch_id: string }>(
          `SELECT customer_id, branch_id FROM payments WHERE id=$1`, [entry.rows[0]!.payment_id]
        );
        customerId = payment.rows[0]!.customer_id;
        branchId = payment.rows[0]!.branch_id;
      }
    } else if (type === "branch") {
      // A branch is a real node, but the chain is a per-customer chain. The
      // anchor therefore resolves to the branch's most recent loan-bearing
      // customer and the selection is stated in the detail, so the walk starts
      // from a real customer rather than an invented branch-level aggregate.
      const branch = await db.query<{ id: string; name: string; code: string }>(
        `SELECT id, name, code FROM branches WHERE id=$1`, [id]
      );
      if ((branch.rowCount ?? 0) === 0) throw AppError.notFound("Branch not found");
      const subject = await db.query<{ customer_id: string }>(
        `SELECT l.customer_id FROM loans l
          WHERE l.branch_id=$1
          ORDER BY l.disbursed_at DESC
          LIMIT 1`,
        [id]
      );
      if ((subject.rowCount ?? 0) === 0) {
        throw AppError.notFound("This branch has no loan-bearing customer to trace");
      }
      customerId = subject.rows[0]!.customer_id;
      branchId = id;
      anchorNode = addNode({
        type: "branch",
        id,
        label: `${branch.rows[0]!.name} (${branch.rows[0]!.code})`,
        detail: {
          code: branch.rows[0]!.code,
          selection: "most recent loan-bearing customer in this branch"
        }
      });
    } else if (type === "collection_officer") {
      const officer = await db.query<{ id: string; first_name: string; middle_name: string | null; last_name: string }>(
        `SELECT id, first_name, middle_name, last_name FROM users WHERE id=$1`, [id]
      );
      if ((officer.rowCount ?? 0) === 0) throw AppError.notFound("Collection officer not found");
      const assigned = await db.query<{ customer_id: string }>(
        `SELECT ca.customer_id FROM customer_assignments ca
          WHERE ca.staff_id=$1 AND ca.status='active'
          ORDER BY ca.assigned_at DESC
          LIMIT 1`,
        [id]
      );
      if ((assigned.rowCount ?? 0) === 0) {
        throw AppError.notFound("This officer has no active customer assignment to trace");
      }
      customerId = assigned.rows[0]!.customer_id;
      anchorNode = addNode({
        type: "collection_officer",
        id,
        label: labelOf([officer.rows[0] as unknown as Record<string, unknown>]),
        detail: { selection: "most recent active customer assignment" }
      });
    } else if (type === "audit_entry") {
      const audit = await db.query<{ id: string; action: string; entity_type: string; entity_id: string }>(
        `SELECT id, action, entity_type, entity_id FROM audit_logs WHERE id=$1`, [id]
      );
      if ((audit.rowCount ?? 0) === 0) throw AppError.notFound("Audit entry not found");
      const entry = audit.rows[0]!;
      const subject = await db.query<{ customer_id: string }>(
        `SELECT c.id AS customer_id FROM customers c WHERE c.id=$1
         UNION ALL SELECT l.customer_id FROM loans l WHERE l.id=$1
         UNION ALL SELECT a.customer_id FROM loan_applications a WHERE a.id=$1
         LIMIT 1`,
        [entry.entity_id]
      );
      if ((subject.rowCount ?? 0) === 0) {
        throw AppError.notFound("This audit entry does not point at a traced customer record");
      }
      customerId = subject.rows[0]!.customer_id;
      anchorNode = addNode({
        type: "audit_entry",
        id,
        label: entry.action,
        detail: { entity_type: entry.entity_type, entity_id: entry.entity_id }
      });
    } else {
      throw AppError.badRequest(`Unsupported traceability node type: ${type}`);
    }

    if (!customerId) {
      throw AppError.badRequest("This node is not linked to a customer record");
    }

    // Customer
    const customerRows = await db.query<Record<string, unknown>>(
      `SELECT id, customer_code, first_name, middle_name, last_name, status, branch_id
         FROM customers WHERE id=$1`,
      [customerId]
    );
    if ((customerRows.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    const customer = customerRows.rows[0]!;
    branchId ??= String(customer.branch_id);
    const customerNode = addNode({
      type: "customer",
      id: customerId,
      label: `${labelOf(customerRows.rows)} (${customer.customer_code})`,
      detail: { status: customer.status }
    });
    if (anchorNode && nodeKey(anchorNode.type, anchorNode.id) !== nodeKey("customer", customerId)) {
      link(customerNode, { type: anchorNode.type, id: anchorNode.id }, "customer is the counterparty");
    }

    // Virtual accounts
    const accounts = await db.query<{
      id: string; provider: string; bank_name: string; account_number: string; status: string;
    }>(
      `SELECT id, provider, bank_name, account_number, status
         FROM virtual_accounts WHERE customer_id=$1 ORDER BY created_at`,
      [customerId]
    );
    for (const account of accounts.rows) {
      const accountNode = addNode({
        type: "virtual_account",
        id: account.id,
        label: `${account.bank_name} ${account.account_number}`,
        detail: { provider: account.provider, status: account.status }
      });
      link(customerNode, { type: "virtual_account", id: account.id },
        "customer pays into virtual account");
    }

    // Loans and schedule rows
    const loans = await db.query<{
      id: string; principal_amount: string; outstanding_principal: string; status: string;
      disbursed_at: Date; application_id: string;
    }>(
      `SELECT id, application_id, principal_amount, outstanding_principal, status, disbursed_at
         FROM loans WHERE customer_id=$1 ORDER BY disbursed_at`,
      [customerId]
    );
    for (const loan of loans.rows) {
      const loanNode = addNode({
        type: "loan",
        id: loan.id,
        label: `Loan ${loan.principal_amount}`,
        detail: {
          status: loan.status,
          outstanding_principal: loan.outstanding_principal,
          disbursed_at: loan.disbursed_at.toISOString()
        }
      });
      link(customerNode, { type: "loan", id: loan.id }, "customer holds loan");
      const schedule = await db.query<{
        id: string; cycle_number: number; due_date: string; expected_repayment: string;
        actual_repayment: string; actual_savings: string; paid_at: Date | null;
      }>(
        `SELECT id, cycle_number, to_char(due_date,'YYYY-MM-DD') AS due_date,
                expected_repayment, actual_repayment, actual_savings, paid_at
           FROM repayment_schedule_rows WHERE loan_id=$1 ORDER BY cycle_number`,
        [loan.id]
      );
      for (const row of schedule.rows) {
        const scheduleNode = addNode({
          type: "schedule_row",
          id: row.id,
          label: `Cycle ${row.cycle_number} due ${row.due_date}`,
          detail: {
            expected_repayment: row.expected_repayment,
            actual_repayment: row.actual_repayment,
            actual_savings: row.actual_savings,
            paid_at: row.paid_at?.toISOString() ?? null
          }
        });
        link({ type: "loan", id: loan.id }, { type: "schedule_row", id: row.id },
          "loan has repayment schedule");
      }
    }

    // Payments, webhook, allocations, ledger
    const payments = await db.query<{
      id: string; provider: string; provider_txn_ref: string; amount: string; status: string;
      received_at: Date; webhook_event_id: string | null; virtual_account_id: string | null;
    }>(
      `SELECT id, provider, provider_txn_ref, amount, status, received_at,
              webhook_event_id, virtual_account_id
         FROM payments WHERE customer_id=$1 ORDER BY received_at`,
      [customerId]
    );
    for (const payment of payments.rows) {
      const paymentNode = addNode({
        type: "payment",
        id: payment.id,
        label: `${payment.provider} ${payment.provider_txn_ref}`,
        detail: { amount: payment.amount, status: payment.status,
          received_at: payment.received_at.toISOString() }
      });
      link(customerNode, { type: "payment", id: payment.id }, "customer paid");
      if (payment.webhook_event_id) {
        const webhook = await db.query<{
          id: string; provider: string; event_type: string; signature_valid: boolean;
        }>(
          `SELECT id, provider, event_type, signature_valid FROM webhook_events WHERE id=$1`,
          [payment.webhook_event_id]
        );
        if ((webhook.rowCount ?? 0) > 0) {
          const w = webhook.rows[0]!;
          const webhookNode = addNode({
            type: "webhook",
            id: w.id,
            label: `${w.provider} ${w.event_type}`,
            detail: { signature_valid: w.signature_valid }
          });
          link({ type: "webhook", id: w.id }, { type: "payment", id: payment.id },
            "webhook produced payment");
        }
      }
      if (payment.virtual_account_id) {
        link({ type: "payment", id: payment.id },
          { type: "virtual_account", id: payment.virtual_account_id },
          "received into virtual account");
      }

      const allocations = await db.query<{
        id: string; loan_id: string | null; schedule_row_id: string | null;
        repayment_amount: string; savings_amount: string;
      }>(
        `SELECT id, loan_id, schedule_row_id, repayment_amount, savings_amount
           FROM payment_allocations WHERE payment_id=$1`,
        [payment.id]
      );
      for (const allocation of allocations.rows) {
        const allocationNode = addNode({
          type: "allocation",
          id: allocation.id,
          label: `Allocation ${allocation.repayment_amount} + ${allocation.savings_amount}`,
          detail: {
            repayment_amount: allocation.repayment_amount,
            savings_amount: allocation.savings_amount,
            schedule_row_id: allocation.schedule_row_id
          }
        });
        link({ type: "payment", id: payment.id }, { type: "allocation", id: allocation.id },
          "C.O. allocated verified payment");
        if (allocation.loan_id) {
          link({ type: "allocation", id: allocation.id }, { type: "loan", id: allocation.loan_id },
            "allocation applied to loan");
        }
        if (allocation.schedule_row_id) {
          link({ type: "allocation", id: allocation.id },
            { type: "schedule_row", id: allocation.schedule_row_id },
            "allocation applied to schedule row");
        }
      }

      const journal = await db.query<{ id: string; description: string; entry_date: string }>(
        `SELECT id, description, to_char(entry_date,'YYYY-MM-DD') AS entry_date
           FROM journal_entries WHERE payment_id=$1`,
        [payment.id]
      );
      for (const entry of journal.rows) {
        const journalNode = addNode({
          type: "journal_entry",
          id: entry.id,
          label: entry.description,
          detail: { entry_date: entry.entry_date }
        });
        link({ type: "payment", id: payment.id }, { type: "journal_entry", id: entry.id },
          "payment written to the ledger");
      }
    }

    // Disbursement ledger entries (system-sourced, no payment behind them)
    if (customerId) {
      const systemEntries = await db.query<{ id: string; description: string; entry_date: string }>(
        `SELECT id, description, to_char(entry_date,'YYYY-MM-DD') AS entry_date
           FROM journal_entries
          WHERE payment_id IS NULL
            AND description LIKE $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [`%${customerId}%`]
      );
      for (const entry of systemEntries.rows) {
        addNode({
          type: "journal_entry",
          id: entry.id,
          label: entry.description,
          detail: { entry_date: entry.entry_date, source: "system" }
        });
      }
    }

    // Branch and the responsible collection officer
    if (branchId) {
      const branch = await db.query<{ id: string; name: string; code: string }>(
        `SELECT id, name, code FROM branches WHERE id=$1`, [branchId]
      );
      if ((branch.rowCount ?? 0) > 0) {
        const b = branch.rows[0]!;
        const branchNode = addNode({
          type: "branch",
          id: b.id,
          label: `${b.name} (${b.code})`,
          detail: { code: b.code }
        });
        link(customerNode, branchNode, "customer is served by this branch");
      }
      const officers = await db.query<{
        id: string; first_name: string; middle_name: string | null; last_name: string;
      }>(
        `SELECT u.id, u.first_name, u.middle_name, u.last_name
           FROM customer_assignments ca
           JOIN users u ON u.id = ca.staff_id
          WHERE ca.customer_id=$1 AND ca.branch_id=$2 AND ca.status='active'`,
        [customerId, branchId]
      );
      for (const officer of officers.rows) {
        const officerNode = addNode({
          type: "collection_officer",
          id: officer.id,
          label: labelOf([officer as unknown as Record<string, unknown>]),
          detail: { assignment: "active" }
        });
        link(officerNode, customerNode, "collection officer is assigned to this customer");
      }
    }

    // Audit trail
    const audits = await db.query<{
      id: string; action: string; entity_type: string; entity_id: string; created_at: Date;
    }>(
      `SELECT id, action, entity_type, entity_id, created_at
         FROM audit_logs
        WHERE (entity_type='customers' AND entity_id=$1)
           OR (entity_type='loans' AND entity_id = ANY(
                 COALESCE((SELECT array_agg(id::text)::uuid[] FROM loans WHERE customer_id=$1), '{}'::uuid[])))
           OR (entity_type='loan_applications' AND entity_id = ANY(
                 COALESCE((SELECT array_agg(application_id::text)::uuid[] FROM loans WHERE customer_id=$1), '{}'::uuid[])))
        ORDER BY created_at DESC
        LIMIT 100`,
      [customerId]
    );
    // Every audit node is joined to the record it actually audited, so the
    // chain can be walked into the audit trail and back out again.
    const loanNodeById = new Map(
      loans.rows.map((loan) => [loan.id, { type: "loan" as const, id: loan.id }])
    );
    // An application audit entry is reached through the loan the application
    // produced, which is a real relationship in the data.
    const loanNodeByApplicationId = new Map(
      loans.rows.map((loan) => [loan.application_id, { type: "loan" as const, id: loan.id }])
    );
    for (const audit of audits.rows) {
      const auditNode = addNode({
        type: "audit_entry",
        id: audit.id,
        label: audit.action,
        detail: {
          entity_type: audit.entity_type,
          recorded_at: audit.created_at.toISOString()
        }
      });
      if (audit.entity_type === "customers" && audit.entity_id === customerId) {
        link(auditNode, customerNode, "audit entry records a change to this customer");
      } else if (audit.entity_type === "loans") {
        const subject = loanNodeById.get(audit.entity_id);
        if (subject) {
          link(subject, auditNode, "audit entry records a change to this loan");
        }
      } else if (audit.entity_type === "loan_applications") {
        const subject = loanNodeByApplicationId.get(audit.entity_id);
        if (subject) {
          link(subject, auditNode, "audit entry records a change to this application");
        }
      }
    }

    if (anchorNode) addNode(anchorNode);

    return {
      anchor: { type, id },
      nodes: [...nodes.values()],
      edges,
      complete: missing.length === 0,
      missing
    };
  });
}
