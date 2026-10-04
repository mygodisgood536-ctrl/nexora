import type pg from "pg";
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";
import { calculatePerformanceSet, isoDate } from "../performance/engine";

export interface CollectionWatchActor {
  userId: string;
  companyId: string;
  branchId: string | null;
}

export interface CollectionWatchAlert {
  alertKind:
    | "payment_awaiting_allocation"
    | "customer_missed_full_cycle"
    | "group_silent"
    | "worker_below_target";
  subjectType: "payment" | "customer" | "group" | "worker";
  subjectId: string;
  branchId: string;
  responsibleUserId: string | null;
  detail: Record<string, unknown>;
}

export interface CollectionWatchRunResult {
  checkedCompanies: number;
  alertsRaised: number;
  notificationsSent: number;
  alerts: Array<{ alertKind: string; subjectType: string; subjectId: string; notified: string[] }>;
}

async function notifyRecipients(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  recipients: string[],
  kind: string,
  payload: Record<string, unknown>
): Promise<number> {
  let sent = 0;
  for (const recipient of new Set(recipients.filter(Boolean))) {
    await db.query(
      `INSERT INTO notifications (company_id, recipient_user_id, kind, payload, channel)
       VALUES ($1,$2,$3,$4,'in_app')`,
      [companyId, recipient, kind, JSON.stringify({ ...payload, branch_id: branchId })]
    );
    sent += 1;
  }
  return sent;
}

async function peopleManagers(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  excludeUserIds: string[]
): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `SELECT DISTINCT u.id
       FROM role_assignments ra
       JOIN users u ON u.id = ra.user_id AND u.status = 'active'
       JOIN roles r ON r.id = ra.role_id
      WHERE ra.company_id = $1
        AND ra.status = 'active'
        AND r.role_key IN ('md','deputy_md','gm','assistant_gm','hr_manager','hr_officer')
        AND NOT (u.id = ANY($3::uuid[]))
        AND (
          ra.scope_type IN ('company_wide','head_office')
          OR EXISTS (
            SELECT 1 FROM role_assignment_branches rab
             WHERE rab.assignment_id = ra.id AND rab.branch_id = $2
          )
        )`,
    [companyId, branchId, excludeUserIds]
  );
  return rows.rows.map((row) => row.id);
}

async function branchManagers(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  excludeUserIds: string[]
): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `SELECT DISTINCT u.id
       FROM role_assignments ra
       JOIN users u ON u.id = ra.user_id AND u.status = 'active'
       JOIN roles r ON r.id = ra.role_id
      WHERE ra.company_id = $1
        AND ra.status = 'active'
        AND r.role_key IN ('md','deputy_md','gm','assistant_gm','branch_manager',
                           'deputy_branch_manager','senior_collection_officer')
        AND NOT (u.id = ANY($3::uuid[]))
        AND (
          ra.scope_type IN ('company_wide','head_office')
          OR EXISTS (
            SELECT 1 FROM role_assignment_branches rab
             WHERE rab.assignment_id = ra.id AND rab.branch_id = $2
          )
        )`,
    [companyId, branchId, excludeUserIds]
  );
  return rows.rows.map((row) => row.id);
}

