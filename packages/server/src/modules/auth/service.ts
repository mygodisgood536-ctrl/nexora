import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { PoolClient } from "pg";
import {
  resolvePrincipal,
  type AssignmentInput,
  type Principal
} from "@nexora/shared";
import { withTenantSession } from "../../db/pool";
import { withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { parsePortalHost } from "../../lib/host";
import { signAccessToken } from "./tokens";
import {
  fullName,
  initialPasswordFor,
  ritualProgress,
  LOGIN_BLOCKED_STATES,
  stateBlockCode,
  type CredentialState
} from "../../lib/credential";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../../lib/totp";

const REFRESH_TTL_DAYS = 7;
const BCRYPT_ROUNDS = 10;

export interface ResolvedHostContext {
  companyId: string;
  companySlug: string;
  branchId: string | null;
}

export async function resolveHostContext(
  hostHeader: string | undefined
): Promise<ResolvedHostContext | null> {
  const candidates = parsePortalHost(hostHeader);
  if (candidates.length === 0) return Promise.resolve(null);

  // Step 1: resolve the company registry row through the audited bypass path
  // (companies policy accepts app.bypass_rls).
  for (const candidate of candidates) {
    const companyId: string | null = await withBypass(async (db) => {
      const company = await db.query<{ id: string }>(
        `SELECT id FROM companies WHERE slug = $1`,
        [candidate.companySlug]
      );
      return company.rowCount === 0 ? null : company.rows[0]!.id;
    });
    if (!companyId) continue;

    // Step 2: branch resolution happens INSIDE that company's tenant session,
    // where the branch rows are visible by normal tenant scoping.
    let branchId: string | null = null;
    if (candidate.branchSlug !== null) {
      const branch = await withTenantSession(companyId, null, async (db) => {
        const found = await db.query<{ id: string }>(
          `SELECT id FROM branches WHERE company_id = $1 AND slug = $2`,
          [companyId, candidate.branchSlug]
        );
        return found.rowCount === 0 ? null : found.rows[0]!.id;
      });
      if (!branch) continue;
      branchId = branch;
    }
    return {
      companyId,
      companySlug: candidate.companySlug,
      branchId
    };
  }
  return null;
}

interface UserRow {
  id: string;
  company_id: string;
  branch_id: string | null;
  username: string;
  password_hash: string;
  must_change_password: boolean;
  temp_password_expires_at: Date | null;
  status: string;
  credential_state: string;
  totp_secret_encrypted: string | null;
  totp_verified_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  profile_completed_at: Date | null;
  passport_file_hash: string | null;
  password_changed_at: Date | null;
  credential_issued_at: Date | null;
  credential_expires_at: Date | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  active_role_key: string | null;
}

const USER_COLUMNS = `id, company_id, branch_id, username, password_hash,
  must_change_password, temp_password_expires_at, status, credential_state,
  totp_secret_encrypted, totp_verified_at, failed_login_attempts, locked_until,
  profile_completed_at, passport_file_hash, password_changed_at,
  credential_issued_at, credential_expires_at, first_name, middle_name,
  last_name, active_role_key, session_epoch`;

type AssignmentRow = AssignmentInput & { permissions: string[] };

async function loadAssignments(db: PoolClient, userId: string, companyId: string): Promise<AssignmentRow[]> {
  const { rows } = await db.query<{
    role_key: string;
    scope_type: AssignmentInput["scopeType"];
    assignment_type: AssignmentInput["assignmentType"];
    status: AssignmentInput["status"];
    starts_at: Date;
    ends_at: Date | null;
    perms: string[] | null;
    branch_ids: string[] | null;
  }>(
    `SELECT r.role_key,
            ra.scope_type,
            ra.assignment_type,
            ra.status,
            ra.starts_at,
            ra.ends_at,
            ARRAY_AGG(DISTINCT rp.verb) AS perms,
            ARRAY_AGG(DISTINCT rab.branch_id) AS branch_ids
       FROM role_assignments ra
       JOIN roles r ON r.id = ra.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN role_assignment_branches rab ON rab.assignment_id = ra.id
      WHERE ra.user_id = $1 AND ra.company_id = $2
      GROUP BY r.role_key, ra.scope_type, ra.assignment_type, ra.status, ra.starts_at, ra.ends_at`,
    [userId, companyId]
  );
  return rows.map((r) => ({
    roleKey: r.role_key,
    scopeType: r.scope_type,
    branchIds: r.branch_ids ?? [],
    assignmentType: r.assignment_type,
    status: r.status,
    startsAt: new Date(r.starts_at),
    endsAt: r.ends_at ? new Date(r.ends_at) : null,
    permissions: r.perms ?? []
  }));
}

function buildPrincipal(
  user: Pick<UserRow, "id" | "company_id" | "branch_id" | "active_role_key">,
  assignments: AssignmentRow[]
): Principal & { activeRoleKey: string | null } {
  const base = resolvePrincipal({
    userId: user.id,
    companyId: user.company_id,
    branchId: user.branch_id,
    assignments
  });
  return {
    ...base,
    activeRoleKey: user.active_role_key
  };
}

const sha256 = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex");

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  principal: Principal & { activeRoleKey: string | null };
  mustChangePassword: boolean;
  credentialState: string;
}

interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

interface SecurityPolicy {
  passwordMinLength: number;
  lockoutThreshold: number;
  lockoutMinutes: number;
  ritualWindowHours: number;
}

const DEFAULT_POLICY: SecurityPolicy = {
  passwordMinLength: 8,
  lockoutThreshold: 5,
  lockoutMinutes: 15,
  ritualWindowHours: 168
};

async function loadSecurityPolicy(db: PoolClient, companyId: string): Promise<SecurityPolicy> {
  const { rows } = await db.query<{
    password_min_length: number | null;
    lockout_threshold: number | null;
    lockout_minutes: number | null;
    credential_ritual_window_hours: number | null;
  }>(
    `SELECT password_min_length, lockout_threshold, lockout_minutes,
            credential_ritual_window_hours
       FROM company_settings WHERE company_id=$1`,
    [companyId]
  );
  const r = rows[0];
  if (!r) return DEFAULT_POLICY;
  return {
    passwordMinLength: r.password_min_length ?? DEFAULT_POLICY.passwordMinLength,
    lockoutThreshold: r.lockout_threshold ?? DEFAULT_POLICY.lockoutThreshold,
    lockoutMinutes: r.lockout_minutes ?? DEFAULT_POLICY.lockoutMinutes,
    ritualWindowHours: r.credential_ritual_window_hours ?? DEFAULT_POLICY.ritualWindowHours
  };
}

