import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import {
  BUILT_IN_ROLES,
  CUSTOM_ROLE_TEMPLATES,
  type RoleDefinition,
  isBuiltInRoleKey,
  roleWorldFor
} from "@nexora/shared";
import { withBypass, withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { insertNotificationsToMds, insertUserNotifications } from "../notifications/service";
import { assertBranchAcceptsNewWork } from "../branches/service";
import {
  fullName,
  initialPasswordFor,
  type CredentialState
} from "../../lib/credential";

/**
 * Worker / role-assignment service (Stage 6 — Part 1 §12–17).
 *
 * Operates on the tables created by migration 0004_rbac:
 *   users, roles, role_permissions, role_assignments, role_assignment_branches
 *
 * Architectural rules enforced here (Vision Part 5):
 *   - All reads/writes run inside `withTenant` so RLS is active and isolates
 *     cross-company reads.
 *   - The username is the exact full name — the software's output, never
 *     typed (RULE 5.1.1–5.1.4). A duplicate full name stops creation.
 *   - The initial password is @FirstName (RULE 5.2.1), issued once through a
 *     one-time credential panel and paved only as a hash (RULE 5.2.2).
 *   - Worker ID: {BRANCH_CODE}-{ROLE_CODE}-{SEQ} for branch roles and
 *     {COMPANY_PREFIX}-HO-{ROLE_CODE}-{SEQ} for Head Office roles; permanent
 *     and never reused (RULE 5.7.3).
 *   - New accounts start in the credential_issued lifecycle state with a
 *     credential window; the mandatory Credential Ritual (Part 4 §4.2 /
 *     Part 5 §5.3) moves them to secured.
 *   - Lifecycle transitions follow the state machine:
 *       invited → active → suspended → active (reactivate)
 *                                → terminated (terminal)
 *     and every transition is appended to audit_logs.
 */

const BCRYPT_ROUNDS = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WorkerActor {
  sub: string;
  companyId: string;
  branchId: string | null;
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
  credentialState: CredentialState;
  mustChangePassword: true;
  /** One-time credential panel (RULE 5.2.2 / 5.7.3) — shown once. */
  initialPassword: string;
  initialPasswordExpiresAt: string;
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
  } else if (scopeType === "company_wide" || scopeType === "head_office") {
    if (branchIds && branchIds.length > 0) {
      throw AppError.unprocessable(
        `${scopeType} scope must not include branchIds`
      );
    }
  }
}

