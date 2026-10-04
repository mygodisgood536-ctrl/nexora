import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

export interface OverdueEscalationActor {
  userId: string;
  companyId: string;
  branchId: string | null;
}

export interface EscalationLevel {
  level: number;
  name: string;
  minDaysPastDue: number;
  roleKeys: string[];
}

export const DEFAULT_ESCALATION_LADDER: EscalationLevel[] = [
  { level: 1, name: "responsible_worker", minDaysPastDue: 0, roleKeys: ["collection_officer"] },
  { level: 2, name: "branch_manager", minDaysPastDue: 7, roleKeys: ["branch_manager", "deputy_branch_manager"] },
  { level: 3, name: "recovery", minDaysPastDue: 14, roleKeys: ["recovery_officer"] },
  { level: 4, name: "credit", minDaysPastDue: 30, roleKeys: ["credit_manager", "credit_officer"] },
  { level: 5, name: "md", minDaysPastDue: 60, roleKeys: ["md", "deputy_md"] }
];

export interface OverdueEscalationRow {
  id: string;
  customerId: string;
  loanId: string;
  branchId: string;
  escalationLevel: number;
  levelName: string;
  daysPastDue: number;
  amountDue: string;
  notifiedUserIds: string[];
  status: string;
  raisedAt: Date;
  resolvedAt: Date | null;
}

export interface OverdueEscalationRunResult {
  graceDaysApplied: number;
  casesExamined: number;
  escalationsRaised: number;
  notificationsSent: number;
  escalations: Array<{ level: string; customerId: string; daysPastDue: number; notified: string[] }>;
}

export interface OverdueEscalationOptions {
  graceDays?: number;
  ladder?: EscalationLevel[];
  limit?: number;
  now?: Date;
}

async function recipientsForLevel(
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }> },
  companyId: string,
  branchId: string,
  roleKeys: string[],
  exclude: string[]
): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `SELECT DISTINCT u.id
       FROM role_assignments ra
       JOIN users u ON u.id = ra.user_id AND u.status = 'active'
       JOIN roles r ON r.id = ra.role_id
      WHERE ra.company_id = $1
        AND ra.status = 'active'
        AND r.role_key = ANY($3::text[])
        AND NOT (u.id = ANY($4::uuid[]))
        AND (
          ra.scope_type IN ('company_wide','head_office')
          OR EXISTS (
            SELECT 1 FROM role_assignment_branches rab
             WHERE rab.assignment_id = ra.id AND rab.branch_id = $2
          )
        )`,
    [companyId, branchId, roleKeys, exclude]
  );
  return rows.rows.map((row) => row.id);
}

/**
 * RULE 10.6.2 — overdue escalation. Overdue is computed by the schedule and the
 * company's grace rule; a person never decides it. Each level is raised once
 * while open, and the ladder defaults to responsible worker -> branch manager
 * -> recovery -> credit -> MD, configurable per company.
 */