/** Appends a security-state audit entry (RULE 5.10.1 — mandatory list). */
async function securityAudit(
  db: PoolClient,
  companyId: string,
  branchId: string | null,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  previousValue: unknown,
  newValue: unknown,
  reason: string | null,
  meta: RequestMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
    [
      companyId,
      branchId,
      userId,
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

async function issueSession(db: PoolClient, user: UserRow, meta: RequestMeta): Promise<IssuedSession> {
  const assignments = await loadAssignments(db, user.id, user.company_id);
  const principal = buildPrincipal(user, assignments);
  const secured = user.credential_state === "secured";
  const accessToken = signAccessToken({
    sub: user.id,
    companyId: user.company_id,
    branchId: user.branch_id,
    roles: principal.roles.map((r) => ({
      roleKey: r.roleKey,
      scopeType: r.scopeType,
      branchIds: [...r.branchIds],
      permissions: [...r.permissions]
    })),
    activeRoleKey: principal.activeRoleKey,
    mcp: !secured,
    cs: user.credential_state as CredentialState,
    // RULE 14.4.3 / 5.8.2 — stamping the epoch makes later revocation immediate.
    se: (user as unknown as { session_epoch: number }).session_epoch ?? 1
  });

  const refreshToken = crypto.randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO refresh_tokens (company_id, user_id, token_hash, expires_at, created_ip, user_agent)
     VALUES ($1,$2,$3, now() + ($4 || ' days')::interval, $5, $6)`,
    [
      user.company_id,
      user.id,
      sha256(refreshToken),
      String(REFRESH_TTL_DAYS),
      meta.ip ?? null,
      meta.userAgent ?? null
    ]
  );

  return {
    accessToken,
    refreshToken,
    principal,
    mustChangePassword: !secured,
    credentialState: user.credential_state
  };
}

type LoginOutcome =
  | { ok: true; session: IssuedSession }
  | { ok: false; status: number; code?: string; message: string };

export async function login(
  hostHeader: string | undefined,
  username: string,
  password: string,
  meta: RequestMeta
): Promise<IssuedSession> {
  const ctx = await resolveHostContext(hostHeader);
  if (!ctx) throw AppError.unauthorized("Unknown portal address");

  const outcome = await withTenantSession(ctx.companyId, ctx.branchId, async (db) => {
    // RULE 3.3.3 / 14.4.3 — a company that is still in setup, or that the
    // Platform Owner has suspended, admits no login at all. Only an active
    // company is reachable.
    const company = await db.query<{ status: string }>(
      `SELECT status FROM companies WHERE id=$1`,
      [ctx.companyId]
    );
    const companyStatus = (company.rowCount ?? 0) > 0 ? company.rows[0]!.status : "active";
    if (companyStatus !== "active") {
      return {
        ok: false,
        status: 403,
        code: "COMPANY_NOT_OPERATIONAL",
        message: `Company is ${companyStatus.replace(/_/g, " ")}`
      } satisfies LoginOutcome;
    }

    const found = await db.query<UserRow>(
      `SELECT ${USER_COLUMNS}
         FROM users WHERE company_id = $1 AND username = $2`,
      [ctx.companyId, username]
    );
    // Uniform failure — never reveal whether the username exists.
    if (found.rowCount === 0) {
      return { ok: false, status: 401, message: "Invalid credentials" } satisfies LoginOutcome;
    }
    const user = found.rows[0]!;

    // Terminal/blocked states (credential lifecycle, Vision 5.4).
    if (LOGIN_BLOCKED_STATES.has(user.credential_state as never)) {
      return {
        ok: false,
        status: 403,
        code: stateBlockCode(user.credential_state),
        message: `Account is ${user.credential_state.replace(/_/g, " ")}`
      } satisfies LoginOutcome;
    }
    if (user.status === "terminated") {
      return { ok: false, status: 403, code: "ACCOUNT_TERMINATED", message: "Account terminated" } satisfies LoginOutcome;
    }
    if (user.status === "suspended") {
      return { ok: false, status: 403, code: "ACCOUNT_SUSPENDED", message: "Account suspended" } satisfies LoginOutcome;
    }

    // RULE 7.9.2 — a suspended branch blocks its branch workers' logins. It
    // deletes nothing, stops no in-flight money and alters no record; it is
    // reversible. A closed or not-yet-opened branch likewise admits no work.
    if (user.branch_id) {
      const branch = await db.query<{ status: string }>(
        `SELECT status FROM branches WHERE id=$1`,
        [user.branch_id]
      );
      const branchStatus = (branch.rowCount ?? 0) > 0 ? branch.rows[0]!.status : "active";
      if (branchStatus !== "active") {
        return {
          ok: false,
          status: 403,
          code: "BRANCH_NOT_OPERATIONAL",
          message: `Branch is ${branchStatus.replace(/_/g, " ")}`
        } satisfies LoginOutcome;
      }
    }

    // Login lockout (Vision credential lifecycle — Frozen / RULE 5.10 lockout triggered).
    if (user.locked_until !== null && user.locked_until.getTime() > Date.now()) {
      await securityAudit(
        db,
        ctx.companyId,
        ctx.branchId,
        user.id,
        "login.failed",
        "security",
        user.id,
        undefined,
        { reason: "account locked", locked_until: user.locked_until.toISOString() },
        "Login denied while account is locked",
        meta
      );
      return { ok: false, status: 423, code: "ACCOUNT_LOCKED", message: "Account is temporarily locked" } satisfies LoginOutcome;
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const policy = await loadSecurityPolicy(db, ctx.companyId);
      const attempts = user.failed_login_attempts + 1;
      let locked_until: Date | null = null;
      if (attempts >= policy.lockoutThreshold) {
        locked_until = new Date(Date.now() + policy.lockoutMinutes * 60 * 1000);
        await db.query(
          `UPDATE users SET failed_login_attempts=$2, locked_until=$3, updated_at=now() WHERE id=$1`,
          [user.id, attempts, locked_until]
        );
        await securityAudit(
          db,
          ctx.companyId,
          ctx.branchId,
          user.id,
          "lockout.triggered",
          "security",
          user.id,
          { failed_login_attempts: attempts - 1, locked_until: null },
          { failed_login_attempts: attempts, locked_until: locked_until.toISOString() },
          "Login lockout threshold reached",
          meta
        );
      } else {
        await db.query(
          `UPDATE users SET failed_login_attempts=$2, updated_at=now() WHERE id=$1`,
          [user.id, attempts]
        );
      }
      await securityAudit(
        db,
        ctx.companyId,
        ctx.branchId,
        user.id,
        "login.failed",
        "security",
        user.id,
        undefined,
        { provider: "password" },
        null,
        meta
      );
      return { ok: false, status: 401, message: "Invalid credentials" } satisfies LoginOutcome;
    }

    // Initial credential window expiry (RULE 5.2.3.5 / 5.4 credential expired).
    if (
      (user.credential_state === "credential_issued" ||
        user.credential_state === "ritual_in_progress") &&
      user.credential_expires_at !== null &&
      user.credential_expires_at.getTime() < Date.now()
    ) {
      await db.query(
        `UPDATE users SET credential_state='credential_expired', updated_at=now() WHERE id=$1`,
        [user.id]
      );
      await securityAudit(
        db,
        ctx.companyId,
        ctx.branchId,
        user.id,
        "credential.expired",
        "credentials",
        user.id,
        { credential_state: user.credential_state },
        { credential_state: "credential_expired" },
        "Initial credential passed its window without being consumed",
        meta
      );
      return { ok: false, status: 403, code: "CREDENTIAL_EXPIRED", message: "Initial credential has expired" } satisfies LoginOutcome;
    }

    await db.query(
      `UPDATE users SET failed_login_attempts=0, locked_until=NULL, last_login_at=now(), updated_at=now()
        WHERE id=$1`,
      [user.id]
    );
    await securityAudit(
      db,
      ctx.companyId,
      ctx.branchId,
      user.id,
      "login.succeeded",
      "security",
      user.id,
      undefined,
      { provider: "password" },
      null,
      meta
    );
    const session = await issueSession(db, { ...user, failed_login_attempts: 0, locked_until: null }, meta);
    return { ok: true, session } satisfies LoginOutcome;
  });

  if (!outcome.ok) {
    throw new AppError(outcome.status, outcome.code ?? "UNAUTHORIZED", outcome.message);
  }
  return outcome.session;
}

export async function refresh(
  refreshToken: string | undefined,
  meta: RequestMeta
): Promise<IssuedSession> {
  if (!refreshToken) throw AppError.unauthorized("Missing refresh token");
  const hash = sha256(refreshToken);

  // Phase 1: identify the token row through the audited bypass path
  // (the cookie itself carries the tenant identity).
  const tokenInfo = await withBypass(async (db) => {
    const found = await db.query<{ id: string; company_id: string; user_id: string }>(
      `SELECT id, company_id, user_id
         FROM refresh_tokens
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hash]
    );
    return found.rows[0] ?? null;
  });
  if (!tokenInfo) throw AppError.unauthorized("Invalid or expired session");

  // Phase 2: rotate + re-issue inside the token's own tenant session.
  return withTenantSession(tokenInfo.company_id, null, async (db) => {
    const locked = await db.query<{ token_hash: string; user_status: string; credential_state: string }>(
      `SELECT token_hash,
              (SELECT status FROM users WHERE id = $1) AS user_status,
              (SELECT credential_state FROM users WHERE id = $1) AS credential_state
         FROM refresh_tokens
        WHERE id = $2 AND revoked_at IS NULL AND expires_at > now()
          FOR UPDATE`,
      [tokenInfo.user_id, tokenInfo.id]
    );
    const row = locked.rows[0];
    if (
      !row ||
      row.user_status !== "active" ||
      // Blocked lifecycle states cannot keep a live session (RULE 5.8.2/5.8.3).
      LOGIN_BLOCKED_STATES.has(row.credential_state as never)
    ) {
      throw AppError.unauthorized("Invalid or expired session");
    }

    await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [
      tokenInfo.id
    ]);
    const found = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [
      tokenInfo.user_id
    ]);
    const user = found.rows[0]!;
    return issueSession(db, user, meta);
  });
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await withBypass((db) =>
    db
      .query(
        `UPDATE refresh_tokens SET revoked_at = now()
          WHERE token_hash = $1 AND revoked_at IS NULL`,
        [sha256(refreshToken)]
      )
      .then(() => undefined)
  );
}

