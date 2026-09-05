// Stage 7B - Group management (Part 2 Section 27).
// Groups are branch-level convenience wrappers for field operations
// (collection rounds, reporting). They have NO financial balance or
// ledger - every loan, savings, and payment is individually owned by
// the customer. Closing or renaming a group never affects its members'
// individual records.
import type pg from "pg";
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

export interface GroupActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface CreateGroupInput {
  branchId: string;
  name: string;
  description?: string | null;
}

export interface GroupRow {
  id: string;
  branch_id: string;
  name: string;
  description: string | null;
  status: string;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  member_count?: number;
}

export interface GroupMemberRow {
  customer_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  customer_code: string;
  status: string;
  joined_at: Date;
}

async function auditGroup(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  actorUserId: string,
  action: string,
  groupId: string,
  previousValue: unknown,
  newValue: unknown,
  reason: string | null,
  meta: ActorMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,'groups',$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
    [
      companyId,
      branchId,
      actorUserId,
      action,
      groupId,
      previousValue === undefined ? null : JSON.stringify(previousValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      reason,
      meta.ip ?? null,
      meta.userAgent ?? null,
      meta.requestId ?? null,
    ]
  );
}
export async function createGroup(
  actor: GroupActor,
  input: CreateGroupInput,
  meta: ActorMeta = {}
): Promise<GroupRow> {
  if (!input.name || input.name.trim().length < 2 || input.name.trim().length > 100) {
    throw AppError.unprocessable("name must be between 2 and 100 characters");
  }
  if (!input.branchId) throw AppError.unprocessable("branchId is required");

  if (actor.branchId !== null && actor.branchId !== input.branchId) {
    throw AppError.forbidden(
      "A branch-scoped session cannot create groups in a different branch"
    );
  }

  return withTenant(actor.companyId, input.branchId, async (db) => {
    const b = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE id=$1`,
      [input.branchId]
    );
    if ((b.rowCount ?? 0) === 0) throw AppError.notFound("Branch not found");

    const inserted = await db.query<GroupRow>(
      `INSERT INTO groups (company_id, branch_id, name, description, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, branch_id, name, description, status, closed_at, created_at, updated_at`,
      [
        actor.companyId, input.branchId, input.name.trim(),
        input.description ?? null, actor.sub,
      ]
    );
    const group = inserted.rows[0]!;

    await auditGroup(
      db, actor.companyId, input.branchId, actor.sub,
      "group.created", group.id, null,
      { name: group.name, branch_id: group.branch_id, status: "active" },
      null, meta
    );
    return group;
  });
}

export async function getGroup(
  actor: GroupActor,
  groupId: string
): Promise<GroupRow> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<GroupRow>(
      `SELECT g.id, g.branch_id, g.name, g.description, g.status,
              g.closed_at, g.created_at, g.updated_at,
              (SELECT count(*)::int FROM group_members WHERE group_id=g.id) AS member_count
         FROM groups g WHERE g.id=$1`,
      [groupId]
    );
    if ((r.rowCount ?? 0) === 0) throw AppError.notFound("Group not found");
    return r.rows[0]!;
  });
}

export interface ListGroupsInput {
  branchId?: string | null;
  status?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function listGroups(
  actor: GroupActor,
  input: ListGroupsInput = {}
): Promise<{ items: GroupRow[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (input.branchId) {
      params.push(input.branchId);
      conditions.push(`g.branch_id=$${params.length}`);
    }
    if (input.status) {
      if (!["active", "closed"].includes(input.status)) {
        throw AppError.unprocessable("invalid status");
      }
      params.push(input.status);
      conditions.push(`g.status=$${params.length}`);
    }
    if (input.search) {
      params.push(`%${input.search}%`);
      const i = params.length;
      conditions.push(`g.name ILIKE $${i}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalRow = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM groups g ${where}`,
      params
    );
    params.push(limit);
    params.push(offset);
    const items = await db.query<GroupRow>(
      `SELECT g.id, g.branch_id, g.name, g.description, g.status,
              g.closed_at, g.created_at, g.updated_at,
              (SELECT count(*)::int FROM group_members WHERE group_id=g.id) AS member_count
         FROM groups g ${where}
         ORDER BY g.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: parseInt(totalRow.rows[0]?.count ?? "0", 10) };
  });
}

export interface RenameGroupInput {
  groupId: string;
  name: string;
  description?: string | null;
  reason?: string | null;
}

