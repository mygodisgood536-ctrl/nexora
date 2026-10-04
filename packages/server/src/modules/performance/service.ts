// Stage 7E — Performance service + collection-officer assignments
// (Part 1 §25-A/B/C; §25-B customer/group assignment scope).
//
// Read surface: everything returns the shared Performance Calculation Engine's
// output (engine.ts). Assignments are the only write surface here, and they
// are pure relationship metadata — they never carry a money figure, so a
// performance number can never change because an assignment edit went wrong.
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";
import type pg from "pg";
import {
  calculatePerformanceSet,
  listAssignedStaff,
  listPermittedBranches,
  type PerfScope,
  type PerformanceSet,
  type BranchPerformanceRow,
  type StaffPerformanceRow
} from "./engine";

export interface PerformanceActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface PerformanceQuery {
  from: string;
  to: string;
  branchId?: string | null;
  staffId?: string | null;
}

async function graceDays(db: pg.PoolClient, companyId: string): Promise<number> {
  const r = await db.query<{ overdue_grace_days: number }>(
    `SELECT overdue_grace_days FROM company_settings WHERE company_id=$1`,
    [companyId]
  );
  return r.rows[0]?.overdue_grace_days ?? 0;
}

function validateRange(from: string, to: string): void {
  if (from > to) {
    throw AppError.badRequest("from must not be after to");
  }
}

/**
 * Resolves the effective branch scope: the actor's own (restricted) branch
 * wins; an explicit branchId must match it. Mirrors Part 1 §25-C scope rules —
 * a single-branch session can never widen itself to another branch.
 */
function resolveBranch(actor: PerformanceActor, requested: string | null): string | null {
  if (requested && actor.branchId && requested !== actor.branchId) {
    throw AppError.forbidden(
      "A branch-scoped session cannot view another branch's performance"
    );
  }
  return actor.branchId ?? requested ?? null;
}

export async function getPerformanceSummary(
  actor: PerformanceActor,
  input: PerformanceQuery
): Promise<{
  period: { from: string; to: string };
  scope: { branchId: string | null; staffId: string | null };
  performance: PerformanceSet;
}> {
  validateRange(input.from, input.to);
  const branchId = resolveBranch(actor, input.branchId ?? null);
  const staffId = input.staffId ?? null;
  return withTenant(actor.companyId, branchId, async (db) => {
    const performance = await calculatePerformanceSet(db, {
      graceDays: await graceDays(db, actor.companyId),
      query: { from: input.from, to: input.to },
      scope: { branchId, staffId }
    });
    return {
      period: { from: input.from, to: input.to },
      scope: { branchId, staffId },
      performance
    };
  });
}

export async function getBranchPerformanceTable(
  actor: PerformanceActor,
  input: PerformanceQuery
): Promise<{
  period: { from: string; to: string };
  branches: BranchPerformanceRow[];
  total: PerformanceSet;
}> {
  validateRange(input.from, input.to);
  const branchId = resolveBranch(actor, input.branchId ?? null);
  return withTenant(actor.companyId, branchId, async (db) => {
    const permitted = await listPermittedBranches(db, actor.companyId);
    const shown = branchId
      ? permitted.filter((b) => b.branchId === branchId)
      : permitted;

    const branches: BranchPerformanceRow[] = [];
    for (const branch of shown) {
      branches.push({
        ...branch,
        collectionOfficers: await countActiveOfficers(db, branch.branchId),
        performance: await calculatePerformanceSet(db, {
          graceDays: await graceDays(db, actor.companyId),
          query: { from: input.from, to: input.to },
          scope: { branchId: branch.branchId }
        })
      });
    }

    // Scope Total row, per §25-B's reconciliation rule: it is computed by the
    // same engine over the same permitted book and therefore equals the sum
    // of the rows shown (guaranteed by construction — the engine never
    // derives totals independently).
    const total = await calculatePerformanceSet(db, {
      graceDays: await graceDays(db, actor.companyId),
      query: { from: input.from, to: input.to },
      scope: { branchId }
    });
    return { period: { from: input.from, to: input.to }, branches, total };
  });
}