/** Re-resolves the live principal from the database for the current user. */
export async function currentPrincipal(
  userId: string,
  companyId: string,
  branchId: string | null
): Promise<Principal & { activeRoleKey: string | null }> {
  return withTenantSession(companyId, branchId, async (db) => {
    const assignments = await loadAssignments(db, userId, companyId);
    const user = await db.query<UserRow>(`SELECT id, company_id, branch_id, active_role_key FROM users WHERE id=$1`, [userId]);
    return buildPrincipal({ id: userId, company_id: companyId, branch_id: branchId, active_role_key: user.rows[0]?.active_role_key ?? null }, assignments);
  });
}

function validateNewPassword(newPassword: string, user: UserRow, policy: SecurityPolicy): void {
  if (newPassword.length < policy.passwordMinLength) {
    throw AppError.unprocessable(
      `New password must be at least ${policy.passwordMinLength} characters`
    );
  }
  const lower = newPassword.toLowerCase();
  const forbidden = [
    initialPasswordFor(user.first_name).toLowerCase(),
    user.username.toLowerCase(),
    fullName(user.first_name, user.middle_name, user.last_name).toLowerCase(),
    user.first_name.toLowerCase(),
    user.last_name.toLowerCase()
  ];
  if (forbidden.includes(lower)) {
    throw AppError.unprocessable(
      "New password must not equal the initial credential, the username or the person's name"
    );
  }
}