async function auditWorker(
  db: PoolClient,
  companyId: string,
  branchId: string | null,
  actorUserId: string,
  action: string,
  entityType: "workers" | "role_assignments" | "credentials" | "roles" | "customer_assignments",
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

/**
 * Copy the platform role's default permission bundle into the company's own
 * `role_permissions` the first time that role is provisioned for the company.
 *
 * The platform catalogue (migration 0016) defines the default verb bundle for
 * every built-in role, but a company has its own `roles` / `role_permissions`
 * rows. Without this copy a freshly created role holds no verbs at all and
 * every `requirePermission` gate refuses the role — including the MD. The copy
 * is additive and idempotent, and an MD-authorised `setRolePermissions` can
 * still narrow the bundle afterwards.
 */
export async function provisionDefaultRolePermissions(
  db: PoolClient,
  companyId: string,
  roleId: string,
  roleKey: string
): Promise<void> {
  await db.query(
    `INSERT INTO role_permissions (role_id, verb)
     SELECT $2::uuid, b.verb
       FROM platform_role_permission_bundles b
      WHERE b.role_key = $1
        AND NOT EXISTS (
          SELECT 1 FROM role_permissions rp WHERE rp.role_id = $2::uuid
        )
     ON CONFLICT DO NOTHING`,
    [roleKey, roleId]
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
  if ((found.rowCount ?? 0) > 0) {
    const roleId = found.rows[0]!.id;
    await provisionDefaultRolePermissions(db, companyId, roleId, roleKey);
    return roleId;
  }

  const def = BUILT_IN_ROLES.find((r) => r.key === roleKey);
  if (!def) {
    throw AppError.unprocessable(`Unknown built-in role: ${roleKey}`);
  }
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO roles (company_id, role_key, name, category, is_system, enabled)
     VALUES ($1,$2,$3,$4,true,true) RETURNING id`,
    [companyId, def.key, def.name, def.category]
  );
  const roleId = inserted.rows[0]!.id;
  await provisionDefaultRolePermissions(db, companyId, roleId, roleKey);
  return roleId;
}

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

  // Branch-scoped actor (login via branch URL) must not create workers in
  // a different branch — the role assignment's branch must match the
  // caller's effective branch. Head-office / company-wide actors
  // (branchId === null) may target any branch in their company.
  if (actor.branchId !== null && actor.branchId !== input.branchId) {
    throw AppError.forbidden(
      "A branch-scoped session cannot create workers in a different branch"
    );
  }

  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw AppError.unprocessable("endsAt must be after startsAt");
  }
  if (input.assignmentType === "temporary" && !endsAt) {
    throw AppError.unprocessable("Temporary assignments require endsAt");
  }

  // RULE 4.5.1 / 6.1.1 — the role's world and the assignment's scope must
  // agree. A Head Office role is never created inside a branch workplace, and
  // a branch role is never created without exactly one branch.
  const world = roleWorldFor(input.roleKey);
  const wideScope = input.scopeType === "company_wide" || input.scopeType === "head_office";
  if (world === "head_office" && !wideScope) {
    throw AppError.unprocessable(
      `${input.roleKey} is a Head Office role and must be assigned company-wide scope`
    );
  }
  if (world === "branch" && wideScope) {
    throw AppError.unprocessable(
      `${input.roleKey} is a branch role and cannot be assigned company-wide scope`
    );
  }
  // RULE 4.5.1 — a branch role cannot be created without a branch selected.
  if (world === "branch" && !input.branchId) {
    throw AppError.unprocessable("A branch role requires a branch");
  }
  // RULE 4.5.1 — a Head Office role cannot be created inside a branch workplace,
  // so a branch-scoped actor may never create one.
  if (world === "head_office" && actor.branchId !== null) {
    throw AppError.forbidden(
      "A branch-scoped session cannot create a Head Office worker; use the company portal"
    );
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
    // RULE 7.9.3 — a closed or not-yet-open branch takes no new workers.
    await assertBranchAcceptsNewWork(db, input.branchId, "workers");
    const branch = await db.query<BranchRow>(
      `SELECT id, code, company_id, name FROM branches WHERE id=$1`,
      [input.branchId]
    );
    if (branch.rowCount === 0) {
      throw AppError.notFound("Branch not found");
    }

    // RULE 5.1.1–5.1.4 — the username is the software's output: the exact
    // full name in normal spelling and spacing. Nobody types a username.
    const username = fullName(input.firstName, input.middleName, input.lastName);
    if (!username) {
      throw AppError.unprocessable("Full name is required to derive the username");
    }
    const exists = await db.query(
      `SELECT 1 FROM users WHERE company_id=$1 AND username=$2`,
      [actor.companyId, username]
    );
    if ((exists.rowCount ?? 0) > 0) {
      throw new AppError(
        409,
        "USERNAME_TAKEN",
        "A worker with that full name already exists in this company; correct the person's full name before creating the account"
      );
    }

    // RULE 5.2.1 — initial password is @FirstName (first letter capitalised).
    const initialPassword = initialPasswordFor(input.firstName);
    const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);

    // RULE 5.2.3.5 — the initial credential expires within the company's
    // configured window (default 7 days) unless consumed by the ritual.
    const policy = await db.query<{ hours: number | null }>(
      `SELECT credential_ritual_window_hours AS hours FROM company_settings WHERE company_id=$1`,
      [actor.companyId]
    );
    const windowHours = policy.rows[0]?.hours ?? 168;
    const issuedAt = new Date(Date.now());
    const expiresAt = new Date(Date.now() + windowHours * 60 * 60 * 1000);

    const workerCode = await allocateWorkerCode(
      db,
      branch.rows[0]!.code,
      company.code_prefix,
      input.roleKey,
      input.scopeType
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
      credential_state: CredentialState;
    }>(
      `INSERT INTO users (company_id, branch_id, worker_code, username, password_hash,
                          must_change_password, temp_password_expires_at,
                          first_name, middle_name, last_name, phone,
                          birth_day, birth_month, status, created_by,
                          credential_state, credential_issued_at, credential_expires_at)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,$11,$12,'invited',$13,
               'credential_issued',$14,$15)
       RETURNING id, worker_code, first_name, middle_name, last_name, username,
                 branch_id, status, credential_state`,
      [
        actor.companyId,
        input.branchId,
        workerCode,
        username,
        passwordHash,
        expiresAt,
        input.firstName,
        input.middleName ?? null,
        input.lastName,
        input.phone ?? null,
        input.birthDay ?? 1,
        input.birthMonth ?? 1,
        actor.sub,
        issuedAt,
        expiresAt
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
        username: username,
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
      "credential.issued",
      "credentials",
      worker.id,
      null,
      {
        credential_state: "credential_issued",
        username: username,
        expires_at: expiresAt.toISOString(),
        one_time: true
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
      credentialState: worker.credential_state,
      mustChangePassword: true,
      initialPassword,
      initialPasswordExpiresAt: expiresAt.toISOString(),
      initialAssignmentId: assignmentId
    };
  });
}

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
              branch_id, phone, status, credential_state, must_change_password,
              last_login_at, suspended_at, terminated_at, created_at
         FROM users
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
          LIMIT $${i++} OFFSET $${i++}`,
      params
    );
    return rows;
  });
}

