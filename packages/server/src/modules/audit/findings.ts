import type pg from "pg";
import { AppError } from "../../lib/errors";
import { withTenant } from "../../db/repo";

/**
 * PART 12 §12.14 — "record findings and annotations".
 *
 * A finding is an auditor's conclusion about something they inspected. It is
 * deliberately NOT a financial record: it never touches the ledger, never moves
 * money, and no role that cannot see the finding's subject can read it.
 *
 * Rules honoured here:
 *  - Company-scoped by RLS (migration 0086), so another tenant's findings are
 *    unreachable even by a malformed query.
 *  - Append-only. `status` may only move forward, and every move is written to
 *    `audit_findings_events` (RULE 14.3.2).
 *  - The raising role is recorded at the moment of raising (RULE 14.3.1).
 */

export type FindingSeverity = "observation" | "low" | "medium" | "high" | "critical";
export type FindingStatus = "open" | "acknowledged" | "closed";

export interface FindingRow {
  id: string;
  reference: string;
  title: string;
  observation: string;
  severity: FindingSeverity;
  status: FindingStatus;
  entityType: string | null;
  entityId: string | null;
  raisedBy: string;
  raisedByName: string;
  raisedAsRole: string | null;
  remediationNote: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FindingActor {
  userId: string;
  companyId: string;
  branchId: string | null;
  roleKey: string | null;
}

/** Only roles whose duty includes audit may raise or progress a finding. */
const FINDING_ROLES = new Set([
  "internal_auditor",
  "audit_officer",
  "compliance_officer",
  "risk_officer",
  "md",
  "deputy_md",
]);

function requireFindingRole(actor: FindingActor): void {
  if (!actor.roleKey || !FINDING_ROLES.has(actor.roleKey)) {
    throw AppError.forbidden("Recording findings is restricted to audit and compliance roles");
  }
}

const SELECT_FINDING = `
  SELECT f.id, f.reference, f.title, f.observation, f.severity, f.status,
         f.entity_type, f.entity_id, f.raised_by, f.raised_as_role,
         f.remediation_note, f.closed_at, f.created_at, f.updated_at,
         TRIM(CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name)) AS raised_by_name
    FROM audit_findings f
    JOIN users u ON u.id = f.raised_by`;

type RawFinding = {
  id: string; reference: string; title: string; observation: string;
  severity: FindingSeverity; status: FindingStatus;
  entity_type: string | null; entity_id: string | null;
  raised_by: string; raised_as_role: string | null; raised_by_name: string | null;
  remediation_note: string | null; closed_at: Date | null;
  created_at: Date; updated_at: Date;
};

function toRow(r: RawFinding): FindingRow {
  return {
    id: r.id,
    reference: r.reference,
    title: r.title,
    observation: r.observation,
    severity: r.severity,
    status: r.status,
    entityType: r.entity_type,
    entityId: r.entity_id,
    raisedBy: r.raised_by,
    raisedByName: r.raised_by_name ?? r.raised_by.slice(0, 8),
    raisedAsRole: r.raised_as_role,
    remediationNote: r.remediation_note,
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listFindings(
  actor: FindingActor,
  filter: { status?: FindingStatus | null; severity?: FindingSeverity | null; limit?: number; offset?: number } = {}
): Promise<{ items: FindingRow[]; total: number }> {
  return withTenant(actor.companyId, null, async (db: pg.PoolClient) => {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const { rows } = await db.query<RawFinding>(
      `${SELECT_FINDING}
        WHERE ($1::text IS NULL OR f.status = $1)
          AND ($2::text IS NULL OR f.severity = $2)
        ORDER BY f.created_at DESC
        LIMIT $3 OFFSET $4`,
      [filter.status ?? null, filter.severity ?? null, limit, offset]
    );
    const count = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_findings
        WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR severity = $2)`,
      [filter.status ?? null, filter.severity ?? null]
    );
    return {
      items: rows.map(toRow),
      total: Number(count.rows[0]?.count ?? 0),
    };
  });
}

export async function raiseFinding(
  actor: FindingActor,
  input: {
    reference: string;
    title: string;
    observation: string;
    severity: FindingSeverity;
    entityType?: string | null;
    entityId?: string | null;
  }
): Promise<FindingRow> {
  requireFindingRole(actor);
  return withTenant(actor.companyId, null, async (db: pg.PoolClient) => {
    const { rows } = await db.query<RawFinding>(
      `INSERT INTO audit_findings
         (company_id, raised_by, raised_as_role, reference, title, observation,
          severity, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, reference, title, observation, severity, status,
                 entity_type, entity_id, raised_by, raised_as_role,
                 remediation_note, closed_at, created_at, updated_at, '' AS raised_by_name`,
      [
        actor.companyId, actor.userId, actor.roleKey,
        input.reference.trim(), input.title.trim(), input.observation.trim(),
        input.severity, input.entityType ?? null, input.entityId ?? null
      ]
    );
    const created = rows[0]!;
    await db.query(
      `INSERT INTO audit_findings_events
         (company_id, finding_id, event, previous_status, new_status, actor_user_id, actor_role)
       VALUES ($1,$2,'raised',NULL,'open',$3,$4)`,
      [actor.companyId, created.id, actor.userId, actor.roleKey]
    );
    return toRow({ ...created, raised_by_name: null });
  });
}

/** Lifecycle moves only ever go forward: open -> acknowledged -> closed. */
const NEXT: Record<FindingStatus, FindingStatus | null> = {
  open: "acknowledged",
  acknowledged: "closed",
  closed: null,
};

export async function progressFinding(
  actor: FindingActor,
  findingId: string,
  to: FindingStatus,
  note?: string | null
): Promise<FindingRow> {
  requireFindingRole(actor);
  return withTenant(actor.companyId, null, async (db: pg.PoolClient) => {
    const found = await db.query<RawFinding>(
      `${SELECT_FINDING} WHERE f.id = $1`,
      [findingId]
    );
    if ((found.rowCount ?? 0) === 0) throw AppError.notFound("Finding not found");
    const current = found.rows[0]!;
    if (NEXT[current.status] !== to) {
      throw AppError.unprocessable(`A finding at "${current.status}" cannot move to "${to}"`);
    }
    const updated = await db.query<RawFinding>(
      `UPDATE audit_findings
          SET status = $2,
              remediation_note = COALESCE($3, remediation_note),
              closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END,
              closed_by = CASE WHEN $2 = 'closed' THEN $4 ELSE closed_by END,
              updated_at = now()
        WHERE id = $1
      RETURNING id, reference, title, observation, severity, status,
                entity_type, entity_id, raised_by, raised_as_role,
                remediation_note, closed_at, created_at, updated_at,
                $5 AS raised_by_name`,
      [findingId, to, note ?? null, actor.userId, current.raised_by_name]
    );
    await db.query(
      `INSERT INTO audit_findings_events
         (company_id, finding_id, event, previous_status, new_status, note, actor_user_id, actor_role)
       VALUES ($1,$2,'status_changed',$3,$4,$5,$6,$7)`,
      [actor.companyId, findingId, current.status, to, note ?? null, actor.userId, actor.roleKey]
    );
    return toRow(updated.rows[0]!);
  });
}

export async function listFindingEvents(
  actor: FindingActor,
  findingId: string
): Promise<Array<{ event: string; previousStatus: string | null; newStatus: string | null; note: string | null; actorName: string; actorRole: string | null; createdAt: string }>> {
  return withTenant(actor.companyId, null, async (db: pg.PoolClient) => {
    const { rows } = await db.query<{
      event: string; previous_status: string | null; new_status: string | null; note: string | null;
      actor_role: string | null; created_at: Date; actor_name: string | null;
    }>(
      `SELECT e.event, e.previous_status, e.new_status, e.note, e.actor_role, e.created_at,
              TRIM(CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name)) AS actor_name
         FROM audit_findings_events e
         JOIN users u ON u.id = e.actor_user_id
        WHERE e.finding_id = $1
        ORDER BY e.created_at`,
      [findingId]
    );
    return rows.map((r) => ({
      event: r.event,
      previousStatus: r.previous_status,
      newStatus: r.new_status,
      note: r.note,
      actorName: r.actor_name ?? "—",
      actorRole: r.actor_role,
      createdAt: r.created_at.toISOString(),
    }));
  });
}