function decryptTotpSecret(encoded: string | null): string | null {
  if (!encoded) return null;
  return Buffer.from(encoded.split(".")[0]!, "base64").toString("utf8");
}

function requireLiveTotp(user: UserRow, code: string | undefined): void {
  const secret = decryptTotpSecret(user.totp_secret_encrypted);
  if (!secret) {
    throw AppError.unprocessable("Authenticator is not enrolled on this account");
  }
  if (!verifyTotp(secret, code ?? "")) {
    throw AppError.unauthorized("Authenticator code is invalid or expired");
  }
}

/**
 * Change password for a SECURED account — a sensitive action that must be
 * authorised by the live authenticator (RULE 5.3.2).
 */
export async function changePassword(
  userId: string,
  companyId: string,
  currentPassword: string,
  newPassword: string,
  totpCode: string,
  meta: RequestMeta = {}
): Promise<void> {
  return withTenantSession(companyId, null, async (db) => {
    const found = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    if (found.rowCount === 0) throw AppError.notFound("User not found");
    const user = found.rows[0]!;
    const policy = await loadSecurityPolicy(db, companyId);
    validateNewPassword(newPassword, user, policy);

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) throw AppError.unauthorized("Current password is incorrect");
    requireLiveTotp(user, totpCode);

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.query(
      `UPDATE users
          SET password_hash = $2, must_change_password = false,
              temp_password_expires_at = NULL, password_changed_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [userId, hash]
    );
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id=$1 AND revoked_at IS NULL`,
      [userId]
    );
    await securityAudit(
      db,
      companyId,
      user.branch_id,
      userId,
      "password.changed",
      "credentials",
      userId,
      undefined,
      { sensitive: true, verified_with: "authenticator" },
      null,
      meta
    );
  });
}

// ---------- Credential ritual (RULE 4.2.1 / 5.3.1) ----------

export async function ritualStatus(
  userId: string,
  companyId: string
): Promise<{
  credentialState: string;
  steps: ReturnType<typeof ritualProgress>["steps"];
  nextStep: ReturnType<typeof ritualProgress>["nextStep"];
}> {
  return withTenantSession(companyId, null, async (db) => {
    const found = await db.query<{
      credential_state: string;
      password_changed_at: Date | null;
      totp_secret_encrypted: string | null;
      totp_verified_at: Date | null;
      profile_completed_at: Date | null;
    }>(
      `SELECT credential_state, password_changed_at, totp_secret_encrypted,
              totp_verified_at, profile_completed_at
         FROM users WHERE id=$1`,
      [userId]
    );
    if (found.rowCount === 0) throw AppError.notFound("User not found");
    const user = found.rows[0]!;
    const progress = ritualProgress(user);
    return {
      credentialState: user.credential_state,
      steps: progress.steps,
      nextStep: progress.nextStep
    };
  });
}

