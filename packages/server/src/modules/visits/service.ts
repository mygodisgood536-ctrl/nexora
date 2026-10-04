import pg from "pg";
import { AppError } from "../../lib/errors";
import { withTenant } from "../../db/repo";

export interface VisitActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface CreateVisitInput {
  customerId?: string | null;
  groupId?: string | null;
  visitType: "visited" | "followed_up" | "other";
  note: string;
  visitedOn?: string | null;
}

export interface VisitRow {
  id: string;
  branch_id: string;
  worker_id: string;
  customer_id: string | null;
  group_id: string | null;
  visit_type: string;
  note: string;
  visited_on: Date;
  created_at: Date;
  customer_name: string | null;
  group_name: string | null;
}

async function auditVisit(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  actorUserId: string,
  action: string,
  entityId: string,
  newValue: unknown,
  note: string,
  meta: ActorMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,'worker_visits',$5,$6::jsonb,$7,$8,$9,$10)`,
    [
      companyId, branchId, actorUserId, action, entityId,
      newValue === undefined ? null : JSON.stringify(newValue),
      note,
      meta.ip ?? null, meta.userAgent ?? null, meta.requestId ?? null
    ]
  );
}

export async function createVisit(
  actor: VisitActor,
  input: CreateVisitInput,
  meta: ActorMeta = {}
): Promise<VisitRow> {
  if (!input.customerId && !input.groupId) {
    throw AppError.unprocessable("assign exactly one of customerId or groupId");
  }
  if (input.customerId && input.groupId) {
    throw AppError.unprocessable("assign exactly one of customerId or groupId");
  }
  if (!input.note || input.note.trim().length === 0) {
    throw AppError.unprocessable("note is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    let branchId: string;
    if (input.customerId) {
      const c = await db.query<{ id: string; branch_id: string }>(
        `SELECT id, branch_id FROM customers WHERE id=$1`, [input.customerId]
      );
      if ((c.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
      branchId = c.rows[0]!.branch_id;
    } else {
      const g = await db.query<{ id: string; branch_id: string }>(
        `SELECT id, branch_id FROM groups WHERE id=$1`, [input.groupId!]
      );
      if ((g.rowCount ?? 0) === 0) throw AppError.notFound("Group not found");
      branchId = g.rows[0]!.branch_id;
    }
    if (actor.branchId !== null && actor.branchId !== branchId) {
      throw AppError.forbidden("A branch-scoped session cannot log a visit outside its branch");
    }

    const visitedOn = input.visitedOn ? new Date(input.visitedOn) : new Date();
    const r = await db.query<VisitRow>(
      `INSERT INTO worker_visits (company_id, branch_id, worker_id, customer_id, group_id,
                                  visit_type, note, visited_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, branch_id, worker_id, customer_id, group_id,
                 visit_type, note, visited_on, created_at`,
      [
        actor.companyId, branchId, actor.sub,
        input.customerId ?? null, input.groupId ?? null,
        input.visitType, input.note.trim(), visitedOn
      ]
    );
    const visit = r.rows[0]!;
    await auditVisit(
      db, actor.companyId, branchId, actor.sub,
      "worker_visit.created", visit.id,
      {
        customer_id: input.customerId ?? null,
        group_id: input.groupId ?? null,
        visit_type: input.visitType,
        note: input.note.trim(),
        visited_on: visitedOn.toISOString()
      },
      `Visited ${input.customerId ? "customer" : "group"}`,
      meta
    );
    return visit;
  });
}

export interface ListVisitsInput {
  staffId?: string | null;
  customerId?: string | null;
  groupId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export async function listVisits(
  actor: VisitActor,
  input: ListVisitsInput = {}
): Promise<{ items: VisitRow[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.staffId) {
      params.push(input.staffId);
      conditions.push(`v.worker_id=$${params.length}`);
    }
    if (input.customerId) {
      params.push(input.customerId);
      conditions.push(`v.customer_id=$${params.length}`);
    }
    if (input.groupId) {
      params.push(input.groupId);
      conditions.push(`v.group_id=$${params.length}`);
    }
    if (input.from) {
      params.push(input.from);
      conditions.push(`v.visited_on >= $${params.length}`);
    }
    if (input.to) {
      params.push(input.to);
      conditions.push(`v.visited_on < ($${params.length}::timestamptz + interval '1 day')`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM worker_visits v ${where}`, params
    );
    params.push(limit);
    params.push(offset);
    const r = await db.query<VisitRow>(
      `SELECT v.id, v.branch_id, v.worker_id, v.customer_id, v.group_id,
              v.visit_type, v.note, v.visited_on, v.created_at,
              CONCAT(c.first_name, ' ', COALESCE(c.middle_name || ' ', ''), c.last_name) AS customer_name,
              g.name AS group_name
         FROM worker_visits v
         LEFT JOIN customers c ON c.id = v.customer_id
         LEFT JOIN groups g ON g.id = v.group_id
         ${where}
         ORDER BY v.visited_on DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: r.rows, total: parseInt(totalRow.rows[0]?.count ?? "0", 10) };
  });
}