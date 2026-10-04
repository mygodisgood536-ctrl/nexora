import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { withTenantSession } from "../../db/pool";
import { withBypass } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { verifyTotp } from "../../lib/totp";
import { BUILT_IN_ROLES } from "@nexora/shared";
import { fullName, initialPasswordFor } from "../../lib/credential";

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

  // The company's own audit entry is deliberately NOT written here: the
  // platform transaction holds no tenant context, and the tenant's row-level
  // security must govern that entry. Callers record it after the platform
  // transaction commits, through auditCompanyTrail below.
}

/**
 * RULE 3.6.3 - "every action taken inside it is written to both the platform
 * audit trail and the company's own audit trail". This writes the company side
 * in that company's own tenant session, so a company can always see in its
 * records that the platform acted, and the tenant's row-level security decides
 * what that record may say.
 */
export async function auditCompanyTrail(
  companyId: string,
  actor: string,
  action: string,
  entityType: string,
  entityId: string | null,
  reason: string | null
): Promise<void> {
  await withTenantSession(companyId, null, async (tdb) => {
    await tdb.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                               entity_id, reason, transaction_ref)
       VALUES ($1, NULL, $2, $3, $4, $5, $6)`,
      [companyId, `platform.${entityType}.${action}`, entityType, entityId, reason, `platform-support:${actor}`]
    );
  });
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
  input: {
    name: string;
    contactEmail?: string;
    planTier?: string;
    codePrefix: string;
    branding?: {
      primaryColor?: string;
      secondaryColor?: string;
      accentColor?: string;
      navyColor?: string;
      logoUrl?: string | null;
      loginBackgroundUrl?: string | null;
      fontFamily?: string;
    };
    enabledRoleKeys?: string[];
    mdFullName?: string;
    mdPhone?: string;
    mdEmail?: string;
    mdBirthDay?: number;
    mdBirthMonth?: number;
  }
): Promise<{
  id: string;
  slug: string;
  code_prefix: string;
  company_url?: string;
  md?: {
    worker_code: string;
    username: string;
    initial_password: string;
    credential_state: string;
    expires_at: string;
  };
}> {
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
// RULE 3.3.3 - "Once the Platform Owner completes Create Company
      // successfully, the company is provisioned and becomes live immediately...
      // A completed company must never remain unnecessarily in 'in setup'."
      //
      // This endpoint IS the completed Create Company action (the one-time
      // credential panel it returns is the owner's hand-over), so the company is
      // born live and the MD can perform the mandatory first-login ritual
      // (Part 2.2 / 4.2.1). A draft company, if ever saved separately, is a
      // different flow and still starts in 'in_setup'; the activate / suspend /
      // reactivate transitions remain available for the rest of the lifecycle.
      `INSERT INTO companies (name, code_prefix, slug, contact_email, plan_tier, status,
                                 portal_url, activated_at, created_by_platform_owner)
          VALUES ($1,$2,$3,$4,$5,'active',$6, now(),
                  (SELECT id FROM platform_owners WHERE email=$7))
          RETURNING id`,
         [
           input.name,
           prefix,
           slug,
           input.contactEmail ?? null,
           input.planTier ?? null,
           `${slug}.nexora.app`,
           poEmail
         ]
       );

    const companyId = rows[0]!.id;

    // The tenant RLS policies key off app_current_company(), not the bypass
    // flag. The company now exists, so this transaction establishes that tenant
    // context for the rest of the provisioning (MD user, role, assignment) —
    // the Platform Owner is the only actor that may create the first worker of
    // a company it has just created.
    await db.query(`SELECT set_config('app.company_id', $1::text, true)`, [companyId]);
    await db.query(`SELECT set_config('app.branch_id', '', true)`);
    await db.query(`SELECT set_config('app.branch_restricted', 'off', true)`);

    await db.query(`INSERT INTO themes (company_id) VALUES ($1)`, [companyId]);
    await applyThemeUpdate(db, companyId, input.branding ?? {});
    await db.query(`INSERT INTO company_settings (company_id) VALUES ($1)`, [companyId]);
    await db.query(
      `INSERT INTO company_group_options (company_id, option_kind, option_value, sort_order)
       VALUES ($1,'group_role','Leader',1),($1,'group_role','Secretary',2),
              ($1,'group_role','Treasurer',3),($1,'group_role','Chief Whip',4),
              ($1,'group_role','Member',5),
              ($1,'marital_status','Single',1),($1,'marital_status','Married',2),
              ($1,'marital_status','Divorced',3),($1,'marital_status','Widowed',4)`,
      [companyId]
    );
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
    if (input.enabledRoleKeys !== undefined) {
      await replaceEnabledRoles(db, companyId, input.enabledRoleKeys);
    }
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

    // ---------- MD onboarding (RULE 3.3.1, 3.4.1) ----------
    const mdPanel: {
      worker_code: string;
      username: string;
      initial_password: string;
      credential_state: string;
      expires_at: string;
    } = {
      worker_code: "",
      username: "",
      initial_password: "",
      credential_state: "credential_issued",
      expires_at: ""
    };
    if (input.mdFullName !== undefined) {
      // Parse full name into parts (first and last name are mandatory)
      const nameParts = input.mdFullName.trim().split(/\s+/);
      if (nameParts.length < 2) {
        throw new AppError(422, "INVALID_NAME", "MD full name must include a first and last name");
      }
      const firstName = nameParts[0]!;
      const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : null;
      const lastName = nameParts[nameParts.length - 1]!;
      const username = fullName(firstName, middleName, lastName);

      // Username uniqueness in the new company
      const usernameExists = await db.query(
        `SELECT 1 FROM users WHERE company_id=$1 AND username=$2`,
        [companyId, username]
      );
      if ((usernameExists.rowCount ?? 0) > 0) {
        throw new AppError(409, "USERNAME_TAKEN", "An MD with that full name already exists in this company");
      }

      // RULE 5.2.1 — initial password is @FirstName
      const initialPassword = initialPasswordFor(firstName);
      const passwordHash = await bcrypt.hash(initialPassword, 10);

      // RULE 2.3.3 / URL law Part 1 §23 — company URL
      const companyUrl = `${slug}.nexora.app`;

      // RULE 5.7.3 — Head Office worker ID: {COMPANY_PREFIX}-HO-MD-001
      const workerCode = `${prefix}-HO-MD-001`;

      // Insert MD user (company-wide, no branch)
      // RULE 5.7.4 — only the day and month of birth are ever collected or
      // stored, and they are NOT NULL in the schema. A company wizard that has
      // not collected them yet provisions the placeholder pair, exactly as
      // worker creation does; HR completes the profile in the ritual.
      const { rows: mdUser } = await db.query<{
        id: string;
        worker_code: string;
        username: string;
        first_name: string;
        middle_name: string | null;
        last_name: string;
        status: string;
        credential_state: string;
      }>(
        `INSERT INTO users (company_id, branch_id, worker_code, username, password_hash,
                           must_change_password, first_name, middle_name, last_name, phone,
                           birth_day, birth_month, status, credential_state,
                           credential_issued_at, credential_expires_at)
         VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,$11,
                 'invited','credential_issued',now(),
                 now() + interval '168 hours')
        RETURNING id, worker_code, first_name, middle_name, last_name, username,
                  status, credential_state`,
        [
          companyId,
          null,
          workerCode,
          username,
          passwordHash,
          firstName,
          middleName ?? null,
          lastName,
          input.mdPhone ?? null,
          input.mdBirthDay ?? 1,
          input.mdBirthMonth ?? 1
        ]
      );
      const mdUserId = mdUser[0]!.id as string;

      // Ensure MD role exists and assign it company-wide to the MD user
      const { rows: role } = await db.query<{ id: string }>(
        `SELECT id FROM roles WHERE company_id=$1 AND role_key='md'`,
        [companyId]
      );
      const roleId = role[0]?.id as string | undefined;
      if (roleId) {
        await db.query(
          `INSERT INTO role_permissions (role_id, verb)
           SELECT $1::uuid, b.verb FROM platform_role_permission_bundles b
            WHERE b.role_key='md' AND NOT EXISTS (
                    SELECT 1 FROM role_permissions rp WHERE rp.role_id=$1::uuid)
           ON CONFLICT DO NOTHING`,
          [roleId]
        );
        await db.query(
          `INSERT INTO role_assignments (company_id, user_id, role_id, scope_type,
                                            assignment_type, starts_at, ends_at, reason,
                                            status, assigned_by)
           VALUES ($1,$2,$3,'company_wide','permanent',now(),null,null,'active',$4)`,
          [companyId, mdUserId, roleId, mdUserId]
        );
      } else {
        // Create the MD role from platform catalogue
        await db.query(
          `INSERT INTO roles (company_id, role_key, name, category, is_system, enabled)
           VALUES ($1,'md','MD','executive',true,true)`,
          [companyId]
        );
        const { rows: newRole } = await db.query<{ id: string }>(
          `SELECT id FROM roles WHERE company_id=$1 AND role_key='md'`,
          [companyId]
        );
        const actualRoleId = newRole[0]!.id as string;
        // Copy the platform default verb bundle into the company's own role so
        // the MD is not refused by every requirePermission gate.
        await db.query(
          `INSERT INTO role_permissions (role_id, verb)
           SELECT $1::uuid, b.verb FROM platform_role_permission_bundles b
            WHERE b.role_key='md' AND NOT EXISTS (
                    SELECT 1 FROM role_permissions rp WHERE rp.role_id=$1::uuid)
           ON CONFLICT DO NOTHING`,
          [actualRoleId]
        );
        await db.query(
          `INSERT INTO role_assignments (company_id, user_id, role_id, scope_type,
                                            assignment_type, starts_at, ends_at, reason,
                                            status, assigned_by)
           VALUES ($1,$2,$3,'company_wide','permanent',now(),null,null,'active',$4)`,
          [companyId, mdUserId, actualRoleId, mdUserId]
        );
      }

      // Platform audit entry: security-state — MD initial credential issued
      await audit(
        db,
        poEmail,
        "credential.issued",
        "companies",
        companyId,
        null,
        {
          credential_state: "credential_issued",
          username: username,
          initial_password_shown: true,
          company_url: companyUrl
        },
        companyId
      );

      // Platform notification: company created + MD credential issued
      // The notification is written with the platform owner as recipient context.
      // Recipient user ID will be resolved by the notification service on read.
      await db.query(
        `INSERT INTO notifications (company_id, recipient_user_id, kind, payload)
         VALUES ($1,$2,'company.created',$3::jsonb)`,
        [companyId, mdUserId, JSON.stringify({
          type: "company_created",
          md_username: username,
          company_url: companyUrl,
           md_initial_password_shown: true // shown once, never retrievable per RULE 3.4.3
         })]
      );

      // RULE 3.4.1 #8 / 3.4.3 — the one-time credential panel. It is returned
      // exactly once, in this response, and is never retrievable afterwards.
      mdPanel.worker_code = workerCode;
      mdPanel.username = username;
      mdPanel.initial_password = initialPassword;
      mdPanel.credential_state = "credential_issued";
      mdPanel.expires_at = new Date(Date.now() + 168 * 60 * 60 * 1000).toISOString();
    }

    return {
      id: companyId,
      slug,
      code_prefix: prefix,
      company_url: `${slug}.nexora.app`,
      md: mdPanel.username ? mdPanel : undefined
    };
  }).then(async (result) => {
    // RULE 3.4.1 #9 / 5.10.2 - the issuance of the MD's initial credential is a
    // security event, and the company must be able to audit its own people, so
    // the entry lands in the company's own trail as well as the platform's.
    if (result.md) {
      await auditCompanyTrail(
        result.id,
        poEmail,
        "credential.issued",
        "workers",
        null,
        `MD initial credential issued at company creation for ${result.md.username}`
      );
    }
    return result;
  });
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Applies a partial brand-token update inside the caller's bypass txn. */
async function applyThemeUpdate(
  db: PoolClientLike,
  companyId: string,
  patch: {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    navyColor?: string;
    logoUrl?: string | null;
    loginBackgroundUrl?: string | null;
    fontFamily?: string;
  }
): Promise<void> {
  const colors: Array<[string, string | undefined]> = [
    ["primary_color", patch.primaryColor],
    ["secondary_color", patch.secondaryColor],
    ["accent_color", patch.accentColor],
    ["navy_color", patch.navyColor]
  ];
  for (const [column, value] of colors) {
    if (value === undefined) continue;
    if (!HEX_RE.test(value)) throw AppError.unprocessable(`${column} must be #RRGGBB`);
    await db.query(`UPDATE themes SET ${column}=$2, updated_at=now() WHERE company_id=$1`, [
      companyId,
      value
    ]);
  }
  const urls: Array<[string, string | null | undefined]> = [
    ["logo_url", patch.logoUrl],
    ["login_background_url", patch.loginBackgroundUrl]
  ];
  for (const [column, value] of urls) {
    if (value === undefined) continue;
    if (value !== null && !/^(https:\/\/|\/)/.test(value)) {
      throw AppError.unprocessable(`${column} must be an https:// or root-relative URL`);
    }
    await db.query(`UPDATE themes SET ${column}=$2, updated_at=now() WHERE company_id=$1`, [
      companyId,
      value
    ]);
  }
  if (patch.fontFamily !== undefined) {
    if (!/^[A-Za-z0-9 _-]{2,60}$/.test(patch.fontFamily)) {
      throw AppError.unprocessable("fontFamily must be 2-60 letters/digits/spaces");
    }
    await db.query(`UPDATE themes SET font_family=$2, updated_at=now() WHERE company_id=$1`, [
      companyId,
      patch.fontFamily
    ]);
  }
}

