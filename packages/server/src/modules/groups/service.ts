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
  groupNumber: string;
  groupAddress: string;
  dateCreated: string;
  description?: string | null;
}

export interface GroupRow {
  id: string;
  branch_id: string;
  name: string;
  group_number: string;
  group_address: string;
  date_created: string;
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
  father_husband_name: string;
  marital_status: string;
  phone: string;
  group_role: string;
  joined_at: Date;
}

const GROUP_SELECT = `id, branch_id, name, group_number, group_address,
  to_char(date_created, 'YYYY-MM-DD') AS date_created,
  description, status, closed_at, created_at, updated_at`;

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
  if (!input.groupNumber || input.groupNumber.trim().length < 1 || input.groupNumber.trim().length > 80) {
    throw AppError.unprocessable("groupNumber is required and must be at most 80 characters");
  }
  if (!input.groupAddress || input.groupAddress.trim().length < 2 || input.groupAddress.trim().length > 300) {
    throw AppError.unprocessable("groupAddress is required and must be between 2 and 300 characters");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateCreated)) {
    throw AppError.unprocessable("dateCreated must be YYYY-MM-DD");
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
      `INSERT INTO groups (company_id, branch_id, name, group_number, group_address,
                            date_created, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${GROUP_SELECT}`,
      [
        actor.companyId, input.branchId, input.name.trim(), input.groupNumber.trim(),
        input.groupAddress.trim(), input.dateCreated, input.description ?? null, actor.sub,
      ]
    );
    const group = inserted.rows[0]!;

    await auditGroup(
      db, actor.companyId, input.branchId, actor.sub,
      "group.created", group.id, null,
      { name: group.name, group_number: group.group_number,
        group_address: group.group_address, date_created: group.date_created,
        branch_id: group.branch_id, status: "active" },
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
      `SELECT g.id, g.branch_id, g.name, g.group_number, g.group_address,
              to_char(g.date_created, 'YYYY-MM-DD') AS date_created,
              g.description, g.status, g.closed_at, g.created_at, g.updated_at,
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
      `SELECT g.id, g.branch_id, g.name, g.group_number, g.group_address,
              to_char(g.date_created, 'YYYY-MM-DD') AS date_created,
              g.description, g.status, g.closed_at, g.created_at, g.updated_at,
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
      `SELECT ${GROUP_SELECT} FROM groups WHERE id=$1 FOR UPDATE`,
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
        RETURNING ${GROUP_SELECT}`,
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
      `SELECT ${GROUP_SELECT} FROM groups WHERE id=$1 FOR UPDATE`,
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
        RETURNING ${GROUP_SELECT}`,
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

export interface AddGroupMemberInput {
  fullName: string;
  fatherHusbandName: string;
  maritalStatus: string;
  phone: string;
  groupRole: string;
}

export const DEFAULT_GROUP_ROLES = ["Leader", "Secretary", "Treasurer", "Chief Whip", "Member"];
export const DEFAULT_MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"];

async function ensureDefaultGroupOptions(db: pg.PoolClient, companyId: string): Promise<void> {
  await db.query(
    `INSERT INTO company_group_options (company_id, option_kind, option_value, sort_order)
     SELECT $1, v.kind, v.value, v.ord
       FROM (VALUES
         ('group_role','Leader',1),('group_role','Secretary',2),('group_role','Treasurer',3),
         ('group_role','Chief Whip',4),('group_role','Member',5),
         ('marital_status','Single',1),('marital_status','Married',2),
         ('marital_status','Divorced',3),('marital_status','Widowed',4)
       ) AS v(kind, value, ord)
      WHERE NOT EXISTS (
        SELECT 1 FROM company_group_options o
         WHERE o.company_id=$1 AND o.option_kind=v.kind
      )
     ON CONFLICT (company_id, option_kind, option_value) DO NOTHING`,
    [companyId]
  );
}

export async function listGroupOptions(
  actor: GroupActor
): Promise<{ groupRole: string[]; maritalStatus: string[] }> {
  return withTenant(actor.companyId, null, async (db) => {
    await ensureDefaultGroupOptions(db, actor.companyId);
    const { rows } = await db.query<{ option_kind: string; option_value: string }>(
      `SELECT option_kind, option_value FROM company_group_options
        WHERE company_id=$1 ORDER BY option_kind, sort_order, option_value`,
      [actor.companyId]
    );
    return {
      groupRole: rows.filter((r) => r.option_kind === "group_role").map((r) => r.option_value),
      maritalStatus: rows.filter((r) => r.option_kind === "marital_status").map((r) => r.option_value)
    };
  });
}

export async function replaceGroupOptions(
  actor: GroupActor,
  input: { groupRole: string[]; maritalStatus: string[] },
  meta: ActorMeta = {}
): Promise<{ groupRole: string[]; maritalStatus: string[] }> {
  const clean = (values: string[], label: string): string[] => {
    const trimmed = values.map((v) => v.trim()).filter((v) => v.length > 0);
    if (trimmed.length === 0) {
      throw AppError.unprocessable(`At least one ${label} option is required`);
    }
    if (new Set(trimmed.map((v) => v.toLowerCase())).size !== trimmed.length) {
      throw AppError.unprocessable(`Duplicate ${label} options are not allowed`);
    }
    return trimmed;
  };
  const groupRole = clean(input.groupRole ?? [], "group role");
  const maritalStatus = clean(input.maritalStatus ?? [], "marital status");

  return withTenant(actor.companyId, null, async (db) => {
    const previous = await db.query<{ option_kind: string; option_value: string }>(
      `SELECT option_kind, option_value FROM company_group_options WHERE company_id=$1`,
      [actor.companyId]
    );
    const inUse = await db.query<{ group_role: string; marital_status: string }>(
      `SELECT DISTINCT gm.group_role, gm.marital_status
         FROM group_members gm
        WHERE gm.company_id=$1`,
      [actor.companyId]
    );
    const missingRole = [...new Set(inUse.rows.map((r) => r.group_role))]
      .find((value) => !groupRole.includes(value));
    if (missingRole) {
      throw AppError.conflict(
        `Cannot remove the group role '${missingRole}' while members still hold it`
      );
    }
    const missingMarital = [...new Set(inUse.rows.map((r) => r.marital_status))]
      .find((value) => !maritalStatus.includes(value));
    if (missingMarital) {
      throw AppError.conflict(
        `Cannot remove the marital status '${missingMarital}' while members still hold it`
      );
    }

    await db.query(`DELETE FROM company_group_options WHERE company_id=$1`, [actor.companyId]);
    for (const [index, value] of groupRole.entries()) {
      await db.query(
        `INSERT INTO company_group_options (company_id, option_kind, option_value, sort_order)
         VALUES ($1,'group_role',$2,$3)`,
        [actor.companyId, value, index + 1]
      );
    }
    for (const [index, value] of maritalStatus.entries()) {
      await db.query(
        `INSERT INTO company_group_options (company_id, option_kind, option_value, sort_order)
         VALUES ($1,'marital_status',$2,$3)`,
        [actor.companyId, value, index + 1]
      );
    }
    await auditGroup(
      db,
      actor.companyId,
      actor.branchId ?? (await firstBranchId(db, actor.companyId)),
      actor.sub,
      "group.options_replaced",
      actor.companyId,
      previous.rows,
      { group_role: groupRole, marital_status: maritalStatus },
      "Company group options replaced",
      meta
    );
    return { groupRole, maritalStatus };
  });
}

async function firstBranchId(db: pg.PoolClient, companyId: string): Promise<string> {
  const row = await db.query<{ id: string }>(
    `SELECT id FROM branches WHERE company_id=$1 ORDER BY created_at LIMIT 1`,
    [companyId]
  );
  return row.rows[0]?.id ?? "";
}

export async function addGroupMember(
  actor: GroupActor,
  groupId: string,
  customerId: string,
  input: AddGroupMemberInput,
  meta: ActorMeta = {}
): Promise<{ groupId: string; customerId: string; joinedAt: Date; groupRole: string }> {
  if (!input.fullName?.trim()) throw AppError.unprocessable("fullName is required");
  if (!input.fatherHusbandName?.trim()) throw AppError.unprocessable("fatherHusbandName is required");
  if (!input.phone?.trim()) throw AppError.unprocessable("phone is required");

  return withTenant(actor.companyId, null, async (db) => {
    // RULE 19.1.4 — marital status and group role are selected from the
    // company's configured options, never free-typed.
    await ensureDefaultGroupOptions(db, actor.companyId);
    const options = await db.query<{ option_kind: string; option_value: string }>(
      `SELECT option_kind, option_value FROM company_group_options
        WHERE company_id=$1 AND option_kind IN ('group_role','marital_status')`,
      [actor.companyId]
    );
    const maritalOptions = options.rows
      .filter((row) => row.option_kind === "marital_status")
      .map((row) => row.option_value);
    const groupRoleOptions = options.rows
      .filter((row) => row.option_kind === "group_role")
      .map((row) => row.option_value);
    if (!maritalOptions.includes(input.maritalStatus)) {
      throw AppError.unprocessable(
        `maritalStatus must be one of the company's configured options: ${maritalOptions.join(", ")}`
      );
    }
    if (!groupRoleOptions.includes(input.groupRole)) {
      throw AppError.unprocessable(
        `groupRole must be one of the company's configured options: ${groupRoleOptions.join(", ")}`
      );
    }

    const grp = await db.query<{ id: string; status: string; branch_id: string }>(
      `SELECT id, status, branch_id FROM groups WHERE id=$1`,
      [groupId]
    );
    if ((grp.rowCount ?? 0) === 0) throw AppError.notFound("Group not found");
    if (grp.rows[0]!.status === "closed") {
      throw AppError.conflict("Cannot add members to a closed group");
    }
    const group = grp.rows[0]!;

    const cust = await db.query<{
      id: string;
      branch_id: string;
      status: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    }>(
      `SELECT id, branch_id, status, first_name, middle_name, last_name
         FROM customers WHERE id=$1`,
      [customerId]
    );
    if ((cust.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
    if (cust.rows[0]!.status !== "active") {
      throw AppError.conflict("Only an active customer can be added to a group");
    }
    const customerName = [cust.rows[0]!.first_name, cust.rows[0]!.middle_name, cust.rows[0]!.last_name]
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
    if (customerName !== input.fullName.replace(/\s+/g, " ").trim().toLowerCase()) {
      throw AppError.unprocessable("fullName does not match the customer record");
    }
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

    const inserted = await db.query<{ joined_at: Date; group_role: string }>(
      `INSERT INTO group_members (group_id, customer_id, company_id, added_by,
                                    father_husband_name, marital_status, phone, group_role,
                                    company_options_company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$3)
       ON CONFLICT (group_id, customer_id) DO NOTHING
       RETURNING joined_at, group_role`,
      [
        groupId, customerId, actor.companyId, actor.sub,
        input.fatherHusbandName.trim(), input.maritalStatus, input.phone.trim(), input.groupRole,
      ]
    );
    if ((inserted.rowCount ?? 0) === 0) {
      // Already a member - idempotent.
      const existing = await db.query<{ joined_at: Date; group_role: string }>(
        `SELECT joined_at, group_role FROM group_members WHERE group_id=$1 AND customer_id=$2`,
        [groupId, customerId]
      );
      return { groupId, customerId, joinedAt: existing.rows[0]!.joined_at, groupRole: existing.rows[0]!.group_role };
    }
    const joinedAt = inserted.rows[0]!.joined_at;
    await auditGroup(
      db, actor.companyId, group.branch_id, actor.sub,
      "group.member_added", groupId,
      null,
      { customer_id: customerId, full_name: input.fullName.trim(),
        father_husband_name: input.fatherHusbandName.trim(),
        marital_status: input.maritalStatus, phone: input.phone.trim(),
        group_role: input.groupRole },
      null, meta
    );
    return { groupId, customerId, joinedAt, groupRole: input.groupRole };
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

export interface GroupLedgerMemberRow {
  customer_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  customer_code: string;
  status: string;
  group_role: string;
  loan_id: string | null;
  loan_status: string | null;
  cycle_count: number | null;
  current_cycle: number;
  expected_repayment: string;
  actual_repayment: string;
  remaining_balance: string;
  savings_achieved: string;
  overdue: boolean;
}

export async function getGroupLedger(
  actor: GroupActor,
  groupId: string,
  from: string,
  to: string
): Promise<{ groupId: string; from: string; to: string; members: GroupLedgerMemberRow[] }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const group = await db.query<{ id: string }>(
      `SELECT id FROM groups WHERE id=$1`,
      [groupId]
    );
    if ((group.rowCount ?? 0) === 0) throw AppError.notFound("Group not found");
    const settings = await db.query<{ grace_days: number }>(
      `SELECT COALESCE(overdue_grace_days,0)::int AS grace_days
         FROM company_settings WHERE company_id=$1`,
      [actor.companyId]
    );
    const graceDays = settings.rows[0]?.grace_days ?? 0;
    const rows = await db.query<GroupLedgerMemberRow>(
      `SELECT c.id AS customer_id, c.first_name, c.middle_name, c.last_name,
              c.customer_code, c.status, gm.group_role,
              l.id AS loan_id, l.status AS loan_status, l.cycle_count,
              COALESCE((
                SELECT max(r.cycle_number)::int
                  FROM repayment_schedule_rows r
                 WHERE r.loan_id=l.id AND r.actual_repayment > 0
              ), 0)::int AS current_cycle,
              to_char(COALESCE(SUM(r.expected_repayment) FILTER (
                WHERE r.due_date BETWEEN $2::date AND $3::date
              ), 0), 'FM999999999999999990.00') AS expected_repayment,
              to_char(COALESCE(SUM(r.actual_repayment) FILTER (
                WHERE r.due_date BETWEEN $2::date AND $3::date
              ), 0), 'FM999999999999999990.00') AS actual_repayment,
              to_char(COALESCE(l.outstanding_principal, 0), 'FM999999999999999990.00') AS remaining_balance,
              to_char(COALESCE(SUM(r.actual_savings) FILTER (
                WHERE r.due_date BETWEEN $2::date AND $3::date
              ), 0), 'FM999999999999999990.00') AS savings_achieved,
              COALESCE((
                SELECT bool_or(
                  r.due_date < (current_date - ($4::int * interval '1 day'))
                  AND r.expected_repayment > r.actual_repayment
                )
                  FROM repayment_schedule_rows r
                 WHERE r.loan_id=l.id
              ), false) AS overdue
         FROM group_members gm
         JOIN customers c ON c.id=gm.customer_id
         LEFT JOIN LATERAL (
           SELECT l.id, l.status, l.cycle_count, l.outstanding_principal
             FROM loans l
            WHERE l.customer_id=c.id AND l.status IN ('active','overdue')
            ORDER BY l.disbursed_at DESC
            LIMIT 1
         ) l ON true
         LEFT JOIN repayment_schedule_rows r ON r.loan_id=l.id
        WHERE gm.group_id=$1
        GROUP BY c.id, c.first_name, c.middle_name, c.last_name, c.customer_code,
                 c.status, gm.group_role, l.id, l.status, l.cycle_count, l.outstanding_principal
        ORDER BY c.first_name, c.last_name`,
      [groupId, from, to, graceDays]
    );
    return { groupId, from, to, members: rows.rows };
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
              c.customer_code, c.status, gm.father_husband_name, gm.marital_status,
              gm.phone, gm.group_role, gm.joined_at
         FROM group_members gm
         JOIN customers c ON c.id = gm.customer_id
        WHERE gm.group_id=$1
        ORDER BY gm.joined_at`,
      [groupId]
    );
    return r.rows;
  });
}
