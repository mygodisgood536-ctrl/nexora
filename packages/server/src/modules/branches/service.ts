import { withBypass, withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

/**
 * Branch system (Part 1 §7–9): creation, deterministic never-reused codes
 * `{PREFIX}-{SEQ}`, per-company unique slugs feeding `{company}-{branch}`
 * portal URLs, and an active/suspended/closed lifecycle — every mutation
 * appended to the tenant audit trail.
 */

export interface BranchActor {
  sub: string;
  companyId: string;
}

export interface CreateBranchInput {
  name: string;
  address: string;
  phone?: string | null;
  email?: string | null;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

async function auditBranch(
  db: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  },
  companyId: string,
  branchId: string,
  actorUserId: string,
  action: string,
  previousValue: unknown,
  newValue: unknown,
  reason?: string,
  meta?: ActorMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,'branches',$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
    [
      companyId,
      branchId,
      actorUserId,
      action,
      branchId,
      previousValue === undefined ? null : JSON.stringify(previousValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      reason ?? null,
      meta?.ip ?? null,
      meta?.userAgent ?? null,
      meta?.requestId ?? null
    ]
  );
}

export async function createBranch(
  actor: BranchActor,
  input: CreateBranchInput,
  meta: ActorMeta = {}
): Promise<Record<string, unknown>> {
  // Company identity (prefix for codes, slug for the portal URL) is read via
  // the audited bypass path; everything else happens inside this tenant's
  // fail-closed RLS session.
  const company = await withBypass(async (db) => {
    const { rows } = await db.query<{ code_prefix: string; slug: string }>(
      `SELECT code_prefix, slug FROM companies WHERE id=$1`,
      [actor.companyId]
    );
    return rows[0];
  });
  if (!company) throw AppError.notFound("Company not found");

  return withTenant(actor.companyId, null, async (db) => {
    // Per-company serialization for code allocation: guarantees gap-free,
    // never-reused `{PREFIX}-{SEQ}` codes even under concurrent creation,
    // without relying on row-lock wait ordering.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('branch-seq:' || $1))`, [
      actor.companyId
    ]);

    // Atomic allocation: distinct monotonically increasing numbers. Codes are
    // never reused — the counter only moves forward, even for closed branches.
    const allocated = await db.query<{ allocated: number }>(
      `INSERT INTO company_counters (company_id, counter_key, next_value)
       VALUES ($1,'branch_seq',2)
       ON CONFLICT (company_id, counter_key)
       DO UPDATE SET next_value = company_counters.next_value + 1
       RETURNING next_value - 1 AS allocated`,
      [actor.companyId]
    );
    const seq = allocated.rows[0]!.allocated;
    const code = `${company.code_prefix}-${String(seq).padStart(3, "0")}`;

    let slug = slugify(input.name);
    if (slug.length === 0) throw AppError.unprocessable("Name must contain alphanumeric characters");
    let n = 1;
    while (
      ((await db.query(`SELECT 1 FROM branches WHERE company_id=$1 AND slug=$2`, [actor.companyId, slug]))
        .rowCount ?? 0) > 0
    ) {
      slug = `${slugify(input.name)}-${++n}`;
    }

    const portalUrl = `${company.slug}-${slug}.nexora.app`;
    const { rows } = await db.query(
      `INSERT INTO branches (company_id, code, slug, name, address, phone, email, status,
                             portal_url, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9)
       RETURNING id, code, slug, name, address, phone, email, status, portal_url, created_at`,
      [actor.companyId, code, slug, input.name, input.address, input.phone ?? null, input.email ?? null, portalUrl, actor.sub]
    );
    const branch = rows[0]!;
    await auditBranch(
      db,
      actor.companyId,
      String(branch.id),
      actor.sub,
      "created",
      null,
      { code, slug, name: input.name, portal_url: portalUrl },
      undefined,
      meta
    );
    return branch;
  });
}

const BRANCH_TRANSITIONS: Record<string, { from: string[]; to: string; needsReason?: boolean; terminal?: boolean }> = {
  suspend: { from: ["active"], to: "suspended", needsReason: true },
  reactivate: { from: ["suspended"], to: "active" },
  close: { from: ["active", "suspended"], to: "closed", needsReason: true, terminal: true }
};

export async function listBranches(actor: BranchActor): Promise<unknown[]> {
  // RLS scopes every row to the caller's company automatically.
  return withTenant(actor.companyId, null, async (db) => {
    const { rows } = await db.query(
      `SELECT id, code, slug, name, address, phone, email, status, portal_url, created_at, closed_at
         FROM branches ORDER BY created_at ASC`
    );
    return rows;
  });
}

export async function setBranchStatus(
  actor: BranchActor,
  branchId: string,
  action: string,
  reason?: string,
  meta: ActorMeta = {}
): Promise<{ status: string }> {
  const t = BRANCH_TRANSITIONS[action];
  if (!t) throw AppError.badRequest("Unknown status action");
  if (t.needsReason && (!reason || reason.trim().length === 0)) {
    throw AppError.unprocessable("Reason is required");
  }
  return withTenant(actor.companyId, null, async (db) => {
    const found = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM branches WHERE id=$1 FOR UPDATE`,
      [branchId]
    );
    if (found.rowCount === 0) throw AppError.notFound("Branch not found");
    const before = found.rows[0]!.status;
    if (!t.from.includes(before)) {
      throw new AppError(409, "INVALID_TRANSITION", `Cannot ${action} a ${before} branch`);
    }
    const sets = t.terminal ? `, closed_at=now()` : ``;
    await db.query(`UPDATE branches SET status=$2${sets} WHERE id=$1`, [branchId, t.to]);
    await auditBranch(
      db,
      actor.companyId,
      branchId,
      actor.sub,
      action,
      { status: before },
      { status: t.to },
      reason,
      meta
    );
    return { status: t.to };
  });
}
