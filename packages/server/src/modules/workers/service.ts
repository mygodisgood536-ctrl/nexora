import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { PoolClient } from "pg";
import {
  BUILT_IN_ROLES,
  CUSTOM_ROLE_TEMPLATES,
  type RoleDefinition,
  isBuiltInRoleKey
} from "@nexora/shared";
import { withBypass, withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

/**
 * Worker / role-assignment service (Stage 6 — Part 1 §12–17).
 *
 * Operates on the tables created by migration 0004_rbac:
 *   users, roles, role_permissions, role_assignments, role_assignment_branches
 *
 * Architectural rules enforced here:
 *   - All reads/writes run inside `withTenant` so RLS is active and isolates
 *     cross-company reads.
 *   - Worker code is auto-generated as `{BRANCH_CODE}-{ROLE_PREFIX}-{SEQ}`
 *     (Part 1 §12) using an atomic counter so concurrent creations never
 *     collide, codes are never reused, and a closed branch's code never gets
 *     reassigned.
 *   - First-login password is a high-entropy random string, never derived
 *     from any PII, returned ONCE to the creating staff member.
 *   - Lifecycle transitions follow the state machine:
 *       invited → active → suspended → active (reactivate)
 *                                → terminated (terminal)
 *     and every transition is appended to audit_logs.
 *   - Temporary/acting role assignments are validated for an end-after-start
 *     window and only participate in the permission merge while the window
 *     is open (enforced by the shared `isAssignmentActive`).
 */

const BCRYPT_ROUNDS = 10;
const TEMP_PASSWORD_EXPIRY_HOURS = 72;

export interface WorkerActor {
  sub: string;
  companyId: string;
}

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface CreateWorkerInput {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  username: string;
  phone?: string | null;
  email?: string | null;
  birthDay?: number | null;
  birthMonth?: number | null;
  branchId: string;
  /** The role assigned at creation. Must be a built-in role key. */
  roleKey: string;
  scopeType:
    | "company_wide"
    | "head_office"
    | "multi_branch"
    | "single_branch"
    | "assigned_customers_groups_loans";
  branchIds?: string[];
  assignmentType?: "permanent" | "temporary";
  startsAt?: string;
  endsAt?: string;
  reason?: string;
}

export interface CreatedWorker {
  id: string;
  workerCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  username: string;
  branchId: string;
  status: string;
  mustChangePassword: true;
  temporaryPassword: string;
  temporaryPasswordExpiresAt: string;
  initialAssignmentId: string;
}

interface BranchRow {
  id: string;
  code: string;
  company_id: string;
  name: string;
}

interface CompanyCodeRow {
  code_prefix: string;
}

function rolePrefixFor(roleKey: string): string {
  const compact = roleKey
    .replace(/[^a-z0-9]+/g, "")
    .toUpperCase()
    .slice(0, 4);
  return compact || "STF";
}

const PLATFORM_ROLE_PREFIX_CACHE = new Map<string, string>();
/** Resolves a built-in role's display prefix from the platform catalogue. */
async function loadRolePrefix(
  db: PoolClient,
  roleKey: string
): Promise<string> {
  if (PLATFORM_ROLE_PREFIX_CACHE.has(roleKey)) {
    return PLATFORM_ROLE_PREFIX_CACHE.get(roleKey)!;
  }
  const r = await db.query<{ code_prefix: string }>(
    `SELECT code_prefix FROM platform_role_catalogue WHERE role_key=$1`,
    [roleKey]
  );
  if (r.rowCount === 0) return rolePrefixFor(roleKey);
  PLATFORM_ROLE_PREFIX_CACHE.set(roleKey, r.rows[0]!.code_prefix);
  return r.rows[0]!.code_prefix;
}

function generateTemporaryPassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

function validateScopeBranches(
  scopeType: CreateWorkerInput["scopeType"],
  branchIds: string[] | undefined,
  actorBranchId: string
): void {
  if (scopeType === "single_branch") {
    if (!branchIds || branchIds.length !== 1) {
      throw AppError.unprocessable(
        "single_branch scope requires exactly one branchId"
      );
    }
    if (branchIds[0] !== actorBranchId) {
      throw AppError.unprocessable(
        "single_branch scope must reference the worker's own branch"
      );
    }
  } else if (scopeType === "multi_branch") {
    if (!branchIds || branchIds.length === 0) {
      throw AppError.unprocessable(
        "multi_branch scope requires at least one branchId"
      );
    }
async function auditWorker(
  db: PoolClient,
  companyId: string,
  branchId: string | null,
  actorUserId: string,
  action: string,
  entityType: "workers" | "role_assignments" | "credentials" | "roles",
  entityId: string,
  previousValue: unknown,
  newValue: unknown,
  reason: string | null,
  meta: ActorMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
    [
      companyId,
      branchId,
      actorUserId,
      action,
      entityType,
      entityId,
      previousValue === undefined ? null : JSON.stringify(previousValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      reason,
      meta.ip ?? null,
      meta.userAgent ?? null,
      meta.requestId ?? null
    ]
  );
}

async function ensureRoleRow(
  db: PoolClient,
  companyId: string,
  roleKey: string
): Promise<string> {
  const found = await db.query<{ id: string; is_system: boolean }>(
    `SELECT id, is_system FROM roles WHERE company_id=$1 AND role_key=$2`,
    [companyId, roleKey]
  );
  if ((found.rowCount ?? 0) > 0) return found.rows[0]!.id;

  const def = BUILT_IN_ROLES.find((r) => r.key === roleKey);
  if (!def) {
    throw AppError.unprocessable(`Unknown built-in role: ${roleKey}`);
  }
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO roles (company_id, role_key, name, category, is_system, enabled)
export async function createWorker(
  actor: WorkerActor,
  input: CreateWorkerInput,
  meta: ActorMeta = {}
): Promise<CreatedWorker> {
  if (!isBuiltInRoleKey(input.roleKey)) {
    throw AppError.unprocessable(
      "Initial role assignment must be a built-in role; custom roles are added later"
    );
  }
  validateScopeBranches(input.scopeType, input.branchIds, input.branchId);

  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw AppError.unprocessable("endsAt must be after startsAt");
  }
  if (input.assignmentType === "temporary" && !endsAt) {
    throw AppError.unprocessable("Temporary assignments require endsAt");
  }

  const company = await withBypass(async (db) => {
    const r = await db.query<CompanyCodeRow>(
      `SELECT code_prefix FROM companies WHERE id=$1`,
      [actor.companyId]
    );
    return r.rows[0];
  });
  if (!company) throw AppError.notFound("Company not found");

  return withTenant(actor.companyId, input.branchId, async (db) => {
    const branch = await db.query<BranchRow>(
      `SELECT id, code, company_id, name FROM branches WHERE id=$1`,
      [input.branchId]
    );
    if (branch.rowCount === 0) {
      throw AppError.notFound("Branch not found");
    }

    const exists = await db.query(
      `SELECT 1 FROM users WHERE company_id=$1 AND username=$2`,
      [actor.companyId, input.username]
    );
    if ((exists.rowCount ?? 0) > 0) {
      throw new AppError(
        409,
        "USERNAME_TAKEN",
        "A worker with that username already exists in this company"
      );
    }

    const tempPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const expiresAt = new Date(
      Date.now() + TEMP_PASSWORD_EXPIRY_HOURS * 60 * 60 * 1000
    );

    const workerCode = await allocateWorkerCode(
      db,
      branch.rows[0]!.code,
      input.roleKey
    );

    const inserted = await db.query<{
      id: string;
      worker_code: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      username: string;
      branch_id: string;
      status: string;
    }>(
      `INSERT INTO users (company_id, branch_id, worker_code, username, password_hash,
                          must_change_password, temp_password_expires_at,
                          first_name, middle_name, last_name, phone, email,
                          birth_day, birth_month, status, created_by)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,$11,$12,$13,'invited',$14)
       RETURNING id, worker_code, first_name, middle_name, last_name, username,
                 branch_id, status`,
      [
        actor.companyId,
        input.branchId,
        workerCode,
        input.username,
        passwordHash,
        expiresAt,
        input.firstName,
        input.middleName ?? null,
        input.lastName,
        input.phone ?? null,
        input.email ?? null,
        input.birthDay ?? null,
        input.birthMonth ?? null,
        actor.sub
      ]
    );
    const worker = inserted.rows[0]!;

    const roleId = await ensureRoleRow(db, actor.companyId, input.roleKey);
    const assignmentType = input.assignmentType ?? "permanent";

    const ra = await db.query<{ id: string }>(
      `INSERT INTO role_assignments (company_id, user_id, role_id, scope_type,
                                      assignment_type, starts_at, ends_at, reason,
                                      status, assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)
       RETURNING id`,
      [
        actor.companyId,
        worker.id,
        roleId,
        input.scopeType,
        assignmentType,
        startsAt,
        endsAt,
        input.reason ?? null,
        actor.sub
      ]
    );
    const assignmentId = ra.rows[0]!.id;

    if (
      input.scopeType === "single_branch" ||
      input.scopeType === "multi_branch"
    ) {
      for (const bId of input.branchIds!) {
        await db.query(
          `INSERT INTO role_assignment_branches (assignment_id, branch_id) VALUES ($1,$2)`,
          [assignmentId, bId]
        );
      }
    }

    await auditWorker(
      db,
      actor.companyId,
      input.branchId,
      actor.sub,
      "worker.created",
      "workers",
      worker.id,
      null,
      {
        worker_code: worker.worker_code,
        username: input.username,
        first_name: input.firstName,
        last_name: input.lastName
      },
      null,
      meta
    );
    await auditWorker(
      db,
      actor.companyId,
      input.branchId,
      actor.sub,
      "role_assignment.created",
      "role_assignments",
      assignmentId,
      null,
      {
        role_key: input.roleKey,
export interface ListWorkersOptions {
  branchId?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listWorkers(
  actor: WorkerActor,
  opts: ListWorkersOptions = {}
): Promise<unknown[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const conditions: string[] = ["company_id = $1"];
    const params: unknown[] = [actor.companyId];
    let i = 2;
    if (opts.branchId) {
      conditions.push(`branch_id = $${i++}`);
      params.push(opts.branchId);
    }
    if (opts.status) {
      conditions.push(`status = $${i++}`);
      params.push(opts.status);
    }
    if (opts.search) {
      conditions.push(
        `(username ILIKE $${i} OR first_name ILIKE $${i} OR last_name ILIKE $${i} OR worker_code ILIKE $${i})`
      );
      params.push(`%${opts.search}%`);
      i++;
    }
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    params.push(limit);
    params.push(offset);

    const { rows } = await db.query(
      `SELECT id, worker_code, username, first_name, middle_name, last_name,
              branch_id, phone, email, status, must_change_password,
              last_login_at, suspended_at, terminated_at, created_at
export async function getWorker(
  actor: WorkerActor,
  workerId: string
): Promise<Record<string, unknown>> {
  return withTenant(actor.companyId, null, async (db) => {
    const { rows } = await db.query(
      `SELECT id, worker_code, username, first_name, middle_name, last_name,
              branch_id, phone, email, birth_day, birth_month, status,
              must_change_password, last_login_at, suspended_at, terminated_at,
              created_at, created_by
         FROM users WHERE id=$1`,
      [workerId]
    );
    if (rows.rowCount === 0) throw AppError.notFound("Worker not found");
    return rows[0]!;
  });
}

const WORKER_TRANSITIONS: Record<
  string,
  { from: string[]; to: string; needsReason: boolean }
> = {
  activate: { from: ["invited", "suspended"], to: "active", needsReason: false },
  suspend: { from: ["active"], to: "suspended", needsReason: true },
  reactivate: { from: ["suspended"], to: "active", needsReason: false },
  terminate: {
    from: ["invited", "active", "suspended"],
    to: "terminated",
    needsReason: true
  }
};
         FROM users
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
export async function setWorkerStatus(
  actor: WorkerActor,
  workerId: string,
  action: string,
  reason: string | undefined,
  meta: ActorMeta = {}
): Promise<{ status: string }> {
  const t = WORKER_TRANSITIONS[action];
  if (!t) throw AppError.badRequest("Unknown status action");
  if (t.needsReason && (!reason || reason.trim().length === 0)) {
    throw AppError.unprocessable("Reason is required for this action");
  }
  return withTenant(actor.companyId, null, async (db) => {
    const found = await db.query<{ id: string; status: string; branch_id: string | null }>(
      `SELECT id, status, branch_id FROM users WHERE id=$1 FOR UPDATE`,
      [workerId]
    );
    if (found.rowCount === 0) throw AppError.notFound("Worker not found");
    const before = found.rows[0]!.status;
    if (!t.from.includes(before)) {
      throw new AppError(
        409,
        "INVALID_TRANSITION",
        `Cannot ${action} a ${before} worker`
      );
    }
    const sets =
      action === "suspend"
        ? `, suspended_at = now()`
        : action === "reactivate"
        ? `, suspended_at = NULL`
        : action === "terminate"
        ? `, terminated_at = now()`
        : ``;
    await db.query(`UPDATE users SET status=$2${sets} WHERE id=$1`, [
      workerId,
      t.to
    ]);

    if (action === "terminate") {
      await db.query(
        `UPDATE role_assignments
            SET status='ended', ended_at=now(), ended_by=$2, end_reason=$3
          WHERE user_id=$1 AND status='active'`,
        [workerId, actor.sub, reason ?? "Worker terminated"]
      );
    }

    await auditWorker(
      db,
      actor.companyId,
      found.rows[0]!.branch_id,
      actor.sub,
      `worker.${action}`,
      "workers",
      workerId,
export interface ResetPasswordResult {
  temporaryPassword: string;
  expiresAt: string;
}

export async function resetWorkerPassword(
  actor: WorkerActor,
  workerId: string,
  reason: string | undefined,
  meta: ActorMeta = {}
): Promise<ResetPasswordResult> {
  if (!reason || reason.trim().length === 0) {
    throw AppError.unprocessable("Reason is required for a password reset");
  }
  return withTenant(actor.companyId, null, async (db) => {
    const found = await db.query<{
      id: string;
      branch_id: string | null;
      status: string;
    }>(`SELECT id, branch_id, status FROM users WHERE id=$1`, [workerId]);
    if (found.rowCount === 0) throw AppError.notFound("Worker not found");
    if (found.rows[0]!.status === "terminated") {
      throw new AppError(
        409,
        "WORKER_TERMINATED",
        "Cannot reset password for a terminated worker"
      );
    }
    const tempPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const expiresAt = new Date(
      Date.now() + TEMP_PASSWORD_EXPIRY_HOURS * 60 * 60 * 1000
    );

    await db.query(
      `UPDATE users
          SET password_hash=$2, must_change_password=true, temp_password_expires_at=$3
        WHERE id=$1`,
      [workerId, passwordHash, expiresAt]
    );
    await db.query(
      `UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
      [workerId]
    );

    await auditWorker(
      db,
      actor.companyId,
      found.rows[0]!.branch_id,
      actor.sub,
      "credentials.reset",
      "credentials",
      workerId,
      null,
      { expires_at: expiresAt.toISOString() },
      reason,
      meta
    );

    return {
      temporaryPassword: tempPassword,
      expiresAt: expiresAt.toISOString()
    };
  });
export interface AssignRoleInput {
  workerId: string;
  roleKey: string;
  scopeType:
    | "company_wide"
    | "head_office"
    | "multi_branch"
    | "single_branch"
    | "assigned_customers_groups_loans";
  branchIds?: string[];
  assignmentType?: "permanent" | "temporary";
  startsAt?: string;
  endsAt?: string;
  reason?: string;
}

export async function listAssignments(
  actor: WorkerActor,
  workerId: string
): Promise<unknown[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const { rows } = await db.query(
      `SELECT ra.id, r.role_key, r.name AS role_name, r.category,
              ra.scope_type, ra.assignment_type, ra.starts_at, ra.ends_at,
              ra.status, ra.reason, ra.assigned_by, ra.created_at,
              COALESCE(
                (SELECT array_agg(rab.branch_id)
                   FROM role_assignment_branches rab
                  WHERE rab.assignment_id = ra.id),
                '{}'::uuid[]
              ) AS branch_ids
         FROM role_assignments ra
         JOIN roles r ON r.id = ra.role_id
        WHERE ra.user_id=$1
        ORDER BY ra.created_at DESC`,
      [workerId]
    );
    return rows;
export async function assignRole(
  actor: WorkerActor,
  input: AssignRoleInput,
  meta: ActorMeta = {}
): Promise<{
  id: string;
  roleKey: string;
  scopeType: string;
  branchIds: string[];
  startsAt: string;
  endsAt: string | null;
}> {
  if (!isBuiltInRoleKey(input.roleKey)) {
    throw AppError.unprocessable(
      "assignRole currently accepts built-in role keys; custom-role assignment is a separate endpoint"
    );
  }
  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (input.assignmentType === "temporary" && !endsAt) {
    throw AppError.unprocessable("Temporary assignments require endsAt");
  }
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw AppError.unprocessable("endsAt must be after startsAt");
  }
  return withTenant(actor.companyId, null, async (db) => {
    const worker = await db.query<{
      id: string;
      branch_id: string | null;
      status: string;
    }>(`SELECT id, branch_id, status FROM users WHERE id=$1`, [
      input.workerId
    ]);
    if (worker.rowCount === 0) throw AppError.notFound("Worker not found");
    if (worker.rows[0]!.status === "terminated") {
      throw new AppError(
        409,
        "WORKER_TERMINATED",
        "Cannot assign a role to a terminated worker"
      );
    }
    validateScopeBranches(
      input.scopeType,
      input.branchIds,
      worker.rows[0]!.branch_id ?? ""
    );

    const roleId = await ensureRoleRow(db, actor.companyId, input.roleKey);

    const ra = await db.query<{
      id: string;
      starts_at: Date;
      ends_at: Date | null;
    }>(
      `INSERT INTO role_assignments (company_id, user_id, role_id, scope_type,
                                      assignment_type, starts_at, ends_at, reason,
                                      status, assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)
       RETURNING id, starts_at, ends_at`,
      [
        actor.companyId,
        input.workerId,
        roleId,
        input.scopeType,
        input.assignmentType ?? "permanent",
        startsAt,
        endsAt,
        input.reason ?? null,
        actor.sub
      ]
    );
    const assignment = ra.rows[0]!;
    const branchIdsForScope =
      input.scopeType === "single_branch" || input.scopeType === "multi_branch"
        ? input.branchIds!
        : [];
    for (const bId of branchIdsForScope) {
      await db.query(
        `INSERT INTO role_assignment_branches (assignment_id, branch_id) VALUES ($1,$2)`,
        [assignment.id, bId]
      );
    }

    await auditWorker(
      db,
      actor.companyId,
      worker.rows[0]!.branch_id,
      actor.sub,
      "role_assignment.created",
      "role_assignments",
      assignment.id,
      null,
      {
        role_key: input.roleKey,
        scope_type: input.scopeType,
        assignment_type: input.assignmentType ?? "permanent",
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null
      },
      input.reason ?? null,
      meta
    );

    return {
      id: assignment.id,
      roleKey: input.roleKey,
      scopeType: input.scopeType,
      branchIds: branchIdsForScope,
      startsAt: assignment.starts_at.toISOString(),
      endsAt: assignment.ends_at ? assignment.ends_at.toISOString() : null
    };
  });
}

export async function endAssignment(
  actor: WorkerActor,
  assignmentId: string,
  reason: string | undefined,
  meta: ActorMeta = {}
): Promise<{ id: string; status: string }> {
  if (!reason || reason.trim().length === 0) {
    throw AppError.unprocessable("Reason is required to end a role assignment");
  }
  return withTenant(actor.companyId, null, async (db) => {
    const found = await db.query<{
      id: string;
      status: string;
      user_id: string;
      role_id: string;
      branch_id: string | null;
    }>(
      `SELECT ra.id, ra.status, ra.user_id, ra.role_id, u.branch_id
         FROM role_assignments ra
         JOIN users u ON u.id = ra.user_id
        WHERE ra.id=$1 FOR UPDATE`,
      [assignmentId]
    );
    if (found.rowCount === 0) throw AppError.notFound("Role assignment not found");
export async function listEnabledRoles(actor: WorkerActor): Promise<unknown[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const { rows } = await db.query(
      `SELECT id, role_key, name, category, is_system, source_template_key, enabled,
              created_at
         FROM roles
        WHERE company_id = $1
        ORDER BY is_system DESC, category, name`,
      [actor.companyId]
    );
    return rows;
  });
}

export async function getRoleCatalogue(): Promise<{
  builtIn: RoleDefinition[];
  templates: RoleDefinition[];
}> {
  return { builtIn: BUILT_IN_ROLES, templates: CUSTOM_ROLE_TEMPLATES };
}

export async function setRoleEnabled(
  actor: WorkerActor,
  roleKey: string,
  enabled: boolean,
  meta: ActorMeta = {}
): Promise<{ roleKey: string; enabled: boolean }> {
  if (!isBuiltInRoleKey(roleKey)) {
    throw AppError.unprocessable(
      "setRoleEnabled currently toggles built-in role visibility only"
    );
  }
  return withTenant(actor.companyId, null, async (db) => {
    const roleId = await ensureRoleRow(db, actor.companyId, roleKey);
    const before = await db.query<{ enabled: boolean }>(
      `SELECT enabled FROM roles WHERE id=$1`,
      [roleId]
    );
    await db.query(`UPDATE roles SET enabled=$2 WHERE id=$1`, [roleId, enabled]);
    await auditWorker(
      db,
      actor.companyId,
      null,
      actor.sub,
      "role.enabled_changed",
export interface CreateCustomRoleInput {
  name: string;
  description?: string;
  sourceRoleKey: string;
}

export async function createCustomRole(
  actor: WorkerActor,
  input: CreateCustomRoleInput,
  meta: ActorMeta = {}
): Promise<{ id: string; roleKey: string; name: string; category: string }> {
  const source = [...BUILT_IN_ROLES, ...CUSTOM_ROLE_TEMPLATES].find(
    (r) => r.key === input.sourceRoleKey
  );
  if (!source) {
    throw AppError.unprocessable(
      `Unknown source role key: ${input.sourceRoleKey}`
    );
  }
  return withTenant(actor.companyId, null, async (db) => {
    const existing = await db.query(
      `SELECT 1 FROM roles WHERE company_id=$1 AND role_key=$2`,
      [actor.companyId, input.name]
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new AppError(
        409,
        "ROLE_NAME_TAKEN",
        "A role with that name already exists in this company"
      );
    }
    const roleKey = `custom_${input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`;
    const inserted = await db.query<{
      id: string;
      role_key: string;
      name: string;
      category: string;
    }>(
      `INSERT INTO roles (company_id, role_key, name, category, is_system,
                           source_template_key, enabled)
       VALUES ($1,$2,$3,$4,false,$5,true) RETURNING id, role_key, name, category`,
      [
        actor.companyId,
        roleKey,
        input.name,
        source.category,
        input.sourceRoleKey
      ]
    );
    const role = inserted.rows[0]!;

    if (isBuiltInRoleKey(input.sourceRoleKey)) {
      await db.query(
        `INSERT INTO role_permissions (role_id, verb)
         SELECT $1, verb FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
          WHERE r.company_id=$2 AND r.role_key=$3`,
        [role.id, actor.companyId, input.sourceRoleKey]
      );
    }

    await auditWorker(
      db,
      actor.companyId,
      null,
      actor.sub,
      "role.custom_created",
      "roles",
      role.id,
      null,
      { name: role.name, source: input.sourceRoleKey, role_key: role.role_key },
      null,
      meta
    );
    return {
      id: role.id,
      roleKey: role.role_key,
      name: role.name,
      category: role.category
    };
  });
}

export async function setRolePermissions(
  actor: WorkerActor,
  roleId: string,
  verbs: string[],
  meta: ActorMeta = {}
): Promise<{ roleId: string; verbs: string[] }> {
  return withTenant(actor.companyId, null, async (db) => {
    const exists = await db.query<{ id: string; is_system: boolean }>(
      `SELECT id, is_system FROM roles WHERE id=$1`,
      [roleId]
    );
    if (exists.rowCount === 0) throw AppError.notFound("Role not found");
    if (exists.rows[0]!.is_system) {
      throw new AppError(
        409,
        "ROLE_IS_SYSTEM",
        "Built-in role permissions are read-only; clone to a custom role to modify"
      );
    }
    await db.query(`DELETE FROM role_permissions WHERE role_id=$1`, [roleId]);
    for (const v of verbs) {
      await db.query(
        `INSERT INTO role_permissions (role_id, verb) VALUES ($1,$2)`,
        [roleId, v]
      );
    }
    await auditWorker(
      db,
      actor.companyId,
      null,
      actor.sub,
      "role.permissions_changed",
      "roles",
      roleId,
      null,
      { verbs },
      null,
      meta
    );
    return { roleId, verbs };
  });
}

export async function getRolePermissions(
  actor: WorkerActor,
  roleId: string
): Promise<string[]> {
  return withTenant(actor.companyId, null, async (db) => {
    const { rows } = await db.query<{ verb: string }>(
      `SELECT verb FROM role_permissions WHERE role_id=$1 ORDER BY verb`,
      [roleId]
    );
    return rows.map((r) => r.verb);
  });
}
      "roles",
      roleId,
      { enabled: before.rows[0]?.enabled ?? null },
      { enabled },
      null,
      meta
    );
    return { roleKey, enabled };
  });
}
    if (found.rows[0]!.status !== "active") {
      throw new AppError(
        409,
        "ASSIGNMENT_NOT_ACTIVE",
        "Role assignment is not active"
      );
    }
    await db.query(
      `UPDATE role_assignments
          SET status='ended', ended_at=now(), ended_by=$2, end_reason=$3
        WHERE id=$1`,
      [assignmentId, actor.sub, reason]
    );
    await auditWorker(
      db,
      actor.companyId,
      found.rows[0]!.branch_id,
      actor.sub,
      "role_assignment.ended",
      "role_assignments",
      assignmentId,
      { status: "active" },
      { status: "ended" },
      reason,
      meta
    );
    return { id: assignmentId, status: "ended" };
  });
}
  });
}
}
      { status: before },
      { status: t.to },
      reason ?? null,
      meta
    );

    return { status: t.to };
  });
}
        LIMIT $${i++} OFFSET $${i++}`,
      params
    );
    return rows;
  });
}
        scope_type: input.scopeType,
        assignment_type: assignmentType,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null
      },
      input.reason ?? null,
      meta
    );

    return {
      id: worker.id,
      workerCode: worker.worker_code,
      firstName: worker.first_name,
      middleName: worker.middle_name,
      lastName: worker.last_name,
      username: worker.username,
      branchId: worker.branch_id,
      status: worker.status,
      mustChangePassword: true,
      temporaryPassword: tempPassword,
      temporaryPasswordExpiresAt: expiresAt.toISOString(),
      initialAssignmentId: assignmentId
    };
  });
}
     VALUES ($1,$2,$3,$4,true,true) RETURNING id`,
    [companyId, def.key, def.name, def.category]
  );
  return inserted.rows[0]!.id;
}

async function allocateWorkerCode(
  db: PoolClient,
  branchCode: string,
  roleKey: string
): Promise<string> {
  const counterKey = `worker_code:${roleKey}`;
  const allocated = await db.query<{ allocated: number }>(
    `INSERT INTO company_counters (company_id, counter_key, next_value)
     VALUES (
       (SELECT company_id FROM branches WHERE code=$1),
       $2, 1
     )
     ON CONFLICT (company_id, counter_key)
     DO UPDATE SET next_value = company_counters.next_value + 1
     RETURNING next_value - 1 AS allocated`,
    [branchCode, counterKey]
  );
  const seq = allocated.rows[0]!.allocated;
  const prefix = await loadRolePrefix(db, roleKey);
  return `${branchCode}-${prefix}-${String(seq).padStart(3, "0")}`;
}
  } else if (scopeType === "company_wide" || scopeType === "head_office") {
    if (branchIds && branchIds.length > 0) {
      throw AppError.unprocessable(
        `${scopeType} scope must not include branchIds`
      );
    }
  }
}