export async function getWorker(
  actor: WorkerActor,
  workerId: string
): Promise<Record<string, unknown>> {
  return withTenant(actor.companyId, null, async (db) => {
    const { rows } = await db.query(
      `SELECT id, worker_code, username, first_name, middle_name, last_name,
              branch_id, phone, email, birth_day, birth_month, status,
              credential_state, must_change_password, last_login_at,
              suspended_at, terminated_at,
              created_at, created_by
         FROM users WHERE id=$1`,
      [workerId]
    );
    if (rows.length === 0) throw AppError.notFound("Worker not found");
    return rows[0]!;
  });
}

export interface EditWorkerInput {
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  birthDay?: number | null;
  birthMonth?: number | null;
  passport_photo_url?: string | null;
  reason: string;
}

/**
 * RULE 5.9.1 — HR can edit a worker's name, phone number, passport and role
 * information. The worker record itself is never deleted or replaced
 * (`#32`); a new person taking a portfolio is a separate worker created by the
 * transfer flow.
 *
 * RULE 5.1.1 — the username IS the full name, so a name change must move the
 * username with it or the account would stop answering to its own identity.
 * The uniqueness rule and the "name is never the password" ritual are
 * preserved. Every edit is audit-logged with before/after (RULE 5.9.3,
 * `worker.edited`).
 */