function assertKnownRoleKeys(keys: string[]): void {
  if (keys.length === 0) throw AppError.unprocessable("At least one role must stay enabled");
  const known = new Set(BUILT_IN_ROLES.map((r) => r.key));
  for (const key of keys) {
    if (!known.has(key)) throw AppError.unprocessable(`Unknown role key: ${key}`);
  }
}

async function replaceEnabledRoles(
  db: PoolClientLike,
  companyId: string,
  keys: string[]
): Promise<void> {
  assertKnownRoleKeys(keys);
  const unique = [...new Set(keys)];
  await db.query(`DELETE FROM company_enabled_roles WHERE company_id=$1`, [companyId]);
  for (const key of unique) {
    await db.query(
      `INSERT INTO company_enabled_roles (company_id, role_key, enabled) VALUES ($1,$2,true)`,
      [companyId, key]
    );
  }
}

export async function getCompanyTheme(companyId: string): Promise<unknown> {
  return withBypass(async (db) => {
    const { rows } = await db.query(
      `SELECT t.*, c.name AS company_name FROM themes t
         JOIN companies c ON c.id=t.company_id WHERE t.company_id=$1`,
      [companyId]
    );
    if (rows.length === 0) throw AppError.notFound("Company not found");
    return rows[0];
  });
}