/**
 * Step 2 — set up the authenticator: generate an enrolment secret. Resumable
 * (RULE 5.2.3.4): an existing unverified enrolment is returned as-is.
 */
export async function ritualEnrollment(
  userId: string,
  companyId: string,
  meta: RequestMeta
): Promise<{ secret: string; otpauthUri: string }> {
  return withTenantSession(companyId, null, async (db) => {
    const found = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    if (found.rowCount === 0) throw AppError.notFound("User not found");
    const user = found.rows[0]!;
    if (user.credential_state === "secured") {
      throw AppError.conflict("Account is already secured");
    }
    const existing = decryptTotpSecret(user.totp_secret_encrypted);
    if (existing && user.totp_verified_at) {
      throw AppError.conflict("Authenticator is already verified on this account");
    }
    if (existing) {
      return { secret: existing, otpauthUri: otpauthUri(user.username, existing) };
    }
    const secret = generateTotpSecret();
    await db.query(
      `UPDATE users
          SET totp_secret_encrypted=$2, credential_state='ritual_in_progress', updated_at=now()
        WHERE id=$1`,
      [userId, Buffer.from(secret).toString("base64") + ".v1"]
    );
    await securityAudit(
      db,
      companyId,
      user.branch_id,
      userId,
      "authenticator.setup",
      "credentials",
      userId,
      // RULE 5.4.1 - the lifecycle state this transition moved from is recorded.
      { credential_state: user.credential_state },
      { method: "totp", state: "ritual_in_progress" },
      null,
      meta
    );
    return { secret, otpauthUri: otpauthUri(user.username, secret) };
  });
}

/** Step 3 — verify the authenticator with a live code (binds it). */
export async function ritualVerifyAuthenticator(
  userId: string,
  companyId: string,
  code: string,
  meta: RequestMeta
): Promise<void> {
  return withTenantSession(companyId, null, async (db) => {
    const found = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    if (found.rowCount === 0) throw AppError.notFound("User not found");
    const user = found.rows[0]!;
    if (user.credential_state === "secured") {
      throw AppError.conflict("Account is already secured");
    }
    requireLiveTotp(user, code);
    await db.query(
      `UPDATE users SET totp_verified_at=now(), updated_at=now() WHERE id=$1`,
      [userId]
    );
    await securityAudit(
      db,
      companyId,
      user.branch_id,
      userId,
      "authenticator.verified",
      "credentials",
      userId,
      undefined,
      { method: "totp", live_code: true },
      null,
      meta
    );
  });
}

/**
 * Step 1 — change the password. The change is verified with a live
 * authenticator code (RULE 5.3.1.1) and consumes the initial credential the
 * moment it succeeds (RULE 5.2.3.3).
 */
