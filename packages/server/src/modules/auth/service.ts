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
}

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
  user: Pick<UserRow, "id" | "company_id" | "branch_id">,
  assignments: AssignmentRow[]
): Principal {
  return resolvePrincipal({
    userId: user.id,
    companyId: user.company_id,
    branchId: user.branch_id,
    assignments
  });
}

const sha256 = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex");

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  principal: Principal;
  mustChangePassword: boolean;
}

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

async function issueSession(db: PoolClient, user: UserRow, meta: RequestMeta): Promise<IssuedSession> {
  const assignments = await loadAssignments(db, user.id, user.company_id);
  const principal = buildPrincipal(user, assignments);
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
    mcp: user.must_change_password
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
    mustChangePassword: user.must_change_password
  };
}

export async function login(
  hostHeader: string | undefined,
  username: string,
  password: string,
  meta: RequestMeta
): Promise<IssuedSession> {
  const ctx = await resolveHostContext(hostHeader);
  if (!ctx) throw AppError.unauthorized("Unknown portal address");

  return withTenantSession(ctx.companyId, ctx.branchId, async (db) => {
    const found = await db.query<UserRow>(
      `SELECT id, company_id, branch_id, username, password_hash, must_change_password,
              temp_password_expires_at, status
         FROM users WHERE company_id = $1 AND username = $2`,
      [ctx.companyId, username]
    );
    // Uniform failure — never reveal whether the username exists.
    if (found.rowCount === 0) throw AppError.unauthorized("Invalid credentials");
    const user = found.rows[0]!;

    if (user.status === "terminated") throw AppError.forbidden("Account terminated");
    if (user.status === "suspended") throw AppError.forbidden("Account suspended");

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw AppError.unauthorized("Invalid credentials");

    if (
      user.must_change_password &&
      user.temp_password_expires_at !== null &&
      user.temp_password_expires_at.getTime() < Date.now()
    ) {
      throw new AppError(403, "TEMP_PASSWORD_EXPIRED", "Temporary password has expired");
    }

    return issueSession(db, user, meta);
  });
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
    const locked = await db.query<{ token_hash: string; user_status: string }>(
      `SELECT token_hash,
              (SELECT status FROM users WHERE id = $1) AS user_status
         FROM refresh_tokens
        WHERE id = $2 AND revoked_at IS NULL AND expires_at > now()
          FOR UPDATE`,
      [tokenInfo.user_id, tokenInfo.id]
    );
    const row = locked.rows[0];
    if (!row || row.user_status !== "active") {
      throw AppError.unauthorized("Invalid or expired session");
    }

    await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [
      tokenInfo.id
    ]);
    const found = await db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [
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
): Promise<Principal> {
  return withTenantSession(companyId, branchId, async (db) => {
    const assignments = await loadAssignments(db, userId, companyId);
    return buildPrincipal({ id: userId, company_id: companyId, branch_id: branchId }, assignments);
  });
}

export async function changePassword(
  userId: string,
  companyId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (newPassword.length < 8) {
    throw AppError.unprocessable("New password must be at least 8 characters");
  }
  return withTenantSession(companyId, null, async (db) => {
    const found = await db.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [userId]);
    if (found.rowCount === 0) throw AppError.notFound("User not found");
    const user = found.rows[0]!;
    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) throw AppError.unauthorized("Current password is incorrect");

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.query(
      `UPDATE users
          SET password_hash = $2, must_change_password = false,
              temp_password_expires_at = NULL, updated_at = now()
        WHERE id = $1`,
      [userId, hash]
    );
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id=$1 AND revoked_at IS NULL`,
      [userId]
    );
  });
}