export async function updateCompanyTheme(
  poEmail: string,
  companyId: string,
  patch: Parameters<typeof applyThemeUpdate>[2]
): Promise<unknown> {
  return withBypass(async (db) => {
    const before = await db.query(`SELECT * FROM themes WHERE company_id=$1`, [companyId]);
    if (before.rowCount === 0) throw AppError.notFound("Company not found");
    await applyThemeUpdate(db, companyId, patch);
    const after = await db.query(`SELECT * FROM themes WHERE company_id=$1`, [companyId]);
    await audit(db, poEmail, "updated", "themes", companyId, before.rows[0], after.rows[0], undefined, companyId);
    return after.rows[0];
  });
}

export async function listEnabledRoles(companyId: string): Promise<unknown> {
  return withBypass(async (db) => {
    const { rows } = await db.query(
      `SELECT role_key FROM company_enabled_roles
        WHERE company_id=$1 AND enabled ORDER BY role_key`,
      [companyId]
    );
    return rows.map((r) => r.role_key);
  });
}

export async function setEnabledRoles(
  poEmail: string,
  companyId: string,
  keys: string[]
): Promise<{ enabled: string[] }> {
  return withBypass(async (db) => {
    const company = await db.query(`SELECT id FROM companies WHERE id=$1`, [companyId]);
    if (company.rowCount === 0) throw AppError.notFound("Company not found");
    const before = await db.query(
      `SELECT role_key FROM company_enabled_roles WHERE company_id=$1 AND enabled ORDER BY role_key`,
      [companyId]
    );
    await replaceEnabledRoles(db, companyId, keys);
    // Disabling a role never touches existing assignments (Part 2 §48) — it
    // only hides the role from future pickers; nothing cascades by design.
    await audit(
      db,
      poEmail,
      "enabled_roles_changed",
      "companies",
      companyId,
      { enabled: before.rows.map((r) => r.role_key) },
      { enabled: [...new Set(keys)].sort() },
      undefined,
      companyId
    );
    return { enabled: [...new Set(keys)].sort() };
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

export interface CompanyListQuery {
  search?: string | null;
  status?: string | null;
  sort?: string | null;
  order?: "asc" | "desc" | null;
  limit?: number | null;
  offset?: number | null;
}

export interface CompanyListItem {
  id: string;
  name: string;
  slug: string;
  codePrefix: string;
  portalUrl: string | null;
  status: string;
  planTier: string | null;
  createdAt: string;
  activatedAt: string | null;
  suspendedAt: string | null;
  lastActivityAt: string | null;
  branches: number;
  workers: number;
  rolesEnabled: number;
  setupComplete: boolean;
}

/**
 * RULE 3.6.1 / 3.6.6 - the Companies workspace list: structural and aggregate
 * facts only, searchable, filterable, sortable and paginated, with every result
 * addressed by its own exact company id.
 *
 * RULE 3.6.2 forbids the owner reading a company's customers, loans, payments,
 * savings, ledger, accounting or reconciliation data, or any individual's
 * performance. So nothing here counts customers, money or performance: branch
 * count, worker count, enabled-role count, setup status and activity recency are
 * what the Vision permits.
 */
export async function listCompanies(
  query: CompanyListQuery = {}
): Promise<{ items: CompanyListItem[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const sortColumn: Record<string, string> = {
    name: "c.name",
    created_at: "c.created_at",
    status: "c.status",
    last_activity_at: "c.last_activity_at"
  };
  const sort = sortColumn[String(query.sort ?? "").toLowerCase()] ?? "c.created_at";
  const order = query.order === "asc" ? "ASC" : "DESC";

  return withBypass(async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.search && query.search.trim()) {
      params.push(`%${query.search.trim()}%`);
      conditions.push(`(c.name ILIKE $${params.length} OR c.slug ILIKE $${params.length} OR c.code_prefix ILIKE $${params.length})`);
    }
    if (query.status && query.status.trim()) {
      params.push(query.status.trim());
      conditions.push(`c.status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const total = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM companies c ${where}`,
      params
    );
    const rows = await db.query<{
      id: string; name: string; slug: string; code_prefix: string; portal_url: string | null;
      status: string; plan_tier: string | null; created_at: Date; activated_at: Date | null;
      suspended_at: Date | null; last_activity_at: Date | null;
      branches: number; workers: number; roles_enabled: number;
    }>(
      `SELECT c.id, c.name, c.slug, c.code_prefix, c.portal_url, c.status, c.plan_tier,
              c.created_at, c.activated_at, c.suspended_at, c.last_activity_at,
              (SELECT count(*)::int FROM branches b WHERE b.company_id=c.id) AS branches,
              (SELECT count(*)::int FROM users u WHERE u.company_id=c.id) AS workers,
              (SELECT count(*)::int FROM company_enabled_roles r WHERE r.company_id=c.id) AS roles_enabled
         FROM companies c
         ${where}
        ORDER BY ${sort} ${order}, c.id ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return {
      items: rows.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        codePrefix: row.code_prefix,
        portalUrl: row.portal_url,
        status: row.status,
        planTier: row.plan_tier,
        createdAt: row.created_at.toISOString(),
        activatedAt: row.activated_at ? row.activated_at.toISOString() : null,
        suspendedAt: row.suspended_at ? row.suspended_at.toISOString() : null,
        lastActivityAt: row.last_activity_at ? row.last_activity_at.toISOString() : null,
        branches: row.branches,
        workers: row.workers,
        rolesEnabled: row.roles_enabled,
        setupComplete: row.status !== "in_setup"
      })),
      total: Number(total.rows[0]!.n),
      limit,
      offset
    };
  });
}

/**
 * RULE 3.6.4 - the Company Detail workspace: the management context for exactly
 * this company, including its AI Provider / Model configuration, and nothing
 * the Platform Owner is forbidden from seeing (RULE 3.6.2).
 */
export async function getCompanyDetail(companyId: string): Promise<{
  company: {
    id: string;
    name: string;
    slug: string;
    codePrefix: string;
    portalUrl: string | null;
    contactEmail: string | null;
    status: string;
    planTier: string | null;
    createdAt: string;
    activatedAt: string | null;
    suspendedAt: string | null;
    lastActivityAt: string | null;
  };
  setup: {
    complete: boolean;
    branches: number;
    workers: number;
    rolesEnabled: number;
    enabledRoleKeys: string[];
  };
  staffByCategory: Array<{ category: string; roleKey: string; name: string; workers: number }>;
  branches: Array<{ id: string; code: string; name: string; status: string; portalUrl: string | null }>;
  branding: {
    primaryColor: string | null;
    secondaryColor: string | null;
    accentColor: string | null;
    logoUrl: string | null;
    fontFamily: string | null;
  };
  recentLogins: Array<{ username: string; lastLoginAt: string | null; status: string }>;
  aiConfiguration: unknown;
}> {
  return withBypass(async (db) => {
    const company = await db.query<{
      id: string; name: string; slug: string; code_prefix: string; portal_url: string | null;
      contact_email: string | null; status: string; plan_tier: string | null;
      created_at: Date; activated_at: Date | null; suspended_at: Date | null; last_activity_at: Date | null;
    }>(
      `SELECT id, name, slug, code_prefix, portal_url, contact_email, status, plan_tier,
              created_at, activated_at, suspended_at, last_activity_at
         FROM companies WHERE id=$1`,
      [companyId]
    );
    if ((company.rowCount ?? 0) === 0) throw AppError.notFound("Company not found");
    const c = company.rows[0]!;

    const branches = await db.query<{
      id: string; code: string; name: string; status: string; portal_url: string | null;
    }>(
      `SELECT id, code, name, status, portal_url FROM branches
        WHERE company_id=$1 ORDER BY code ASC`,
      [companyId]
    );

    const staff = await db.query<{ category: string; role_key: string; name: string; workers: number }>(
      `SELECT r.category, r.role_key, r.name, count(DISTINCT ra.user_id)::int AS workers
         FROM role_assignments ra
         JOIN roles r ON r.id = ra.role_id
        WHERE ra.company_id=$1 AND ra.status='active'
        GROUP BY r.category, r.role_key, r.name
        ORDER BY r.category, r.role_key`,
      [companyId]
    );

    const roles = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM company_enabled_roles WHERE company_id=$1 AND enabled`,
      [companyId]
    );
    const roleKeys = await db.query<{ role_key: string }>(
      `SELECT role_key FROM company_enabled_roles
        WHERE company_id=$1 AND enabled ORDER BY role_key`,
      [companyId]
    );

    const theme = await db.query<{
      primary_color: string | null; secondary_color: string | null; accent_color: string | null;
      logo_url: string | null; font_family: string | null;
    }>(`SELECT primary_color, secondary_color, accent_color, logo_url, font_family
          FROM themes WHERE company_id=$1`, [companyId]);

    const logins = await db.query<{ username: string; last_login_at: Date | null; status: string }>(
      `SELECT username, last_login_at, status FROM users
        WHERE company_id=$1 ORDER BY last_login_at DESC NULLS LAST LIMIT 20`,
      [companyId]
    );

    const { listCompanyConfigurations } = await import("../company-ai/config-service");
    const ai = await listCompanyConfigurations("company-detail", companyId);

    return {
      company: {
        id: c.id,
        name: c.name,
        slug: c.slug,
        codePrefix: c.code_prefix,
        portalUrl: c.portal_url,
        contactEmail: c.contact_email,
        status: c.status,
        planTier: c.plan_tier,
        createdAt: c.created_at.toISOString(),
        activatedAt: c.activated_at ? c.activated_at.toISOString() : null,
        suspendedAt: c.suspended_at ? c.suspended_at.toISOString() : null,
        lastActivityAt: c.last_activity_at ? c.last_activity_at.toISOString() : null
      },
      setup: {
        complete: c.status !== "in_setup",
        branches: branches.rows.length,
        workers: staff.rows.reduce((sum, row) => sum + Number(row.workers), 0),
        rolesEnabled: Number(roles.rows[0]?.n ?? 0),
        enabledRoleKeys: roleKeys.rows.map((row) => row.role_key)
      },
      staffByCategory: staff.rows.map((row) => ({
        category: row.category,
        roleKey: row.role_key,
        name: row.name,
        workers: Number(row.workers)
      })),
      branches: branches.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        portalUrl: row.portal_url
      })),
      branding: {
        primaryColor: theme.rows[0]?.primary_color ?? null,
        secondaryColor: theme.rows[0]?.secondary_color ?? null,
        accentColor: theme.rows[0]?.accent_color ?? null,
        logoUrl: theme.rows[0]?.logo_url ?? null,
        fontFamily: theme.rows[0]?.font_family ?? null
      },
      recentLogins: logins.rows.map((row) => ({
        username: row.username,
        lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
        status: row.status
      })),
      aiConfiguration: ai
    };
  });
}

