import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { withTenantSession } from "../../db/pool";
import { withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { verifyTotp } from "../../lib/totp";

const PO_JWT_SECRET = env.JWT_SECRET + "|po";

type PoolClientLike = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

export interface PoClaims {
  sub: string;
  typ: "po";
  email: string;
}

export function signPoAccessToken(claims: PoClaims): string {
  return jwt.sign(claims, PO_JWT_SECRET, { algorithm: "HS256", expiresIn: "30m" });
}

export function verifyPoToken(token: string): PoClaims {
  try {
    const claims = jwt.verify(token, PO_JWT_SECRET, { algorithms: ["HS256"] }) as PoClaims;
    if (claims.typ !== "po") throw new Error("wrong type");
    return claims;
  } catch {
    throw AppError.unauthorized("Invalid platform session");
  }
}

const sha256 = (v: string): string => crypto.createHash("sha256").update(v).digest("hex");

function unwrapSecret(email: string, encrypted: string): string {
  const [b64] = encrypted.split(".");
  void email;
  return Buffer.from(b64!, "base64").toString("utf8");
}

async function lockoutThreshold(db: PoolClientLike): Promise<number> {
  const r = await db.query(`SELECT value FROM global_settings WHERE key='security_policy'`);
  const value = (r.rows[0] as { value?: { po_lockout_threshold?: number } } | undefined)?.value;
  return value?.po_lockout_threshold ?? 5;
}

export interface PoSession {
  accessToken: string;
  refreshToken: string;
  owner: { id: string; email: string };
}

export async function poLogin(
  email: string,
  password: string,
  totpCode: string | undefined,
  meta: { ip?: string; userAgent?: string }
): Promise<PoSession> {
  return withBypass(async (db) => {
    const found = await db.query<{
      id: string;
      email: string;
      password_hash: string;
      totp_enabled: boolean;
      totp_secret_encrypted: string | null;
      failed_attempts: number;
      locked_until: Date | null;
    }>(`SELECT * FROM platform_owners WHERE email=$1`, [email]);
    if (found.rowCount === 0) throw AppError.unauthorized("Incorrect email or password");
    const po = found.rows[0]!;

    if (po.locked_until && po.locked_until.getTime() > Date.now()) {
      throw new AppError(423, "ACCOUNT_LOCKED", "Account temporarily locked");
    }

    const okPw = await bcrypt.compare(password, po.password_hash);
    if (!okPw) {
      const attempts = po.failed_attempts + 1;
      const threshold = await lockoutThreshold(db);
      if (attempts >= threshold) {
        await db.query(
          `UPDATE platform_owners SET failed_attempts=$2, locked_until = now() + interval '15 minutes' WHERE id=$1`,
          [po.id, attempts]
        );
        throw new AppError(423, "ACCOUNT_LOCKED", "Too many attempts — account locked for 15 minutes");
      }
      await db.query(`UPDATE platform_owners SET failed_attempts=$2 WHERE id=$1`, [po.id, attempts]);
      throw AppError.unauthorized("Incorrect email or password");
    }

    let secretPlain: string | null = null;
    if (po.totp_secret_encrypted) secretPlain = unwrapSecret(po.email, po.totp_secret_encrypted);

    if (secretPlain && !totpCode) {
      throw new AppError(401, "TOTP_REQUIRED", "Second factor required");
    }
    if (secretPlain && totpCode && !verifyTotp(secretPlain, totpCode)) {
      const attempts = po.failed_attempts + 1;
      const threshold = await lockoutThreshold(db);
      if (attempts >= threshold) {
        await db.query(
          `UPDATE platform_owners SET failed_attempts=$2, locked_until = now() + interval '15 minutes' WHERE id=$1`,
          [po.id, attempts]
        );
        throw new AppError(423, "ACCOUNT_LOCKED", "Too many attempts — account locked for 15 minutes");
      }
      await db.query(`UPDATE platform_owners SET failed_attempts=$2 WHERE id=$1`, [po.id, attempts]);
      throw AppError.unauthorized("Invalid second factor");
    }

    await db.query(
      `UPDATE platform_owners SET failed_attempts=0, locked_until=NULL, last_login_at=now() WHERE id=$1`,
      [po.id]
    );

    const claims: PoClaims = { sub: po.id, typ: "po", email: po.email };
    const accessToken = signPoAccessToken(claims);
    const refreshToken = crypto.randomBytes(32).toString("base64url");
    await db.query(
      `INSERT INTO refresh_tokens (platform_owner_id, token_hash, expires_at, created_ip, user_agent)
       VALUES ($1,$2, now() + interval '7 days', $3, $4)`,
      [po.id, sha256(refreshToken), meta.ip ?? null, meta.userAgent ?? null]
    );
    await audit(db, po.email, "platform.login", "platform_owners", po.id);
    return { accessToken, refreshToken, owner: { id: po.id, email: po.email } };
  });
}

export async function audit(
  db: PoolClientLike,
  actor: string,
  action: string,
  entityType: string,
  entityId: string | null,
  previousValue?: unknown,
  newValue?: unknown,
  reason?: string,
  companyId?: string | null
): Promise<void> {
  await db.query(
    `INSERT INTO platform_audit_logs (actor, action, company_id, previous_value, new_value, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      actor,
      `${entityType}.${action}`,
      companyId ?? null,
      previousValue === undefined ? null : JSON.stringify(previousValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      reason ?? null
    ]
  );
}

export interface PoRefreshResult {
  accessToken: string;
  refreshToken: string;
  owner: { id: string; email: string };
}

export async function poRefresh(refreshToken: string | undefined): Promise<PoRefreshResult> {
  if (!refreshToken) throw AppError.unauthorized("Missing refresh token");
  const hash = sha256(refreshToken);
  return withBypass(async (db) => {
    const found = await db.query<{ id: string; platform_owner_id: string; email: string }>(
      `SELECT rt.id, rt.platform_owner_id, po.email
         FROM refresh_tokens rt
         JOIN platform_owners po ON po.id = rt.platform_owner_id
        WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL AND rt.expires_at > now()`,
      [hash]
    );
    const row = found.rows[0];
    if (!row) throw AppError.unauthorized("Invalid or expired session");
    await db.query(`UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1`, [row.id]);
    const claims: PoClaims = { sub: row.platform_owner_id, typ: "po", email: row.email };
    const accessToken = signPoAccessToken(claims);
    const nextToken = crypto.randomBytes(32).toString("base64url");
    await db.query(
      `INSERT INTO refresh_tokens (platform_owner_id, token_hash, expires_at)
       VALUES ($1,$2, now() + interval '7 days')`,
      [row.platform_owner_id, sha256(nextToken)]
    );
    return {
      accessToken,
      refreshToken: nextToken,
      owner: { id: row.platform_owner_id, email: row.email }
    };
  });
}

export async function poLogout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await withBypass((db) =>
    db
      .query(
        `UPDATE refresh_tokens SET revoked_at=now()
          WHERE token_hash=$1 AND revoked_at IS NULL`,
        [sha256(refreshToken)]
      )
      .then(() => undefined)
  );
}

// ---------- companies ----------

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export async function createCompany(
  poEmail: string,
  input: { name: string; contactEmail?: string; planTier?: string; codePrefix: string }
): Promise<{ id: string; slug: string; code_prefix: string }> {
  return withBypass(async (db) => {
    const prefix = input.codePrefix.toUpperCase();
    const dup = await db.query(`SELECT 1 FROM companies WHERE code_prefix=$1`, [prefix]);
    if ((dup.rowCount ?? 0) > 0) throw new AppError(409, "PREFIX_TAKEN", "Company code prefix already in use");

    let slug = slugify(input.name);
    let n = 1;
    while (((await db.query(`SELECT 1 FROM companies WHERE slug=$1`, [slug])).rowCount ?? 0) > 0) {
      slug = `${slugify(input.name)}-${++n}`;
    }

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO companies (name, code_prefix, slug, contact_email, plan_tier, status,
                              created_by_platform_owner)
       VALUES ($1,$2,$3,$4,$5,'in_setup',
               (SELECT id FROM platform_owners WHERE email=$6))
       RETURNING id`,
      [input.name, prefix, slug, input.contactEmail ?? null, input.planTier ?? null, poEmail]
    );
    const companyId = rows[0]!.id;

    await db.query(`INSERT INTO themes (company_id) VALUES ($1)`, [companyId]);
    await db.query(`INSERT INTO company_settings (company_id) VALUES ($1)`, [companyId]);
    await db.query(
      `INSERT INTO company_counters (company_id, counter_key, next_value)
       VALUES ($1,'branch_seq',1),($1,'customer_seq',1)`,
      [companyId]
    );
    await db.query(
      `INSERT INTO company_enabled_roles (company_id, role_key, enabled)
       SELECT $1, role_key, true FROM platform_role_catalogue`,
      [companyId]
    );
    await audit(
      db,
      poEmail,
      "created",
      "companies",
      companyId,
      null,
      { name: input.name, code_prefix: prefix, slug },
      undefined,
      companyId
    );
    return { id: companyId, slug, code_prefix: prefix };
  });
}

