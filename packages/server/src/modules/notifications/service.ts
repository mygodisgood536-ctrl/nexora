// Notification Center (Part 2 §40, role specs field O).
//
// notifications rows are written by event producers (the payment pipeline
// already emits `payment.received` for customers; the reconciliation run
// emits `reconciliation.exception_added` for finance users here). This
// module exposes the staff-facing read/workflow surface: list the operator's
// inbox, read the unread count, mark one or all as read. Rows are never
// deleted — read_at is the only transition, mirroring the app rules that
// audit and exception history are preserved.
import type pg from "pg";
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

export interface NotificationActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface NotificationRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  channel: string;
  read_at: Date | null;
  created_at: Date;
}

const NOTIFICATION_SELECT = `id, kind, payload, channel, read_at, created_at`;

export async function listUserNotifications(
  actor: NotificationActor,
  filter: { read?: boolean | null; limit?: number; offset?: number } = {}
): Promise<{ items: NotificationRow[]; total: number }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const conditions = ["recipient_user_id=$1"];
    const params: unknown[] = [actor.sub];
    if (filter.read === true) conditions.push(`read_at IS NOT NULL`);
    if (filter.read === false) conditions.push(`read_at IS NULL`);
    const where = `WHERE ${conditions.join(" AND ")}`;
    const total = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications ${where}`, params
    );
    params.push(limit); params.push(offset);
    const items = await db.query<NotificationRow>(
      `SELECT ${NOTIFICATION_SELECT} FROM notifications ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: parseInt(total.rows[0]?.count ?? "0", 10) };
  });
}

export async function unreadNotificationCount(
  actor: NotificationActor
): Promise<number> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications
        WHERE recipient_user_id=$1 AND read_at IS NULL`,
      [actor.sub]
    );
    return parseInt(r.rows[0]?.count ?? "0", 10);
  });
}

export async function markNotificationRead(
  actor: NotificationActor,
  notificationId: string
): Promise<{ id: string; read_at: Date | null }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const updated = await db.query<{ id: string; read_at: Date | null }>(
      `UPDATE notifications
          SET read_at = COALESCE(read_at, now())
        WHERE id=$1 AND recipient_user_id=$2
        RETURNING id, read_at`,
      [notificationId, actor.sub]
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw AppError.notFound("Notification not found");
    }
    return updated.rows[0]!;
  });
}

export async function markAllNotificationsRead(
  actor: NotificationActor
): Promise<{ updated: number }> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const updated = await db.query<{ count: string }>(
      `UPDATE notifications SET read_at = now() WHERE recipient_user_id=$1 AND read_at IS NULL`,
      [actor.sub]
    );
    return { updated: updated.rowCount ?? 0 };
  });
}

/**
 * Insert one in-app notification per recipient. Runs on the caller's client
 * inside its tenant session, which keeps RLS company scoping intact.
 */
export async function insertUserNotifications(
  db: pg.PoolClient,
  companyId: string,
  recipientUserIds: string[],
  kind: string,
  payload: unknown
): Promise<void> {
  for (const recipientUserId of recipientUserIds) {
    await db.query(
      `INSERT INTO notifications (company_id, recipient_user_id, kind, payload)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [companyId, recipientUserId, kind, JSON.stringify(payload ?? {})]
    );
  }
}

/**
 * RULE 5.9.3 / RULE 4.7.1 — the MD is notified of holds, releases and
 * transfers as they happen. Resolves active MD role assignments in the
 * company and inserts one notification per recipient, scoped to the caller's
 * tenant session so RLS keeps company integrity.
 */
export async function insertNotificationsToMds(
  db: pg.PoolClient,
  companyId: string,
  kind: string,
  payload: unknown
): Promise<void> {
  const mds = await db.query<{ user_id: string }>(
    `SELECT ra.user_id
       FROM role_assignments ra
       JOIN roles r ON r.id = ra.role_id
      WHERE ra.company_id=$1 AND ra.status='active' AND r.role_key='md'`,
    [companyId]
  );
  if (mds.rowCount === 0) return;
  await insertUserNotifications(
    db,
    companyId,
    mds.rows.map((r) => r.user_id),
    kind,
    payload
  );
}

/**
 * Active finance-role users of a company — the recipients for accounting /
 * reconciliation event notifications (Finance Manager and Reconciliation
 * Officer role specs, field O).
 */
export async function activeFinanceUserIds(
  db: pg.PoolClient,
  companyId: string
): Promise<string[]> {
  const r = await db.query<{ user_id: string }>(
    `SELECT DISTINCT ra.user_id
       FROM role_assignments ra
       JOIN roles r ON r.id = ra.role_id
       JOIN users u ON u.id = ra.user_id
      WHERE ra.company_id=$1
        AND ra.status='active'
        AND u.status='active'
        AND r.role_key IN
            ('finance_manager','cash_bank_reconciliation_officer',
             'accountant','assistant_accountant')`,
    [companyId]
  );
  return r.rows.map((row) => row.user_id);
}

/**
 * RULE 6.5.5 - the Auditor is notified of reversals, reconciliation
 * exceptions, unallocated money beyond a threshold, provider or webhook
 * failures, and records whose financial history shows an inconsistency. The
 * Auditor is read-only, so this is the only channel that reaches them.
 */
export async function activeAuditorUserIds(
  db: pg.PoolClient,
  companyId: string,
  branchId?: string | null
): Promise<string[]> {
  const r = await db.query<{ user_id: string }>(
    `SELECT DISTINCT ra.user_id
       FROM role_assignments ra
       JOIN roles r ON r.id = ra.role_id
       JOIN users u ON u.id = ra.user_id
      WHERE ra.company_id=$1
        AND ra.status='active'
        AND u.status='active'
        AND r.role_key IN ('internal_auditor','audit_officer')
        AND (
          $2::uuid IS NULL
          OR ra.scope_type IN ('company_wide','head_office')
          OR EXISTS (
            SELECT 1 FROM role_assignment_branches rab
             WHERE rab.assignment_id = ra.id AND rab.branch_id = $2
          )
        )`,
    [companyId, branchId ?? null]
  );
  return r.rows.map((row) => row.user_id);
}

/**
 * RULE 6.5.5 - notify the company's auditors of an auditable money event.
 * Nothing is sent twice to the same person for one event.
 */
export async function notifyAuditors(
  db: pg.PoolClient,
  input: {
    companyId: string;
    branchId?: string | null;
    kind: string;
    payload: Record<string, unknown>;
    excludeUserIds?: string[];
  }
): Promise<number> {
  const exclude = new Set(input.excludeUserIds ?? []);
  const auditors = (await activeAuditorUserIds(db, input.companyId, input.branchId ?? null))
    .filter((id) => !exclude.has(id));
  for (const auditor of auditors) {
    await db.query(
      `INSERT INTO notifications (company_id, recipient_user_id, kind, payload, channel)
       VALUES ($1,$2,$3,$4::jsonb,'in_app')`,
      [input.companyId, auditor, input.kind, JSON.stringify(input.payload)]
    );
  }
  return auditors.length;
}