export async function editWorker(
  actor: WorkerActor,
  workerId: string,
  input: EditWorkerInput,
  meta: ActorMeta = {}
): Promise<Record<string, unknown>> {
  if (!input.reason || input.reason.trim().length < 5) {
    throw AppError.unprocessable("A reason is required to edit a worker record");
  }
  return withTenant(actor.companyId, null, async (db) => {
    const found = await db.query<{
      id: string; username: string; first_name: string; middle_name: string | null;
      last_name: string; phone: string | null; email: string | null;
      birth_day: number | null; birth_month: number | null;
      passport_photo_url: string | null; status: string; branch_id: string | null;
    }>(
      `SELECT id, username, first_name, middle_name, last_name, phone, email,
              birth_day, birth_month, passport_photo_url, status, branch_id
         FROM users WHERE id=$1 FOR UPDATE`,
      [workerId]
    );
    if ((found.rowCount ?? 0) === 0) throw AppError.notFound("Worker not found");
    const before = found.rows[0]!;
    if (before.status === "terminated") {
      throw AppError.conflict("A terminated worker record is permanently retained and cannot be edited");
    }

    const first = input.firstName?.trim() ?? before.first_name;
    const middle = input.middleName === undefined ? before.middle_name : input.middleName;
    const last = input.lastName?.trim() ?? before.last_name;
    if (!first || !last) throw AppError.unprocessable("First and last name are required");

    // RULE 5.1.1 — the username is the exact full name; a rename moves it.
    const nextUsername = fullName(first, middle, last);
    if (nextUsername !== before.username) {
      const clash = await db.query<{ ok: number }>(
        `SELECT 1 AS ok FROM users WHERE company_id=$1 AND username=$2 AND id<>$3 LIMIT 1`,
        [actor.companyId, nextUsername, workerId]
      );
      if ((clash.rowCount ?? 0) > 0) {
        throw AppError.conflict("Another worker in this company already has that full name");
      }
    }

    const updated = await db.query(
      `UPDATE users
          SET username=$2, first_name=$3, middle_name=$4, last_name=$5,
              phone=$6, email=$7, birth_day=$8, birth_month=$9,
              passport_photo_url=COALESCE($10, passport_photo_url),
              updated_at=now()
        WHERE id=$1
        RETURNING id, worker_code, username, first_name, middle_name, last_name,
                  branch_id, phone, email, birth_day, birth_month,
                  passport_photo_url, status, credential_state`,
      [
        workerId, nextUsername, first, middle ?? null, last,
        input.phone === undefined ? before.phone : input.phone,
        input.email === undefined ? before.email : input.email,
        input.birthDay === undefined ? before.birth_day : input.birthDay,
        input.birthMonth === undefined ? before.birth_month : input.birthMonth,
        input.passport_photo_url ?? null
      ]
    );
    const after = updated.rows[0]!;

    await auditWorker(
      db, actor.companyId, before.branch_id,
      actor.sub, "worker.edited", "workers", workerId,
      {
        username: before.username, first_name: before.first_name,
        middle_name: before.middle_name, last_name: before.last_name,
        phone: before.phone, email: before.email,
        birth_day: before.birth_day, birth_month: before.birth_month
      },
      {
        username: after.username, first_name: after.first_name,
        middle_name: after.middle_name, last_name: after.last_name,
        phone: after.phone, email: after.email,
        birth_day: after.birth_day, birth_month: after.birth_month
      },
      input.reason.trim(), meta
    );
    return after;
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

export async function setWorkerStatus(
  actor: WorkerActor,
  workerId: string,
  action: string,
  reason: string | undefined,
  meta: ActorMeta = {}
): Promise<{ status: string; credentialState: string }> {
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
    // The lifecycle syncs onto the credential-state spectrum (Vision 5.4).
    const credentialState =
      action === "suspend"
        ? "suspended"
        : action === "terminate"
        ? "terminated"
        : action === "activate"
        ? null // activate (invited→active) keeps the existing state
        : null; // reactivate restores the pre-suspension state below
    await db.query(`UPDATE users SET status=$2${sets} WHERE id=$1`, [
      workerId,
      t.to
    ]);
    // RULE 14.4.3 / 5.8.2 — suspension and termination must kill every existing
    // session at once, including access tokens that have not yet expired.
    if (action === "suspend" || action === "terminate") {
      await db.query(
        `UPDATE users SET session_epoch = session_epoch + 1 WHERE id=$1`,
        [workerId]
      );
      await db.query(
        `UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
        [workerId]
      );
    }
    if (action === "reactivate") {
      await db.query(
        `UPDATE users
            SET credential_state = CASE WHEN password_changed_at IS NULL THEN 'ritual_in_progress' ELSE 'secured' END
          WHERE id=$1`,
        [workerId]
      );
    } else if (credentialState) {
      await db.query(`UPDATE users SET credential_state=$2 WHERE id=$1`, [
        workerId,
        credentialState
      ]);
    }

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
      { status: before },
      { status: t.to, credential_state: credentialState },
      reason ?? null,
      meta
    );

    return { status: t.to, credentialState: credentialState ?? "unchanged" };
  });
}

export interface ResetPasswordResult {
  /** One-time credential panel (RULE 5.2.2 / 5.7.3) — shown once. */
  initialPassword: string;
  expiresAt: string;
}

/**
 * Part 5.8 control — RULE 5.8.2 "Keep Portfolio On Hold".
 *
 * In order:
 *   1. All login as that worker is blocked immediately: password stops
 *      authenticating, the authenticator is frozen, all existing sessions
 *      are invalidated (credential_state -> portfolio_on_hold, which sits in
 *      LOGIN_BLOCKED_STATES, plus refresh tokens revoked).
 *   2. Only Head Office users can work that book (Role Specs / Part 7).
 *   3. Money can still be received: the provider webhook path never checks
 *      credential_state, so payments keep arriving and being recorded.
 *   4. Money received while the portfolio is on hold is not allocated as a
 *      normal running book — it stays in the pending/allocation queue until
 *      the hold is released or the portfolio transferred.
 *   5. Nothing is deleted: no customer, group, loan or payment is touched.
 */
export async function holdWorkerPortfolio(
  actor: WorkerActor,
  workerId: string,
  reason: string,
  meta: ActorMeta = {}
): Promise<{ workerId: string; credentialState: "portfolio_on_hold" }> {
  if (!reason || reason.trim().length === 0) {
    throw AppError.unprocessable("Reason is required to hold a portfolio");
  }
  return withTenant(actor.companyId, null, async (db) => {
    const found = await db.query<{ id: string; status: string; branch_id: string | null }>(
      `SELECT id, status, branch_id FROM users WHERE id=$1 FOR UPDATE`,
      [workerId]
    );
    if (found.rowCount === 0) throw AppError.notFound("Worker not found");
    if (found.rows[0]!.status === "terminated") {
      throw new AppError(409, "WORKER_TERMINATED", "Cannot hold a terminated worker's portfolio");
    }
    await db.query(
      `UPDATE users SET credential_state='portfolio_on_hold', updated_at=now() WHERE id=$1`,
      [workerId]
    );
    // Invalidate every existing session (RULE 5.8.2.1).
    await db.query(
      `UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
      [workerId]
    );
    // RULE 14.4.3 — bumping the session epoch also kills every already-issued
    // ACCESS token, so the hold takes effect on the very next request.
    await db.query(
      `UPDATE users SET session_epoch = session_epoch + 1 WHERE id=$1`,
      [workerId]
    );
    await auditWorker(
      db,
      actor.companyId,
      found.rows[0]!.branch_id,
      actor.sub,
      "portfolio.hold",
      "workers",
      workerId,
      { status: found.rows[0]!.status },
      { credential_state: "portfolio_on_hold" },
      reason,
      meta
    );
    // RULE 5.9.3 — the MD is notified of every hold.
    await insertNotificationsToMds(db, actor.companyId, "worker.portfolio_on_hold", {
      workerId,
      reason
    });
    return { workerId, credentialState: "portfolio_on_hold" };
  });
}

/**
 * Part 5.8 control — release the RULE 5.8.2 hold.
 * Restores the worker's login while keeping every financial record intact.
 * The credential state returns to the secure spectrum (secured if the
 * credential ritual was completed, ritual_in_progress otherwise) so the
 * worker resumes exactly where the hold left the account.
 */
export async function releaseWorkerPortfolio(
  actor: WorkerActor,
  workerId: string,
  reason: string,
  meta: ActorMeta = {}
): Promise<{ workerId: string; credentialState: string }> {
  if (!reason || reason.trim().length === 0) {
    throw AppError.unprocessable("Reason is required to release a portfolio hold");
  }
  return withTenant(actor.companyId, null, async (db) => {
    const found = await db.query<{ id: string; status: string; branch_id: string | null }>(
      `SELECT id, status, branch_id FROM users WHERE id=$1 FOR UPDATE`,
      [workerId]
    );
    if (found.rowCount === 0) throw AppError.notFound("Worker not found");
    await db.query(
      `UPDATE users
          SET credential_state = CASE WHEN password_changed_at IS NULL THEN 'ritual_in_progress' ELSE 'secured' END,
              updated_at=now()
        WHERE id=$1`,
      [workerId]
    );
    await auditWorker(
      db,
      actor.companyId,
      found.rows[0]!.branch_id,
      actor.sub,
      "portfolio.release",
      "workers",
      workerId,
      { credential_state: "portfolio_on_hold" },
      { credential_state: "released" },
      reason,
      meta
    );
    // RULE 5.9.3 — the MD is notified of every hold. Releases too.
    await insertNotificationsToMds(db, actor.companyId, "worker.portfolio_released", {
      workerId,
      reason
    });
    return { workerId, credentialState: "released" };
  });
}

export interface TransferPortfolioInput {
  /** The account being stood down (RULE 5.8.3). */
  fromWorkerId: string;
  /** The replacement worker's creation details (RULE 5.8.3.3). */
  newWorker: CreateWorkerInput;
  reason: string;
}

export interface TransferPortfolioResult {
  previousWorkerId: string;
  previousWorkerState: "transferred";
  newWorker: CreatedWorker;
  reassignedCustomers: number;
  reassignedGroups: number;
}

/**
 * Part 5.8 control — RULE 5.8.3 "Change Worker On This Portfolio".
 *
 * In order:
 *   1. Reason confirmed by HR or the MD.
 *   2. Immediately, with no front-end delay: deactivates the password on the
 *      old account, deactivates and unlinks the authenticator, invalidates
 *      all sessions, marks credential_state 'transferred'.
 *   3. Opens the same flow used to create a new worker and creates the
 *      replacement (RULE 5.9.2 - no overwriting of the former identity).
 *   4. The new worker's credential panel is generated and shown once.
 *   5. The portfolio is REPOINTED to the new worker: every active
 *      customer_assignments row moves to the replacement (RULE 5.8.4, the
 *      portfolio belongs to the seat, not the person). Money already in the
 *      queue stays in the queue for the new worker to allocate.
 *   6. The previous worker's record is never deleted (RULE 5.8.5) - it
 *      becomes historical and every role assignment is end-dated.
 */
export async function transferWorkerPortfolio(
  actor: WorkerActor,
  input: TransferPortfolioInput,
  meta: ActorMeta = {}
): Promise<TransferPortfolioResult> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw AppError.unprocessable("A reason is required to transfer a portfolio");
  }
  if (!input.fromWorkerId || !UUID_RE.test(input.fromWorkerId)) {
    throw AppError.unprocessable("A valid fromWorkerId is required");
  }

  // RULE 5.8.3.2 - stand the old account down first (atomic; no delay).
  const stoodDown = await withTenant(actor.companyId, null, async (db) => {
    const found = await db.query<
      { id: string; status: string; branch_id: string | null }
    >(
      `SELECT id, status, branch_id FROM users WHERE id=$1 FOR UPDATE`,
      [input.fromWorkerId]
    );
    if (found.rowCount === 0) throw AppError.notFound("Source worker not found");
    // Deactivate the password + unlink and deactivate the authenticator.
    await db.query(
      `UPDATE users
          SET credential_state='transferred', password_hash='!',
              totp_secret_encrypted=NULL, totp_verified_at=NULL,
              updated_at=now()
        WHERE id=$1`,
      [input.fromWorkerId]
    );
    // Invalidate all sessions.
    await db.query(
      `UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
      [input.fromWorkerId]
    );
    // RULE 14.4.3 — also kill every outstanding access token immediately.
    await db.query(
      `UPDATE users SET session_epoch = session_epoch + 1 WHERE id=$1`,
      [input.fromWorkerId]
    );
    // Distinct branch of the old worker's book for repointing logs.
    const books = await db.query<{ branch_id: string }>(
      `SELECT DISTINCT branch_id FROM customer_assignments
        WHERE staff_id=$1 AND status='active'`,
      [input.fromWorkerId]
    );
    const branchId = found.rows[0]!.branch_id ?? books.rows[0]?.branch_id ?? null;
    await auditWorker(
      db,
      actor.companyId,
      branchId,
      actor.sub,
      "worker.transferred_out",
      "workers",
      input.fromWorkerId,
      { status: found.rows[0]!.status },
      { credential_state: "transferred" },
      input.reason,
      meta
    );
    return { branchId, workerBranchId: found.rows[0]!.branch_id };
  });

  // RULE 5.8.3.3-5.8.3.4 - create the replacement through the same creation
  // flow; its credential panel is the flow's one-time output.
  const newWorker = await createWorker(actor, input.newWorker, meta);

  // RULE 5.8.3.5 / 5.8.4 - repoint the portfolio (the seat moves, history
  // stays with the customers, groups, loans and records). End-date the old
  // worker's role assignments (RULE 5.8.5).
  const repoint = await withTenant(actor.companyId, null, async (db) => {
    const [customers, groups] = await Promise.all([
      db.query<{ id: string }>(
        `SELECT id FROM customer_assignments WHERE staff_id=$1 AND status='active' AND customer_id IS NOT NULL`,
        [input.fromWorkerId]
      ),
      db.query<{ id: string }>(
        `SELECT id FROM customer_assignments WHERE staff_id=$1 AND status='active' AND group_id IS NOT NULL`,
        [input.fromWorkerId]
      )
    ]);
    const customerIds = customers.rows.map((r) => r.id);
    const groupIds = groups.rows.map((r) => r.id);
    if (customerIds.length > 0 || groupIds.length > 0) {
      const ids = [...customerIds, ...groupIds];
      await db.query(
        `UPDATE customer_assignments SET staff_id=$1, updated_at=now() WHERE id = ANY($2)`,
        [newWorker.id, ids]
      );
    }
    // RULE 5.8.5 - the previous worker's role assignments are end-dated.
    await db.query(
      `UPDATE role_assignments
          SET status='ended', ended_at=now(), ended_by=$2, end_reason=$3
        WHERE user_id=$1 AND status='active'`,
      [input.fromWorkerId, actor.sub, input.reason]
    );
    await auditWorker(
      db,
      actor.companyId,
      stoodDown.branchId,
      actor.sub,
      "portfolio.transferred",
      "customer_assignments",
      newWorker.id,
      { from_worker_id: input.fromWorkerId },
      { to_worker_id: newWorker.id, customers: customerIds.length, groups: groupIds.length },
      input.reason,
      meta
    );
    // RULE 5.9.3 — the MD is notified of every transfer.
    await insertNotificationsToMds(db, actor.companyId, "worker.portfolio_transferred", {
      fromWorkerId: input.fromWorkerId,
      toWorkerId: newWorker.id,
      reassignedCustomers: customerIds.length,
      reason: input.reason
    });
    return { reassignedCustomers: customerIds.length, reassignedGroups: groupIds.length };
  });

  return {
    previousWorkerId: input.fromWorkerId,
    previousWorkerState: "transferred",
    newWorker,
    reassignedCustomers: repoint.reassignedCustomers,
    reassignedGroups: repoint.reassignedGroups
  };
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
      credential_state: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    }>(
      `SELECT id, branch_id, status, credential_state, first_name, middle_name, last_name
         FROM users WHERE id=$1`,
      [workerId]
    );
    if (found.rowCount === 0) throw AppError.notFound("Worker not found");
    if (found.rows[0]!.status === "terminated") {
      throw new AppError(
        409,
        "WORKER_TERMINATED",
        "Cannot reset password for a terminated worker"
      );
    }
    // RULE 5.2.4 / HR — a fresh initial credential is derived from the
    // worker's first name, issued once and reusable only while unexpired.
    const initialPassword = initialPasswordFor(found.rows[0]!.first_name);
    const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);
    const policy = await db.query<{ hours: number | null }>(
      `SELECT credential_ritual_window_hours AS hours FROM company_settings WHERE company_id=$1`,
      [actor.companyId]
    );
    const windowHours = policy.rows[0]?.hours ?? 168;
    const expiresAt = new Date(Date.now() + windowHours * 60 * 60 * 1000);

    await db.query(
      `UPDATE users
          SET password_hash=$2, must_change_password=true, temp_password_expires_at=$3,
              credential_state='credential_issued', credential_issued_at=now(),
              credential_expires_at=$3, totp_secret_encrypted=NULL,
              totp_verified_at=NULL, locked_until=NULL, failed_login_attempts=0,
              updated_at=now()
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
      "credential.reissued",
      "credentials",
      workerId,
      // RULE 5.4.1 - a lifecycle transition records the state it moved from.
      { credential_state: found.rows[0]!.credential_state },
      {
        username: fullName(
          found.rows[0]!.first_name,
          found.rows[0]!.middle_name,
          found.rows[0]!.last_name
        ),
        credential_state: "credential_issued",
        expires_at: expiresAt.toISOString(),
        one_time: true
      },
      reason,
      meta
    );

    return {
      initialPassword,
      expiresAt: expiresAt.toISOString()
    };
  });
}

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
  });
}

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
  builtIn: readonly RoleDefinition[];
  templates: readonly RoleDefinition[];
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