export async function ritualChangePassword(
  userId: string,
  companyId: string,
  currentPassword: string,
  newPassword: string,
  totpCode: string,
  meta: RequestMeta
): Promise<void> {
  return withTenantSession(companyId, null, async (db) => {
    const found = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    if (found.rowCount === 0) throw AppError.notFound("User not found");
    const user = found.rows[0]!;
    if (user.credential_state === "secured") {
      throw AppError.conflict("Account is already secured");
    }
    const policy = await loadSecurityPolicy(db, companyId);
    validateNewPassword(newPassword, user, policy);

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) throw AppError.unauthorized("Current password is incorrect");

    // The live code both proves the change is the user's own and, when the
    // authenticator had not been verified yet, binds it (steps 2-3 combined).
    requireLiveTotp(user, totpCode);
    const firstVerification = user.totp_verified_at === null;

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.query(
      `UPDATE users
          SET password_hash=$2, must_change_password=false,
              temp_password_expires_at=NULL, password_changed_at=now(),
              totp_verified_at=COALESCE(totp_verified_at, now()),
              updated_at=now()
        WHERE id=$1`,
      [userId, hash]
    );
    await db.query(
      `UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
      [userId]
    );
    await securityAudit(
      db,
      companyId,
      user.branch_id,
      userId,
      "credential.consumed",
      "credentials",
      userId,
      { credential_state: user.credential_state },
      { credential_state: "ritual_in_progress", initial_credential_destroyed: true },
      "Initial credential consumed by mandatory ritual password change",
      meta
    );
    await securityAudit(
      db,
      companyId,
      user.branch_id,
      userId,
      "password.changed",
      "credentials",
      userId,
      { credential_state: user.credential_state },
      { during: "ritual", verified_with: "authenticator" },
      null,
      meta
    );
    if (firstVerification) {
      await securityAudit(
        db,
        companyId,
        user.branch_id,
        userId,
        "authenticator.verified",
        "credentials",
        userId,
        { credential_state: user.credential_state },
        { method: "totp", live_code: true },
        null,
        meta
      );
    }
  });
}

/** Step 4 — complete the profile (full name + passport) and become secured. */
export async function ritualCompleteProfile(
  userId: string,
  companyId: string,
  profile: {
    passportPhotoUrl?: string | null;
    passportFileHash?: string | null;
    phone?: string | null;
    birthDay?: number | null;
    birthMonth?: number | null;
  },
  meta: RequestMeta
): Promise<IssuedSession> {
  return withTenantSession(companyId, null, async (db) => {
    const found = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    if (found.rowCount === 0) throw AppError.notFound("User not found");
    const user = found.rows[0]!;
    if (user.credential_state === "secured") {
      throw AppError.conflict("Account is already secured");
    }
    if (user.password_changed_at === null || user.totp_verified_at === null) {
      throw AppError.unprocessable(
        "Change the password and verify the authenticator before completing the profile"
      );
    }
    await db.query(
      `UPDATE users
          SET profile_completed_at=now(),
              passport_photo_url=COALESCE($2, passport_photo_url),
              passport_file_hash=COALESCE($3, passport_file_hash),
              phone=COALESCE($4, phone),
              birth_day=COALESCE($5, birth_day),
              birth_month=COALESCE($6, birth_month),
              credential_state='secured', status='active', updated_at=now()
        WHERE id=$1`,
      [
        userId,
        profile.passportPhotoUrl ?? null,
        profile.passportFileHash ?? null,
        profile.phone ?? null,
        profile.birthDay ?? null,
        profile.birthMonth ?? null
      ]
    );
    const completed = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id=$1`, [
      userId
    ]);
    await securityAudit(
      db,
      companyId,
      user.branch_id,
      userId,
      "profile.completed",
      "workers",
      userId,
      { credential_state: user.credential_state },
      {
        credential_state: "secured",
        passport_file_hash: profile.passportFileHash ?? null
      },
      null,
      meta
    );
    const session = await issueSession(db, completed.rows[0]!, meta);
    return session;
  });
}

/** Sets the user's active role lens (UI preference for dashboard/context). */
export async function setActiveRoleLens(
  userId: string,
  companyId: string,
  roleKey: string | null
): Promise<void> {
  return withTenantSession(companyId, null, async (db) => {
    if (roleKey !== null) {
      // Verify the user has an active assignment for this role at the current context
      const hasRole = await db.query<{ 1: number }>(
        `SELECT 1 FROM role_assignments ra
           JOIN roles r ON r.id = ra.role_id
          WHERE ra.user_id = $1 AND ra.company_id = $2
            AND r.role_key = $3
            AND ra.status = 'active'
            AND (ra.assignment_type = 'permanent' OR (ra.starts_at <= now() AND (ra.ends_at IS NULL OR ra.ends_at > now())))
          LIMIT 1`,
        [userId, companyId, roleKey]
      );
      if (hasRole.rowCount === 0) {
        throw AppError.forbidden("User does not have an active assignment for this role");
      }
    }
    await db.query(
      `UPDATE users SET active_role_key = $2, updated_at = now() WHERE id = $1`,
      [userId, roleKey]
    );
  });
}

/** Gets the user's active role lens. */
export async function getActiveRoleLens(
  userId: string,
  companyId: string
): Promise<{ activeRoleKey: string | null }> {
  return withTenantSession(companyId, null, async (db) => {
    const found = await db.query<{ active_role_key: string | null }>(
      `SELECT active_role_key FROM users WHERE id = $1`,
      [userId]
    );
    return { activeRoleKey: found.rows[0]?.active_role_key ?? null };
  });
}