export async function runOverdueEscalation(
  actor: OverdueEscalationActor,
  options: OverdueEscalationOptions = {}
): Promise<OverdueEscalationRunResult> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  const ladder = options.ladder ?? DEFAULT_ESCALATION_LADDER;
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);

  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const settings = await db.query<{ overdue_grace_days: number }>(
      `SELECT overdue_grace_days FROM company_settings WHERE company_id=$1`,
      [actor.companyId]
    );
    const graceDays = options.graceDays ?? settings.rows[0]?.overdue_grace_days ?? 0;

    const cases = await db.query<{
      loan_id: string; customer_id: string; branch_id: string;
      amount_due: string; days_past_due: number; responsible_user_id: string | null;
    }>(
      `SELECT l.id AS loan_id, l.customer_id, l.branch_id,
              SUM(rs.expected_repayment - rs.actual_repayment)::numeric(14,2) AS amount_due,
              (current_date - MIN(rs.due_date))::int AS days_past_due,
              (ARRAY_AGG(ca.staff_id))[1] AS responsible_user_id
         FROM loans l
         JOIN repayment_schedule_rows rs ON rs.loan_id = l.id
         LEFT JOIN customer_assignments ca
           ON ca.customer_id = l.customer_id AND ca.status = 'active'
        WHERE l.status IN ('active','overdue')
          AND l.company_id = $1
          AND rs.due_date <= current_date - $2::int
          AND (rs.expected_repayment - rs.actual_repayment) > 0
          AND ($3::uuid IS NULL OR l.branch_id = $3)
        GROUP BY l.id, l.customer_id, l.branch_id
        ORDER BY days_past_due DESC
        LIMIT $4`,
      [actor.companyId, graceDays, actor.branchId, limit]
    );

    const result: OverdueEscalationRunResult = {
      graceDaysApplied: graceDays,
      casesExamined: cases.rowCount ?? 0,
      escalationsRaised: 0,
      notificationsSent: 0,
      escalations: []
    };

    for (const overdue of cases.rows) {
      for (const level of ladder) {
        if (overdue.days_past_due < level.minDaysPastDue) continue;

        const existing = await db.query<{ id: string }>(
          `SELECT id FROM overdue_escalations
            WHERE company_id=$1 AND loan_id=$2 AND escalation_level=$3
              AND status='open'
            LIMIT 1`,
          [actor.companyId, overdue.loan_id, level.level]
        );
        if ((existing.rowCount ?? 0) > 0) continue;

        const recipients = new Set<string>(
          await recipientsForLevel(db, actor.companyId, overdue.branch_id, level.roleKeys, [
            actor.userId
          ])
        );
        if (level.level === 1 && overdue.responsible_user_id) {
          recipients.add(overdue.responsible_user_id);
        }
        const notified = [...recipients].filter((id) => id !== actor.userId);

        const inserted = await db.query<{ id: string }>(
          `INSERT INTO overdue_escalations
             (company_id, branch_id, customer_id, loan_id, escalation_level, level_name,
              days_past_due, amount_due, notified_user_ids, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [
            actor.companyId, overdue.branch_id, overdue.customer_id, overdue.loan_id,
            level.level, level.name, overdue.days_past_due, overdue.amount_due,
            notified,
            JSON.stringify({
              responsible_user_id: overdue.responsible_user_id,
              grace_days: graceDays,
              min_days_for_level: level.minDaysPastDue
            })
          ]
        );

        for (const recipient of notified) {
          await db.query(
            `INSERT INTO notifications (company_id, recipient_user_id, kind, payload, channel)
             VALUES ($1,$2,'loan.overdue_escalation',$3,'in_app')`,
            [
              actor.companyId,
              recipient,
              JSON.stringify({
                loan_id: overdue.loan_id,
                customer_id: overdue.customer_id,
                branch_id: overdue.branch_id,
                escalation_level: level.level,
                level_name: level.name,
                days_past_due: overdue.days_past_due,
                amount_due: overdue.amount_due,
                escalation_id: inserted.rows[0]!.id
              })
            ]
          );
          result.notificationsSent += 1;
        }

        await db.query(
          `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                                   entity_id, previous_value, new_value, reason)
           VALUES ($1,$2,$3,'loan.overdue_escalated','loans',$4,$5,$6,$7)`,
          [
            actor.companyId, overdue.branch_id, actor.userId, overdue.loan_id,
            JSON.stringify({ escalation_level: level.level, status: "open" }),
            JSON.stringify({
              escalation_level: level.level,
              level_name: level.name,
              days_past_due: overdue.days_past_due,
              amount_due: overdue.amount_due,
              notified: notified
            }),
            `Overdue escalated to ${level.name}`
          ]
        );

        result.escalationsRaised += 1;
        result.escalations.push({
          level: level.name,
          customerId: overdue.customer_id,
          daysPastDue: overdue.days_past_due,
          notified
        });
      }
    }

    return result;
  });
}

export async function listOverdueEscalations(
  actor: OverdueEscalationActor,
  options: { status?: string; limit?: number } = {}
): Promise<OverdueEscalationRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const { rows } = await db.query<{
      id: string; customer_id: string; loan_id: string; branch_id: string;
      escalation_level: number; level_name: string; days_past_due: number;
      amount_due: string; notified_user_ids: string[]; status: string;
      raised_at: Date; resolved_at: Date | null;
    }>(
      `SELECT id, customer_id, loan_id, branch_id, escalation_level, level_name,
              days_past_due, amount_due, notified_user_ids, status, raised_at, resolved_at
         FROM overdue_escalations
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::uuid IS NULL OR branch_id = $2)
        ORDER BY raised_at DESC
        LIMIT $3`,
      [options.status ?? null, actor.branchId, limit]
    );
    return rows.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      loanId: row.loan_id,
      branchId: row.branch_id,
      escalationLevel: row.escalation_level,
      levelName: row.level_name,
      daysPastDue: row.days_past_due,
      amountDue: row.amount_due,
      notifiedUserIds: row.notified_user_ids,
      status: row.status,
      raisedAt: row.raised_at,
      resolvedAt: row.resolved_at
    }));
  });
}

export async function resolveOverdueEscalation(
  actor: OverdueEscalationActor,
  escalationId: string,
  note: string
): Promise<{ id: string; resolvedAt: Date }> {
  if (!actor.companyId) throw AppError.internal("tenant session required but missing");
  if (!note || note.trim().length < 3) {
    throw AppError.unprocessable("A resolution note is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const updated = await db.query<{ id: string; resolved_at: Date }>(
      `UPDATE overdue_escalations
          SET resolved_at = now()
        WHERE id = $1 AND company_id = $2 AND status = 'open'
        RETURNING id, resolved_at`,
      [escalationId, actor.companyId]
    );
    if ((updated.rowCount ?? 0) === 0) throw AppError.notFound("Open escalation not found");
    await db.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type,
                               entity_id, previous_value, new_value, reason)
       VALUES ($1,$2,'loan.overdue_escalation_resolved','overdue_escalations',$3,$4,$5,$6)`,
      [
        actor.companyId, actor.userId, escalationId,
        JSON.stringify({ status: "open" }),
        JSON.stringify({ status: "resolved", resolved_at: updated.rows[0]!.resolved_at.toISOString() }),
        note
      ]
    );
    return { id: updated.rows[0]!.id, resolvedAt: updated.rows[0]!.resolved_at };
  });
}