export async function renameGroup(
  actor: GroupActor,
  input: RenameGroupInput,
  meta: ActorMeta = {}
): Promise<GroupRow> {
  if (!input.name || input.name.trim().length < 2 || input.name.trim().length > 100) {
    throw AppError.unprocessable("name must be between 2 and 100 characters");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const existing = await db.query<GroupRow>(
      `SELECT id, branch_id, name, description, status, closed_at, created_at, updated_at
         FROM groups WHERE id=$1 FOR UPDATE`,
      [input.groupId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Group not found");
    const prev = existing.rows[0]!;
    if (prev.status === "closed") {
      throw AppError.conflict("Cannot rename a closed group");
    }
    const updated = await db.query<GroupRow>(
      `UPDATE groups
          SET name=$2, description=$3
        WHERE id=$1
        RETURNING id, branch_id, name, description, status, closed_at, created_at, updated_at`,
      [input.groupId, input.name.trim(), input.description ?? null]
    );
    const next = updated.rows[0]!;
    await auditGroup(
      db, actor.companyId, next.branch_id, actor.sub,
      "group.renamed", input.groupId,
      { name: prev.name, description: prev.description },
      { name: next.name, description: next.description },
      input.reason ?? null, meta
    );
    return next;
  });
}

export async function closeGroup(
  actor: GroupActor,
  groupId: string,
  reason: string,
  meta: ActorMeta = {}
): Promise<GroupRow> {
  if (!reason || reason.trim().length === 0) {
    throw AppError.unprocessable("reason is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const existing = await db.query<GroupRow>(
      `SELECT id, branch_id, name, description, status, closed_at, created_at, updated_at
         FROM groups WHERE id=$1 FOR UPDATE`,
      [groupId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Group not found");
    const prev = existing.rows[0]!;
    if (prev.status === "closed") throw AppError.conflict("Group is already closed");

    // Per Part 2 Section 27: closing a group does NOT affect its
    // members' individual records. Members remain untouched.
    const memberCount = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM group_members WHERE group_id=$1`,
      [groupId]
    );

    const updated = await db.query<GroupRow>(
      `UPDATE groups SET status='closed', closed_at=now() WHERE id=$1
        RETURNING id, branch_id, name, description, status, closed_at, created_at, updated_at`,
      [groupId]
    );
    const next = updated.rows[0]!;
    await auditGroup(
      db, actor.companyId, next.branch_id, actor.sub,
      "group.closed", groupId,
      { status: prev.status, members_remaining: parseInt(memberCount.rows[0]?.count ?? "0", 10) },
      { status: "closed", members_preserved: parseInt(memberCount.rows[0]?.count ?? "0", 10) },
      reason, meta
    );
    return next;
  });
}

export async function addGroupMember(
  actor: GroupActor,
  groupId: string,
  customerId: string,
  meta: ActorMeta = {}
): Promise<{ groupId: string; customerId: string; joinedAt: Date }> {
  // First, look up the group + customer at the company scope so that a
  // cross-branch customer lookup doesn't fail RLS silently as 404.
  // The actual write into group_members happens at branch scope.
  return withTenant(actor.companyId, null, async (db) => {
    const grp = await db.query<{ id: string; status: string; branch_id: string }>(
      `SELECT id, status, branch_id FROM groups WHERE id=$1`,
      [groupId]
    );
    if ((grp.rowCount ?? 0) === 0) throw AppError.notFound("Group not found");
    if (grp.rows[0]!.status === "closed") {
      throw AppError.conflict("Cannot add members to a closed group");
    }
    const group = grp.rows[0]!;

    const cust = await db.query<{ id: string; branch_id: string; status: string }>(
      `SELECT id, branch_id, status FROM customers WHERE id=$1`,
      [customerId]
    );
    if ((cust.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    if (cust.rows[0]!.branch_id !== group.branch_id) {
      throw AppError.unprocessable("Customer must belong to the same branch as the group");
    }

    // Branch-scoped actor guard: a branch-restricted session can only
    // add members to groups within its own branch.
    if (actor.branchId !== null && actor.branchId !== group.branch_id) {
      throw AppError.forbidden(
        "A branch-scoped session cannot add members to a group in a different branch"
      );
    }

    const inserted = await db.query<{ joined_at: Date }>(
      `INSERT INTO group_members (group_id, customer_id, company_id, added_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (group_id, customer_id) DO NOTHING
       RETURNING joined_at`,
      [groupId, customerId, actor.companyId, actor.sub]
    );
    if ((inserted.rowCount ?? 0) === 0) {
      // Already a member - idempotent.
      const existing = await db.query<{ joined_at: Date }>(
        `SELECT joined_at FROM group_members WHERE group_id=$1 AND customer_id=$2`,
        [groupId, customerId]
      );
      return { groupId, customerId, joinedAt: existing.rows[0]!.joined_at };
    }
    const joinedAt = inserted.rows[0]!.joined_at;
    await auditGroup(
      db, actor.companyId, group.branch_id, actor.sub,
      "group.member_added", groupId,
      null,
      { customer_id: customerId },
      null, meta
    );
    return { groupId, customerId, joinedAt };
  });
}

export async function removeGroupMember(
  actor: GroupActor,
  groupId: string,
  customerId: string,
  meta: ActorMeta = {}
): Promise<{ groupId: string; customerId: string; removed: boolean }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const grp = await db.query<{ id: string; branch_id: string }>(
      `SELECT id, branch_id FROM groups WHERE id=$1`,
      [groupId]
    );
    if ((grp.rowCount ?? 0) === 0) throw AppError.notFound("Group not found");
    const group = grp.rows[0]!;

    const r = await db.query(
      `DELETE FROM group_members WHERE group_id=$1 AND customer_id=$2`,
      [groupId, customerId]
    );
    const removed = (r.rowCount ?? 0) > 0;
    if (removed) {
      await auditGroup(
        db, actor.companyId, group.branch_id, actor.sub,
        "group.member_removed", groupId,
        { customer_id: customerId },
        null, null, meta
      );
    }
    return { groupId, customerId, removed };
  });
}

export async function listGroupMembers(
  actor: GroupActor,
  groupId: string
): Promise<GroupMemberRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const grp = await db.query<{ id: string }>(
      `SELECT id FROM groups WHERE id=$1`,
      [groupId]
    );
    if ((grp.rowCount ?? 0) === 0) throw AppError.notFound("Group not found");

    const r = await db.query<GroupMemberRow>(
      `SELECT gm.customer_id, c.first_name, c.middle_name, c.last_name,
              c.customer_code, c.status, gm.joined_at
         FROM group_members gm
         JOIN customers c ON c.id = gm.customer_id
        WHERE gm.group_id=$1
        ORDER BY gm.joined_at`,
      [groupId]
    );
    return r.rows;
  });
}
