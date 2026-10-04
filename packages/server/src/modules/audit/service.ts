// Tenant Audit Trail (Part 1 §25): read-only explorer over audit_logs.
//
// audit_logs is append-only (migration 0009 revokes UPDATE/DELETE from the
// app role), so this module only lists and reads. Every financial entry
// carries payment_id and/or transaction_ref (the provider/webhook reference),
// which is what makes the Part 1 §25 traceability chain navigable by rows,
// not by string-guessing.
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

export interface AuditActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface AuditEntry {
  id: string;
  branchId: string | null;
  actorUserId: string | null;
  actorUsername: string | null;
  actorName: string | null;
  roleUsed: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  previousValue: unknown;
  newValue: unknown;
  reason: string | null;
  paymentId: string | null;
  transactionRef: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface AuditListFilter {
  actorUserId?: string | null;
  branchId?: string | null;
  action?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  transactionRef?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

interface AuditRow {
  id: string;
  branch_id: string | null;
  actor_user_id: string | null;
  username: string | null;
  actor_name: string | null;
  role_used: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  previous_value: unknown;
  new_value: unknown;
  reason: string | null;
  payment_id: string | null;
  transaction_ref: string | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: Date;
}

function toEntry(r: AuditRow): AuditEntry {
  return {
    id: r.id,
    branchId: r.branch_id,
    actorUserId: r.actor_user_id,
    actorUsername: r.username,
    actorName: r.actor_name,
    roleUsed: r.role_used,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    previousValue: r.previous_value,
    newValue: r.new_value,
    reason: r.reason,
    paymentId: r.payment_id,
    transactionRef: r.transaction_ref,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    requestId: r.request_id,
    createdAt: r.created_at.toISOString()
  };
}

// The full Part 1 §25 field set plus the actor's display identity. Kept in
// one place so list and detail always agree on shape.
const AUDIT_SELECT = `
  SELECT al.id, al.branch_id, al.actor_user_id, u.username,
         (u.first_name || ' ' || COALESCE(u.last_name, '')) AS actor_name,
         al.role_used, al.action, al.entity_type, al.entity_id,
         al.previous_value, al.new_value, al.reason, al.payment_id,
         al.transaction_ref, al.ip_address, al.user_agent, al.request_id,
         al.created_at
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.actor_user_id`;

export async function listAuditEntries(
  actor: AuditActor,
  filter: AuditListFilter = {}
): Promise<{ items: AuditEntry[]; total: number }> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);

  const conditions: string[] = [];
  const params: unknown[] = [];
  const push = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(`al.${sql}=$${params.length}`);
  };

  if (filter.actorUserId) push("actor_user_id", filter.actorUserId);
  if (filter.branchId) push("branch_id", filter.branchId);
  if (filter.action) push("action", filter.action);
  if (filter.entityType) push("entity_type", filter.entityType);
  if (filter.entityId) push("entity_id", filter.entityId);
  if (filter.transactionRef) {
    params.push(`%${filter.transactionRef}%`);
    conditions.push(`al.transaction_ref ILIKE $${params.length}`);
  }
  if (filter.from) {
    const t = new Date(filter.from);
    if (Number.isNaN(t.getTime())) throw AppError.unprocessable("invalid from date");
    params.push(t.toISOString());
    conditions.push(`al.created_at >= $${params.length}`);
  }
  if (filter.to) {
    const t = new Date(filter.to);
    if (Number.isNaN(t.getTime())) throw AppError.unprocessable("invalid to date");
    params.push(t.toISOString());
    conditions.push(`al.created_at <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const total = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs al ${where}`, params
    );
    params.push(limit); params.push(offset);
    const items = await db.query<AuditRow>(
      `${AUDIT_SELECT} ${where}
        ORDER BY al.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return {
      items: items.rows.map(toEntry),
      total: parseInt(total.rows[0]?.count ?? "0", 10)
    };
  });
}

export async function getAuditEntry(
  actor: AuditActor,
  entryId: string
): Promise<AuditEntry | null> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<AuditRow>(
      `${AUDIT_SELECT} WHERE al.id=$1`,
      [entryId]
    );
    return (r.rowCount ?? 0) === 0 ? null : toEntry(r.rows[0]!);
  });
}