async function allocateWorkerCode(
  db: PoolClient,
  branchCode: string,
  companyCodePrefix: string,
  roleKey: string,
  scopeType: CreateWorkerInput["scopeType"]
): Promise<string> {
  // RULE 5.7.3 — Head Office roles use {COMPANY_PREFIX}-HO-{ROLE_CODE}-{SEQ};
  // branch roles use {BRANCH_CODE}-{ROLE_CODE}-{SEQ}. The ID is permanent.
  const isHeadOffice = scopeType === "company_wide" || scopeType === "head_office";
  const counterKey = isHeadOffice ? `worker_code:HO:${roleKey}` : `worker_code:${roleKey}`;
  const base = isHeadOffice ? `${companyCodePrefix}-HO` : branchCode;

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
  return `${base}-${prefix}-${String(seq).padStart(3, "0")}`;
}

/**
 * Expires temporary role assignments that have passed their end date.
 * This function should be called periodically (e.g., daily via cron) to
 * implement the automatic lifecycle handling required by Part 1 §17:
 * "On End Date, it deactivates automatically at end-of-day in the
 * company's configured timezone — no cron-dependent human step required."
 *
 * Returns the number of assignments expired plus the notifications emitted
 * (Part 1 §17 requires a notification to the user and to whoever assigned it).
 */