/**
 * Branches Overview tab (PO Spec §8): structural/administrative fields ONLY —
 * names, codes, portal URLs, lifecycle status. No financial or performance
 * figures exist on branches, and none may ever be added here (§40 boundary).
 */
export async function listCompanyBranches(companyId: string): Promise<unknown[]> {
  return withBypass(async (db) => {
    const { rows } = await db.query(
      `SELECT id, code, slug, name, status, portal_url, created_at, closed_at
         FROM branches WHERE company_id=$1 ORDER BY created_at ASC`,
      [companyId]
    );
    return rows;
  });
}

// ---------- support access (PO Spec §39/§40) ----------

export async function openSupportSession(
  poEmail: string,
  companyId: string,
  reason: string,
  durationMinutes: number
  ): Promise<{ id: string; companyId: string; reason: string; expiresAt: Date; requestedBy: string }> {
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
    return {
      id: rows[0]!.id,
      companyId,
      reason: reason.trim(),
      expiresAt: rows[0]!.expires_at,
      requestedBy: poEmail
    };
  }).then(async (session) => {
    // RULE 3.6.3 - the company sees the support session in its own trail.
    await auditCompanyTrail(
      companyId, poEmail, "opened", "support_access_sessions", session.id, session.reason
    );
    return session;
  });
}

export async function closeSupportSession(poEmail: string, sessionId: string): Promise<void> {
  const companyId = await withBypass(async (db) => {
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
    return r.rows[0]!.company_id as string;
  });
  // RULE 3.6.3 - the company sees the session end in its own trail.
  await auditCompanyTrail(companyId, poEmail, "closed", "support_access_sessions", sessionId, null);
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
  // RULE 3.6.3 - the drill-down itself is recorded in the company's own trail.
  await auditCompanyTrail(
    companyId, poEmail, "support_access_summary", "companies", companyId, `session ${sessionId}`
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