async function countActiveOfficers(
  db: pg.PoolClient,
  branchId: string
): Promise<number> {
  const r = await db.query<{ count: string }>(
    `SELECT count(DISTINCT staff_id)::text AS count FROM customer_assignments
      WHERE branch_id=$1 AND status='active'`,
    [branchId]
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function getStaffPerformanceTable(
  actor: PerformanceActor,
  input: PerformanceQuery
): Promise<{
  period: { from: string; to: string };
  staff: StaffPerformanceRow[];
  total: PerformanceSet;
}> {
  validateRange(input.from, input.to);
  const branchId = resolveBranch(actor, input.branchId ?? null);
  return withTenant(actor.companyId, branchId, async (db) => {
    const base = await listAssignedStaff(db, actor.companyId, branchId);
    const staff: StaffPerformanceRow[] = [];
    for (const row of base) {
      staff.push({
        ...row,
        performance: await calculatePerformanceSet(db, {
          graceDays: await graceDays(db, actor.companyId),
          query: { from: input.from, to: input.to },
          scope: { staffId: row.staffId, branchId }
        })
      });
    }
    const total = await calculatePerformanceSet(db, {
      graceDays: await graceDays(db, actor.companyId),
      query: { from: input.from, to: input.to },
      scope: { branchId }
    });
    return { period: { from: input.from, to: input.to }, staff, total };
  });
}

// ---------------------------------------------------------------------------
// Collection Officer assignments
// ---------------------------------------------------------------------------

export interface CreateAssignmentInput {
  staffId: string;
  customerId?: string | null;
  groupId?: string | null;
}

export interface AssignmentRow {
  id: string;
  branchId: string;
  staffId: string;
  customerId: string | null;
  groupId: string | null;
  status: string;
  assignedAt: Date;
  endedAt: Date | null;
}

async function auditAssignment(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  actorUserId: string,
  action: string,
  assignmentId: string,
  previousValue: unknown,
  newValue: unknown,
  reason: string | null,
  meta: ActorMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,'customer_assignments',$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
    [
      companyId,
      branchId,
      actorUserId,
      action,
      assignmentId,
      previousValue === undefined ? null : JSON.stringify(previousValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      reason,
      meta.ip ?? null,
      meta.userAgent ?? null,
      meta.requestId ?? null
    ]
  );
}

export async function createAssignment(
  actor: PerformanceActor,
  input: CreateAssignmentInput,
  meta: ActorMeta = {}
): Promise<AssignmentRow> {
  if (!input.staffId) throw AppError.unprocessable("staffId is required");
  if (!input.customerId && !input.groupId) {
    throw AppError.unprocessable("assign exactly one of customerId or groupId");
  }
  if (input.customerId && input.groupId) {
    throw AppError.unprocessable("assign exactly one of customerId or groupId");
  }

  // Resolve the target's branch at company scope (a cross-branch lookup must
  // not fail RLS as a silent 404), then enforce the branch-scope guard.
  return withTenant(actor.companyId, null, async (db) => {
    const staff = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM users WHERE id=$1`,
      [input.staffId]
    );
    if ((staff.rowCount ?? 0) === 0) throw AppError.notFound("Worker not found");
    if (staff.rows[0]!.status !== "active") {
      throw AppError.unprocessable("Only active workers can be assigned");
    }

    let branchId: string | null = null;
    if (input.customerId) {
      const c = await db.query<{ id: string; branch_id: string; status: string }>(
        `SELECT id, branch_id, status FROM customers WHERE id=$1`,
        [input.customerId]
      );
      if ((c.rowCount ?? 0) === 0) throw AppError.notFound("Customer not found");
      if (c.rows[0]!.status === "closed") {
        throw AppError.unprocessable("Cannot assign a closed customer");
      }
      branchId = c.rows[0]!.branch_id;
    } else {
      const g = await db.query<{ id: string; branch_id: string; status: string }>(
        `SELECT id, branch_id, status FROM groups WHERE id=$1`,
        [input.groupId!]
      );
      if ((g.rowCount ?? 0) === 0) throw AppError.notFound("Group not found");
      if (g.rows[0]!.status === "closed") {
        throw AppError.unprocessable("Cannot assign a closed group");
      }
      branchId = g.rows[0]!.branch_id;
    }

    if (actor.branchId !== null && actor.branchId !== branchId) {
      throw AppError.forbidden(
        "A branch-scoped session can only assign customers/groups in its own branch"
      );
    }

    const inserted = await db.query<{
      id: string;
      branch_id: string;
      staff_id: string;
      customer_id: string | null;
      group_id: string | null;
      status: string;
      assigned_at: Date;
      ended_at: Date | null;
    }>(
      `INSERT INTO customer_assignments (company_id, branch_id, staff_id, customer_id, group_id, assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, branch_id, staff_id, customer_id, group_id, status, assigned_at, ended_at`,
      [actor.companyId, branchId, input.staffId, input.customerId ?? null, input.groupId ?? null, actor.sub]
    );
    const assignment = inserted.rows[0]!;

    await auditAssignment(
      db, actor.companyId, branchId, actor.sub,
      "assignment.created", assignment.id, null,
      {
        staff_id: assignment.staff_id,
        customer_id: assignment.customer_id,
        group_id: assignment.group_id,
        branch_id: assignment.branch_id
      },
      null, meta
    );
    return {
      id: assignment.id,
      branchId: assignment.branch_id,
      staffId: assignment.staff_id,
      customerId: assignment.customer_id,
      groupId: assignment.group_id,
      status: assignment.status,
      assignedAt: assignment.assigned_at,
      endedAt: assignment.ended_at
    };
  });
}

export async function endAssignment(
  actor: PerformanceActor,
  assignmentId: string,
  reason: string,
  meta: ActorMeta = {}
): Promise<AssignmentRow> {
  if (!reason || reason.trim().length === 0) {
    throw AppError.unprocessable("reason is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const existing = await db.query<{
      id: string;
      branch_id: string;
      staff_id: string;
      customer_id: string | null;
      group_id: string | null;
      status: string;
    }>(
      `SELECT id, branch_id, staff_id, customer_id, group_id, status
         FROM customer_assignments WHERE id=$1 FOR UPDATE`,
      [assignmentId]
    );
    if ((existing.rowCount ?? 0) === 0) throw AppError.notFound("Assignment not found");
    const prev = existing.rows[0]!;
    if (prev.status === "ended") throw AppError.conflict("Assignment has already ended");

    const updated = await db.query<{
      id: string;
      branch_id: string;
      staff_id: string;
      customer_id: string | null;
      group_id: string | null;
      status: string;
      assigned_at: Date;
      ended_at: Date | null;
    }>(
      `UPDATE customer_assignments SET status='ended', ended_at=now() WHERE id=$1
        RETURNING id, branch_id, staff_id, customer_id, group_id, status, assigned_at, ended_at`,
      [assignmentId]
    );
    const next = updated.rows[0]!;

    await auditAssignment(
      db, actor.companyId, prev.branch_id, actor.sub,
      "assignment.ended", assignmentId,
      { status: prev.status },
      { status: "ended" },
      reason, meta
    );
    return {
      id: next.id,
      branchId: next.branch_id,
      staffId: next.staff_id,
      customerId: next.customer_id,
      groupId: next.group_id,
      status: next.status,
      assignedAt: next.assigned_at,
      endedAt: next.ended_at
    };
  });
}

export interface ListAssignmentsInput {
  staffId?: string | null;
  customerId?: string | null;
  groupId?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}

export async function listAssignments(
  actor: PerformanceActor,
  input: ListAssignmentsInput = {}
): Promise<{ items: AssignmentRow[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.staffId) {
      params.push(input.staffId);
      conditions.push(`staff_id=$${params.length}`);
    }
    if (input.customerId) {
      params.push(input.customerId);
      conditions.push(`customer_id=$${params.length}`);
    }
    if (input.groupId) {
      params.push(input.groupId);
      conditions.push(`group_id=$${params.length}`);
    }
    if (input.status) {
      if (!["active", "ended"].includes(input.status)) {
        throw AppError.unprocessable("invalid status");
      }
      params.push(input.status);
      conditions.push(`ca.status=$${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM customer_assignments ca ${where}`,
      params
    );
    params.push(limit);
    params.push(offset);
    const items = await db.query<{
      id: string;
      branch_id: string;
      staff_id: string;
      customer_id: string | null;
      group_id: string | null;
      status: string;
      assigned_at: Date;
      ended_at: Date | null;
      customer_name: string | null;
      customer_phone: string | null;
      customer_status: string | null;
      group_name: string | null;
    }>(
      `SELECT ca.id, ca.branch_id, ca.staff_id, ca.customer_id, ca.group_id,
              ca.status, ca.assigned_at, ca.ended_at,
              CONCAT(c.first_name, ' ', COALESCE(c.middle_name || ' ', ''), c.last_name) AS customer_name,
              c.phone AS customer_phone,
              c.status AS customer_status,
              g.name AS group_name
         FROM customer_assignments ca
         LEFT JOIN customers c ON c.id = ca.customer_id
         LEFT JOIN groups g ON g.id = ca.group_id
         ${where}
         ORDER BY ca.assigned_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return {
      items: items.rows.map((row) => ({
        id: row.id,
        branchId: row.branch_id,
        staffId: row.staff_id,
        customerId: row.customer_id,
        groupId: row.group_id,
        status: row.status,
        assignedAt: row.assigned_at,
        endedAt: row.ended_at,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        customerStatus: row.customer_status,
        groupName: row.group_name
      })),
      total: parseInt(totalRow.rows[0]?.count ?? "0", 10)
    };
  });
}