const TRANSITIONS: Record<string, { from: string[]; to: string; needsReason?: boolean }> = {
  submit_for_activation: { from: ["in_setup"], to: "pending_activation" },
  activate: { from: ["in_setup", "pending_activation"], to: "active" },
  suspend: { from: ["active"], to: "suspended", needsReason: true },
  reactivate: { from: ["suspended"], to: "active" }
};

export async function setCompanyStatus(
  poEmail: string,
  companyId: string,
  action: string,
  reason?: string
): Promise<{ status: string }> {
  return withBypass(async (db) => {
    const t = TRANSITIONS[action];
    if (!t) throw AppError.badRequest("Unknown status action");

    const found = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM companies WHERE id=$1`,
      [companyId]
    );
    if (found.rowCount === 0) throw AppError.notFound("Company not found");
    const before = found.rows[0]!.status;
    if (!t.from.includes(before)) {
      throw new AppError(409, "INVALID_TRANSITION", `Cannot ${action} from ${before}`);
    }
    if (t.needsReason && !reason) throw AppError.unprocessable("Reason is required");

    const sets =
      t.to === "active"
        ? `, activated_at=COALESCE(activated_at, now()), suspended_at=NULL`
        : t.to === "suspended"
          ? `, suspended_at=now()`
          : ``;
    await db.query(`UPDATE companies SET status=$2${sets}, last_activity_at=now() WHERE id=$1`, [
      companyId,
      t.to
    ]);
    await audit(
      db,
      poEmail,
      action,
      "companies",
      companyId,
      { status: before },
      { status: t.to },
      reason,
      companyId
    );
    return { status: t.to };
  });
}

export async function listCompanies(): Promise<unknown[]> {
  return withBypass(async (db) => {
    const { rows } = await db.query(`
      SELECT c.id, c.name, c.slug, c.code_prefix, c.status, c.plan_tier,
             c.created_at, c.last_activity_at,
             (SELECT count(*)::int FROM users u WHERE u.company_id=c.id) AS users,
             (SELECT count(*)::int FROM customers cu WHERE cu.company_id=c.id) AS customers,
             (SELECT count(*)::int FROM branches b WHERE b.company_id=c.id) AS branches
        FROM companies c ORDER BY c.created_at DESC`);
    return rows;
  });
}

// ---------- support access (PO Spec §39/§40) ----------

export async function openSupportSession(
  poEmail: string,
  companyId: string,
  reason: string,
  durationMinutes: number
): Promise<{ id: string; expiresAt: Date }> {
  if (!reason || reason.trim().length < 10) {
    throw AppError.unprocessable("A detailed reason is required");
  }
  const minutes = Math.max(5, Math.min(durationMinutes || 30, 480));
  return withBypass(async (db) => {
    const exists = await db.query(`SELECT 1 FROM companies WHERE id=$1`, [companyId]);
    if (exists.rowCount === 0) throw AppError.notFound("Company not found");
    const { rows } = await db.query<{ id: string; expires_at: Date }>(
      `INSERT INTO support_access_sessions (company_id, reason, requested_by, expires_at)
       VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval) RETURNING id, expires_at`,
      [companyId, reason.trim(), poEmail, String(minutes)]
    );
    await audit(
      db,
      poEmail,
      "opened",
      "support_access_sessions",
      rows[0]!.id,
      null,
      { reason, minutes },
      reason,
      companyId
    );
    return { id: rows[0]!.id, expiresAt: rows[0]!.expires_at };
  });
}

export async function closeSupportSession(poEmail: string, sessionId: string): Promise<void> {
  await withBypass(async (db) => {
    const r = await db.query(
      `UPDATE support_access_sessions SET closed_at=now()
        WHERE id=$1 AND closed_at IS NULL RETURNING company_id`,
      [sessionId]
    );
    if (r.rowCount === 0) throw AppError.notFound("Open session not found");
    await audit(
      db,
      poEmail,
      "closed",
      "support_access_sessions",
      sessionId,
      undefined,
      undefined,
      undefined,
      r.rows[0]!.company_id
    );
  });
}

export async function listSupportSessions(): Promise<unknown[]> {
  return withBypass(async (db) => {
    const { rows } = await db.query(`
      SELECT s.id, s.company_id, co.name AS company_name, s.reason, s.requested_by,
             s.opened_at, s.expires_at, s.closed_at,
             (s.closed_at IS NULL AND s.expires_at > now()) AS is_open
        FROM support_access_sessions s JOIN companies co ON co.id=s.company_id
       ORDER BY s.opened_at DESC LIMIT 100`);
    return rows;
  });
}

/** Aggregate-only summary; reachable solely inside an open, time-bound
 *  Support Access session. Never exposes individual records. */
export async function companySummary(
  poEmail: string,
  sessionId: string,
  companyId: string
): Promise<Record<string, unknown>> {
  await withBypass(async (db) => {
    const r = await db.query(
      `SELECT 1 FROM support_access_sessions
        WHERE id=$1 AND company_id=$2 AND closed_at IS NULL AND expires_at > now()`,
      [sessionId, companyId]
    );
    if (r.rowCount === 0) throw new AppError(403, "SUPPORT_SESSION_REQUIRED", "No open support access session");
  });
  const counts = await withTenantSession(companyId, null, async (db) => {
    const r = await db.query(`
      SELECT (SELECT count(*)::int FROM users) AS users,
             (SELECT count(*)::int FROM customers) AS customers,
             (SELECT count(*)::int FROM branches) AS branches,
             (SELECT count(*)::int FROM loans WHERE status='active') AS active_loans`);
    return r.rows[0];
  });
  await withBypass((adb) =>
    audit(
      adb,
      poEmail,
      "support_access_summary",
      "companies",
      companyId,
      undefined,
      undefined,
      `session ${sessionId}`,
      companyId
    )
  );
  return { companyId, sessionId, ...counts };
}

// ---------- global settings / announcements / audit ----------

export async function getGlobalSettings(): Promise<unknown[]> {
  return withBypass(async (db) => {
    const { rows } = await db.query(`SELECT key, value, updated_at FROM global_settings ORDER BY key`);
    return rows;
  });
}

export async function putGlobalSetting(poEmail: string, key: string, value: unknown): Promise<void> {
  return withBypass(async (db) => {
    const before = await db.query(`SELECT value FROM global_settings WHERE key=$1`, [key]);
    if (before.rowCount === 0) throw AppError.notFound("Unknown setting key");
    await db.query(`UPDATE global_settings SET value=$2, updated_at=now() WHERE key=$1`, [
      key,
      JSON.stringify(value)
    ]);
    await audit(db, poEmail, "updated", "global_settings", key, before.rows[0]!.value, value);
  });
}

export async function listAnnouncements(): Promise<unknown[]> {
  return withBypass(async (db) => {
    const { rows } = await db.query(
      `SELECT * FROM platform_announcements ORDER BY created_at DESC LIMIT 100`
    );
    return rows;
  });
}

export async function createAnnouncement(
  poEmail: string,
  input: { title: string; body: string; severity: string }
): Promise<{ id: string }> {
  return withBypass(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO platform_announcements (title, body, severity, status)
       VALUES ($1,$2,$3,'draft') RETURNING id`,
      [input.title, input.body, input.severity]
    );
    await audit(db, poEmail, "created", "platform_announcements", rows[0]!.id);
    return { id: rows[0]!.id };
  });
}

export async function setAnnouncementStatus(
  poEmail: string,
  id: string,
  status: "active" | "expired"
): Promise<void> {
  await withBypass(async (db) => {
    const r = await db.query(
      `UPDATE platform_announcements SET status=$2,
              starts_at=COALESCE(starts_at, CASE WHEN $2='active' THEN now() END),
              ends_at=CASE WHEN $2='expired' THEN now() ELSE ends_at END
        WHERE id=$1 RETURNING status`,
      [id, status]
    );
    if (r.rowCount === 0) throw AppError.notFound("Announcement not found");
    await audit(db, poEmail, `marked_${status}`, "platform_announcements", id);
  });
}

export async function listPlatformAudit(limit = 100): Promise<unknown[]> {
  return withBypass(async (db) => {
    const { rows } = await db.query(
      `SELECT * FROM platform_audit_logs ORDER BY created_at DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)]
    );
    return rows;
  });
}