async function raiseAlert(
  db: pg.PoolClient,
  companyId: string,
  alert: CollectionWatchAlert,
  kind: string,
  extraRecipients: string[],
  excludeUserIds: string[]
): Promise<string[] | null> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM collection_watch_alerts
      WHERE company_id=$1 AND alert_kind=$2 AND subject_type=$3 AND subject_id=$4
        AND resolved_at IS NULL
      LIMIT 1`,
    [companyId, alert.alertKind, alert.subjectType, alert.subjectId]
  );
  if ((existing.rowCount ?? 0) > 0) return null;

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO collection_watch_alerts
       (company_id, branch_id, alert_kind, subject_type, subject_id,
        responsible_user_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      companyId, alert.branchId, alert.alertKind, alert.subjectType,
      alert.subjectId, alert.responsibleUserId, JSON.stringify(alert.detail)
    ]
  );
  if ((inserted.rowCount ?? 0) === 0) return null;

  const recipients = [
    ...(alert.responsibleUserId ? [alert.responsibleUserId] : []),
    ...extraRecipients
  ].filter((id) => !excludeUserIds.includes(id));
  await notifyRecipients(db, companyId, alert.branchId, recipients, kind, {
    alert_kind: alert.alertKind,
    subject_type: alert.subjectType,
    subject_id: alert.subjectId,
    ...alert.detail
  });
  return recipients;
}

export interface CollectionWatchOptions {
  allocationWindowHours?: number;
  fullCycleDays?: number;
  belowTargetRate?: number;
  now?: Date;
}

/** The company's configured grace days, so the watch uses the engine's basis. */
async function graceDays(db: pg.PoolClient, companyId: string): Promise<number> {
  const r = await db.query<{ overdue_grace_days: number }>(
    `SELECT overdue_grace_days FROM company_settings WHERE company_id=$1`,
    [companyId]
  );
  return r.rows[0]?.overdue_grace_days ?? 0;
}

/**
 * RULE 6.4.2 / 9.9.1 / 9.9.2 — the standing collection watch. It raises, at
 * most once per open subject:
 *   1. a payment received but not allocated within the configured window,
 *   2. a customer who has not paid for a full cycle window,
 *   3. a group that has stopped paying entirely,
 *   4. a worker whose collection rate is below the configured target.
 * Notifications reach the responsible worker and the people who manage
 * workers, exactly as Part 6.4.2 requires.
 */
export async function runCollectionWatch(
  actor: CollectionWatchActor,
  options: CollectionWatchOptions = {}
): Promise<CollectionWatchRunResult> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  const now = options.now ?? new Date();
  const allocationCutoff = new Date(
    now.getTime() - (options.allocationWindowHours ?? 24) * 60 * 60 * 1000
  );
  const cycleCutoff = new Date(
    now.getTime() - (options.fullCycleDays ?? 30) * 24 * 60 * 60 * 1000
  );
  const belowTargetRate = options.belowTargetRate ?? 50;

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const result: CollectionWatchRunResult = {
      checkedCompanies: 1,
      alertsRaised: 0,
      notificationsSent: 0,
      alerts: []
    };

    // 1. Money received but not allocated in time.
    const unallocated = await db.query<{
      id: string; branch_id: string; customer_id: string; amount: string;
      received_at: Date; created_by: string | null;
    }>(
      `SELECT p.id, p.branch_id, p.customer_id, p.amount, p.received_at,
              COALESCE(c.created_by, NULL) AS created_by
         FROM payments p
         JOIN customers c ON c.id = p.customer_id
        WHERE p.status IN ('received','verified','identified','unallocated')
          AND p.received_at <= $1
        ORDER BY p.received_at ASC
        LIMIT 200`,
      [allocationCutoff]
    );
    for (const payment of unallocated.rows) {
      const managers = await peopleManagers(db, actor.companyId, payment.branch_id, [actor.userId]);
      const branchLeads = await branchManagers(db, actor.companyId, payment.branch_id, [actor.userId]);
      const recipients = await raiseAlert(
        db,
        actor.companyId,
        {
          alertKind: "payment_awaiting_allocation",
          subjectType: "payment",
          subjectId: payment.id,
          branchId: payment.branch_id,
          responsibleUserId: payment.created_by,
          detail: {
            customer_id: payment.customer_id,
            amount: payment.amount,
            received_at: payment.received_at.toISOString(),
            days_waiting: Math.floor(
              (now.getTime() - payment.received_at.getTime()) / (24 * 60 * 60 * 1000)
            )
          }
        },
        "payment.awaiting_allocation_overdue",
        [...managers, ...branchLeads],
        [actor.userId]
      );
      if (recipients) {
        result.alertsRaised += 1;
        result.notificationsSent += recipients.length;
        result.alerts.push({
          alertKind: "payment_awaiting_allocation",
          subjectType: "payment",
          subjectId: payment.id,
          notified: recipients
        });
      }
    }

    // 2. A customer who has not paid for a full cycle window.
    const missed = await db.query<{
      customer_id: string; branch_id: string; outstanding: string; last_payment_at: Date | null;
      responsible_user_id: string | null;
    }>(
      `SELECT l.customer_id, l.branch_id,
              COALESCE(SUM(GREATEST(rs.expected_repayment - rs.actual_repayment, 0)), 0) AS outstanding,
              MAX(p.received_at) AS last_payment_at,
              (ARRAY_AGG(c.created_by ORDER BY c.created_at DESC))[1] AS responsible_user_id
         FROM loans l
         JOIN repayment_schedule_rows rs ON rs.loan_id = l.id
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN payments p ON p.customer_id = l.customer_id AND p.status IN ('posted','allocated')
        WHERE l.status IN ('active','overdue')
          AND rs.due_date <= current_date
          AND (rs.expected_repayment - rs.actual_repayment) > 0
        GROUP BY l.customer_id, l.branch_id
       HAVING COALESCE(MAX(p.received_at), MIN(l.disbursed_at)) <= $1
        LIMIT 200`,
      [cycleCutoff]
    );
    for (const customer of missed.rows) {
      const managers = await peopleManagers(db, actor.companyId, customer.branch_id, [actor.userId]);
      const recipients = await raiseAlert(
        db,
        actor.companyId,
        {
          alertKind: "customer_missed_full_cycle",
          subjectType: "customer",
          subjectId: customer.customer_id,
          branchId: customer.branch_id,
          responsibleUserId: customer.responsible_user_id,
          detail: {
            outstanding: customer.outstanding,
            last_payment_at: customer.last_payment_at?.toISOString() ?? null,
            days_since_last_payment: customer.last_payment_at
              ? Math.floor(
                  (now.getTime() - customer.last_payment_at.getTime()) / (24 * 60 * 60 * 1000)
                )
              : null
          }
        },
        "customer.payment_missed_full_cycle",
        managers,
        [actor.userId]
      );
      if (recipients) {
        result.alertsRaised += 1;
        result.notificationsSent += recipients.length;
        result.alerts.push({
          alertKind: "customer_missed_full_cycle",
          subjectType: "customer",
          subjectId: customer.customer_id,
          notified: recipients
        });
      }
    }

    // 3. A group that has stopped paying entirely.
    const silentGroups = await db.query<{
      group_id: string; branch_id: string; members: number; last_payment_at: Date | null;
      responsible_user_id: string | null;
    }>(
      `SELECT gm.group_id, (ARRAY_AGG(c.branch_id))[1] AS branch_id,
              COUNT(*) AS members,
              MAX(p.received_at) AS last_payment_at,
              (ARRAY_AGG(gm.added_by ORDER BY gm.joined_at DESC))[1] AS responsible_user_id
         FROM group_members gm
         JOIN customers c ON c.id = gm.customer_id
         JOIN groups g ON g.id = gm.group_id
         LEFT JOIN payments p
           ON p.customer_id = c.id AND p.status IN ('posted','allocated')
        WHERE g.status = 'active'
        GROUP BY gm.group_id
       HAVING COALESCE(MAX(p.received_at), MIN(c.created_at)) <= $1
        LIMIT 200`,
      [cycleCutoff]
    );
    for (const group of silentGroups.rows) {
      const managers = await peopleManagers(db, actor.companyId, group.branch_id, [actor.userId]);
      const recipients = await raiseAlert(
        db,
        actor.companyId,
        {
          alertKind: "group_silent",
          subjectType: "group",
          subjectId: group.group_id,
          branchId: group.branch_id,
          responsibleUserId: group.responsible_user_id,
          detail: {
            members: Number(group.members),
            last_payment_at: group.last_payment_at?.toISOString() ?? null
          }
        },
        "group.silent",
        managers,
        [actor.userId]
      );
      if (recipients) {
        result.alertsRaised += 1;
        result.notificationsSent += recipients.length;
        result.alerts.push({
          alertKind: "group_silent",
          subjectType: "group",
          subjectId: group.group_id,
          notified: recipients
        });
      }
    }

    // 4. A worker whose collection rate is below the configured target.
    // RULE 11.2.1 - the rate is the performance engine's, never a second
    // calculation. This query only names the candidates (who has anything due);
    // the engine then decides the rate, and the same number drives both the
    // threshold and the alert detail.
    const candidates = await db.query<{
      staff_id: string; branch_id: string;
    }>(
      `SELECT ca.staff_id, (ARRAY_AGG(ca.branch_id))[1] AS branch_id
         FROM customer_assignments ca
         JOIN loans l
           ON l.customer_id = ca.customer_id AND l.status IN ('active','overdue')
         JOIN repayment_schedule_rows rs ON rs.loan_id = l.id
        WHERE rs.due_date <= current_date
        GROUP BY ca.staff_id
       HAVING COALESCE(SUM(rs.expected_repayment), 0) > 0
        LIMIT 200`
    );
    const watchGraceDays = await graceDays(db, actor.companyId);
    const belowTarget: Array<{
      staff_id: string; branch_id: string; expected: string; realised: string; collectionRate: string;
    }> = [];
    for (const candidate of candidates.rows) {
      const perf = await calculatePerformanceSet(db, {
        graceDays: watchGraceDays,
        query: { from: "2020-01-01", to: isoDate() },
        scope: { staffId: candidate.staff_id, branchId: candidate.branch_id }
      });
      if (perf.collectionRate === null) continue;
      if (Number(perf.collectionRate) >= belowTargetRate) continue;
      belowTarget.push({
        staff_id: candidate.staff_id,
        branch_id: candidate.branch_id,
        expected: perf.expected,
        realised: perf.actual,
        collectionRate: perf.collectionRate
      });
    }
    for (const worker of belowTarget) {
      const managers = await peopleManagers(db, actor.companyId, worker.branch_id, [actor.userId]);
      const branchLeads = await branchManagers(db, actor.companyId, worker.branch_id, [actor.userId]);
      const recipients = await raiseAlert(
        db,
        actor.companyId,
        {
          alertKind: "worker_below_target",
          subjectType: "worker",
          subjectId: worker.staff_id,
          branchId: worker.branch_id,
          responsibleUserId: worker.staff_id,
          detail: {
            expected: worker.expected,
            realised: worker.realised,
            // RULE 11.1.1 - the figure the alert shows is the engine's figure.
            collection_rate: Number(worker.collectionRate),
            target_rate: belowTargetRate
          }
        },
        "worker.performance_below_target",
        [...managers, ...branchLeads],
        [actor.userId, worker.staff_id]
      );
      if (recipients) {
        result.alertsRaised += 1;
        result.notificationsSent += recipients.length;
        result.alerts.push({
          alertKind: "worker_below_target",
          subjectType: "worker",
          subjectId: worker.staff_id,
          notified: recipients
        });
      }
    }

    return result;
  });
}

export async function listCollectionWatchAlerts(
  actor: CollectionWatchActor,
  options: { limit?: number; includeResolved?: boolean } = {}
): Promise<Array<{
  id: string;
  alertKind: string;
  subjectType: string;
  subjectId: string;
  branchId: string;
  responsibleUserId: string | null;
  detail: Record<string, unknown>;
  raisedAt: Date;
  resolvedAt: Date | null;
}>> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const { rows } = await db.query<{
      id: string; alert_kind: string; subject_type: string; subject_id: string;
      branch_id: string; responsible_user_id: string | null; detail: Record<string, unknown>;
      raised_at: Date; resolved_at: Date | null;
    }>(
      `SELECT id, alert_kind, subject_type, subject_id, branch_id,
              responsible_user_id, detail, raised_at, resolved_at
         FROM collection_watch_alerts
        WHERE ($2::boolean OR resolved_at IS NULL)
        ORDER BY raised_at DESC
        LIMIT $1`,
      [limit, options.includeResolved === true]
    );
    return rows.map((row) => ({
      id: row.id,
      alertKind: row.alert_kind,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      branchId: row.branch_id,
      responsibleUserId: row.responsible_user_id,
      detail: row.detail,
      raisedAt: row.raised_at,
      resolvedAt: row.resolved_at
    }));
  });
}

export async function resolveCollectionWatchAlert(
  actor: CollectionWatchActor,
  alertId: string,
  note: string
): Promise<{ id: string; resolvedAt: Date }> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  if (!note || note.trim().length < 3) {
    throw AppError.unprocessable("A resolution note is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const updated = await db.query<{ id: string; resolved_at: Date }>(
      `UPDATE collection_watch_alerts
          SET resolved_at = now()
        WHERE id = $1 AND company_id = $2 AND resolved_at IS NULL
        RETURNING id, resolved_at`,
      [alertId, actor.companyId]
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw AppError.notFound("Open alert not found");
    }
    await db.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                               entity_id, previous_value, new_value, reason)
       VALUES ($1,$2,'collection_watch.alert_resolved','collection_watch_alerts',$3,$4,$5,$6)`,
      [
        actor.companyId,
        actor.userId,
        alertId,
        JSON.stringify({ resolved_at: null }),
        JSON.stringify({ resolved_at: updated.rows[0]!.resolved_at.toISOString() }),
        note
      ]
    );
    return { id: updated.rows[0]!.id, resolvedAt: updated.rows[0]!.resolved_at };
  });
}