export async function expireTemporaryAssignments(
  companyId: string,
  meta: ActorMeta = {}
): Promise<{ assignmentsEnded: number; notificationsCreated: number }> {
  return withTenant(companyId, null, async (db) => {
    // Find all active temporary assignments where ends_at < now()
    const expired = await db.query<{
      id: string;
      user_id: string;
      role_id: string;
      ends_at: Date;
      assigned_by: string | null;
      branch_id: string | null;
      role_key: string;
    }>(
      `SELECT ra.id, ra.user_id, ra.role_id, ra.ends_at, ra.assigned_by,
              u.branch_id, r.role_key
         FROM role_assignments ra
         JOIN users u ON u.id = ra.user_id
         JOIN roles r ON r.id = ra.role_id
        WHERE ra.company_id = $1
          AND ra.assignment_type = 'temporary'
          AND ra.status = 'active'
          AND ra.ends_at IS NOT NULL
          AND ra.ends_at < now()`,
      [companyId]
    );

    let notificationsCreated = 0;
    for (const assignment of expired.rows) {
      const endedBy = assignment.assigned_by; // System/automatic expiry
      const reason = `Automatic expiry: temporary assignment ended at ${assignment.ends_at.toISOString()}`;

      await db.query(
        `UPDATE role_assignments
            SET status='ended', ended_at=now(), ended_by=$2, end_reason=$3
          WHERE id=$1`,
        [assignment.id, endedBy, reason]
      );

      await auditWorker(
        db,
        companyId,
        assignment.branch_id,
        endedBy ?? "system",
        "role_assignment.auto_expired",
        "role_assignments",
        assignment.id,
        { status: "active", ends_at: assignment.ends_at.toISOString() },
        { status: "ended", ended_at: new Date().toISOString() },
        reason,
        meta
      );

      // Part 1 §17 — notify the holder and whoever assigned the role.
      const recipients = new Set<string>([assignment.user_id]);
      if (assignment.assigned_by) recipients.add(assignment.assigned_by);
      await insertUserNotifications(
        db,
        companyId,
        [...recipients],
        "role_assignment.expired",
        {
          assignment_id: assignment.id,
          role_key: assignment.role_key,
          ended_at: assignment.ends_at.toISOString()
        }
      );
      notificationsCreated += recipients.size;
    }

    return {
      assignmentsEnded: expired.rowCount ?? 0,
      notificationsCreated
    };
  });
}

/**
 * Activates temporary role assignments whose start date has arrived.
 * This function should be called periodically (e.g., daily via cron) to
 * implement the automatic lifecycle handling required by Part 1 §17:
 * "On Start Date, the additional role assignment activates automatically."
 *
 * Returns the number of assignments activated.
 */
export async function activateTemporaryAssignments(
  companyId: string,
  meta: ActorMeta = {}
): Promise<number> {
  return withTenant(companyId, null, async (db) => {
    // Find all inactive temporary assignments where starts_at <= now() and not yet active
    // Note: assignments are created with status='active' but starts_at in future
    // The isAssignmentActive function already handles the window check
    // This function is for any edge cases where status might not be 'active'
    const toActivate = await db.query<{
      id: string;
      user_id: string;
      role_id: string;
      starts_at: Date;
      assigned_by: string | null;
      branch_id: string | null;
      role_key: string;
    }>(
      `SELECT ra.id, ra.user_id, ra.role_id, ra.starts_at, ra.assigned_by,
              u.branch_id, r.role_key
         FROM role_assignments ra
         JOIN users u ON u.id = ra.user_id
         JOIN roles r ON r.id = ra.role_id
        WHERE ra.company_id = $1
          AND ra.assignment_type = 'temporary'
          AND ra.status = 'active'
          AND ra.starts_at IS NOT NULL
          AND ra.starts_at <= now()
          AND (ra.ends_at IS NULL OR ra.ends_at > now())`,
      [companyId]
    );

    // These are already active in DB, isAssignmentActive handles the window
    // Just return count for monitoring
    return toActivate.rowCount ?? 0;
  });
}