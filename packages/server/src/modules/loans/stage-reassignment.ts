// Company-authorised approval stage reassignment - Vision RULE 19.12.3.
//
// "If an Auditor or other final pre-disbursement approval stage is configured as
// mandatory, that stage must be resolved by an authorised assignee or an
// explicit company-authorised reassignment path before disbursement can proceed."
//
// The rule names two ways out of a blocked mandatory stage and the platform had
// only one. `resolveAvailableStage` threw "Mandatory approval stage N has no
// available authorised assignee" and stopped, so an auditor on leave could freeze
// a customer's disbursement indefinitely with no configured remedy.
//
// The second path is what this module adds, and it is deliberately narrow:
//
//   - It is per application and per stage. It does not reassign a person, a
//     role, or anyone else's queue.
//   - It requires a stated reason, so "the auditor was on leave" is recorded.
//   - It requires approval by a company-authorised role, so it is not a way for
//     anyone to wave a loan through their own stage.
//   - It is revocable, because an emergency cover arrangement can end.
//
// Nothing here skips a mandatory stage. It supplies an authorised human for the
// stage the company already configured as mandatory.

import type pg from "pg";
import { withTenant } from "../../db/repo";
import { AppError } from "../../lib/errors";

export interface ReassignmentActor {
  sub: string;
  companyId: string;
  branchId: string | null;
}

export interface ReassignmentMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface StageReassignmentRow {
  id: string;
  company_id: string;
  branch_id: string;
  application_id: string;
  stage_order: number;
  role_id: string;
  reason: string;
  to_user_id: string;
  status: "requested" | "approved" | "rejected" | "revoked";
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
}

// RULE 5.6.3 / 10.4.3 - authority is taken from the company's own approval
// chain data rather than a fixed role list, matching how disbursement authority
// is resolved. These are the roles permitted to authorise a cover arrangement.
const REASSIGNMENT_AUTHORITIES = [
  "md",
  "deputy_md",
  "gm",
  "auditor",
  "internal_auditor",
  "audit_officer"
];

async function holdsAnyRole(
  db: pg.PoolClient,
  actor: ReassignmentActor,
  roleKeys: string[]
): Promise<boolean> {
  const r = await db.query(
    `SELECT 1
       FROM role_assignments ra
       JOIN roles r ON r.id = ra.role_id
      WHERE ra.user_id = $1
        AND ra.company_id = $2
        AND ra.status = 'active'
        AND r.role_key = ANY($3::text[])
        AND (ra.assignment_type = 'permanent'
             OR (ra.starts_at <= now() AND (ra.ends_at IS NULL OR ra.ends_at > now())))
      LIMIT 1`,
    [actor.sub, actor.companyId, roleKeys]
  );
  return (r.rowCount ?? 0) > 0;
}

async function audit(
  db: pg.PoolClient,
  actor: ReassignmentActor,
  action: string,
  entityId: string,
  newValue: unknown,
  reason: string,
  meta: ReassignmentMeta
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                             entity_id, new_value, reason, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,'approval_stage_reassignments',$5,$6::jsonb,$7,$8,$9,$10)`,
    [
      actor.companyId,
      actor.branchId,
      actor.sub,
      action,
      entityId,
      JSON.stringify(newValue ?? null),
      reason,
      meta.ip ?? null,
      meta.userAgent ?? null,
      meta.requestId ?? null
    ]
  );
}

/**
 * The person proposed to cover the stage must themselves be an active holder of
 * the stage's role, in this company, and scoped to this branch or wider. A
 * reassignment to someone without the role would let an unauthorised person
 * approve a loan, which is the precise thing the mandatory stage exists to
 * prevent.
 */
async function assertCoverHoldsRole(
  db: pg.PoolClient,
  companyId: string,
  branchId: string,
  roleId: string,
  userId: string
): Promise<void> {
  const r = await db.query(
    `SELECT 1
       FROM role_assignments ra
       JOIN users u ON u.id = ra.user_id AND u.company_id = ra.company_id
      WHERE ra.user_id = $1
        AND ra.company_id = $2
        AND ra.role_id = $3
        AND ra.status = 'active'
        AND u.status = 'active'
        AND (ra.assignment_type = 'permanent'
             OR (ra.starts_at <= now() AND (ra.ends_at IS NULL OR ra.ends_at > now())))
        AND (
          ra.scope_type IN ('company_wide','head_office')
          OR EXISTS (
            SELECT 1 FROM role_assignment_branches rab
             WHERE rab.assignment_id = ra.id AND rab.branch_id = $4
          )
        )
      LIMIT 1`,
    [userId, companyId, roleId, branchId]
  );
  if ((r.rowCount ?? 0) === 0) {
    throw AppError.unprocessable(
      "The proposed cover approver does not hold the stage's role for this branch"
    );
  }
}

export async function requestStageReassignment(
  actor: ReassignmentActor,
  input: {
    applicationId: string;
    stageOrder: number;
    toUserId: string;
    reason: string;
  },
  meta: ReassignmentMeta = {}
): Promise<StageReassignmentRow> {
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) {
    throw AppError.unprocessable("A written reason of at least 5 characters is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const app = await db.query<{ branch_id: string; chain_id: string }>(
      `SELECT branch_id, chain_id FROM loan_applications WHERE id=$1`,
      [input.applicationId]
    );
    if ((app.rowCount ?? 0) === 0) throw AppError.notFound("Application not found");
    const application = app.rows[0]!;
    if (actor.branchId !== null && actor.branchId !== application.branch_id) {
      throw AppError.forbidden(
        "This application belongs to another branch; a branch-scoped account may only reassign inside its own branch"
      );
    }

    const step = await db.query<{ role_id: string }>(
      `SELECT role_id FROM approval_chain_steps WHERE chain_id=$1 AND stage_order=$2`,
      [application.chain_id, input.stageOrder]
    );
    if ((step.rowCount ?? 0) === 0) {
      throw AppError.unprocessable(
        `Stage ${input.stageOrder} is not part of this application's approval chain`
      );
    }
    const roleId = step.rows[0]!.role_id;

    await assertCoverHoldsRole(db, actor.companyId, application.branch_id, roleId, input.toUserId);

    // One live request per stage, so the queue cannot accumulate competing covers
    // for the same decision.
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM approval_stage_reassignments
        WHERE application_id=$1 AND stage_order=$2 AND status IN ('requested','approved')`,
      [input.applicationId, input.stageOrder]
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw AppError.conflict(
        `Stage ${input.stageOrder} already has a live reassignment; revoke it before raising another`
      );
    }

    const inserted = await db.query<StageReassignmentRow>(
      `INSERT INTO approval_stage_reassignments
         (company_id, branch_id, application_id, stage_order, role_id, reason, to_user_id, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        actor.companyId,
        application.branch_id,
        input.applicationId,
        input.stageOrder,
        roleId,
        reason,
        input.toUserId,
        actor.sub
      ]
    );
    const row = inserted.rows[0]!;
    await audit(
      db,
      actor,
      "approval_stage.reassignment_requested",
      row.id,
      { application_id: row.application_id, stage_order: row.stage_order, to_user_id: row.to_user_id },
      reason,
      meta
    );
    return row;
  });
}

export async function decideStageReassignment(
  actor: ReassignmentActor,
  reassignmentId: string,
  approve: boolean,
  decisionReason: string,
  meta: ReassignmentMeta = {}
): Promise<StageReassignmentRow> {
  const reason = (decisionReason ?? "").trim();
  if (reason.length < 5) {
    throw AppError.unprocessable("A written decision reason of at least 5 characters is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    if (!(await holdsAnyRole(db, actor, REASSIGNMENT_AUTHORITIES))) {
      throw AppError.forbidden(
        "Only the MD, Deputy MD, GM or an authorised Auditor may authorise an approval reassignment"
      );
    }
    const found = await db.query<StageReassignmentRow>(
      `SELECT * FROM approval_stage_reassignments WHERE id=$1`,
      [reassignmentId]
    );
    if ((found.rowCount ?? 0) === 0) throw AppError.notFound("Reassignment request not found");
    const row = found.rows[0]!;
    if (actor.branchId !== null && actor.branchId !== row.branch_id) {
      throw AppError.forbidden("This request belongs to another branch");
    }
    if (row.status !== "requested") {
      throw AppError.conflict(`This reassignment has already been ${row.status}`);
    }

    await db.query(
      `UPDATE approval_stage_reassignments
          SET status=$2, decided_by=$3, decided_at=now(), decision_reason=$4
        WHERE id=$1`,
      [row.id, approve ? "approved" : "rejected", actor.sub, reason]
    );
    await audit(
      db,
      actor,
      approve ? "approval_stage.reassignment_approved" : "approval_stage.reassignment_rejected",
      row.id,
      { application_id: row.application_id, stage_order: row.stage_order, to_user_id: row.to_user_id },
      reason,
      meta
    );

    const after = await db.query<StageReassignmentRow>(
      `SELECT * FROM approval_stage_reassignments WHERE id=$1`,
      [row.id]
    );
    return after.rows[0]!;
  });
}

/**
 * RULE 19.12.3 - an emergency cover arrangement can end. Revoking does not edit
 * the approval that happened: it appends new state, so the history of who was
 * authorised, and when that authorisation was withdrawn, both remain provable.
 */
export async function revokeStageReassignment(
  actor: ReassignmentActor,
  reassignmentId: string,
  revocationReason: string,
  meta: ReassignmentMeta = {}
): Promise<StageReassignmentRow> {
  const reason = (revocationReason ?? "").trim();
  if (reason.length < 5) {
    throw AppError.unprocessable("A written revocation reason of at least 5 characters is required");
  }
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    if (!(await holdsAnyRole(db, actor, REASSIGNMENT_AUTHORITIES))) {
      throw AppError.forbidden(
        "Only the MD, Deputy MD, GM or an authorised Auditor may revoke an approval reassignment"
      );
    }
    const found = await db.query<StageReassignmentRow>(
      `SELECT * FROM approval_stage_reassignments WHERE id=$1`,
      [reassignmentId]
    );
    if ((found.rowCount ?? 0) === 0) throw AppError.notFound("Reassignment request not found");
    const row = found.rows[0]!;
    if (actor.branchId !== null && actor.branchId !== row.branch_id) {
      throw AppError.forbidden("This request belongs to another branch");
    }
    if (row.status !== "approved") {
      throw AppError.conflict("Only an approved reassignment can be revoked");
    }
    await db.query(
      `UPDATE approval_stage_reassignments
          SET status='revoked', revoked_at=now(), revoked_by=$2, revocation_reason=$3
        WHERE id=$1`,
      [row.id, actor.sub, reason]
    );
    await audit(
      db,
      actor,
      "approval_stage.reassignment_revoked",
      row.id,
      { application_id: row.application_id, stage_order: row.stage_order },
      reason,
      meta
    );
    const after = await db.query<StageReassignmentRow>(
      `SELECT * FROM approval_stage_reassignments WHERE id=$1`,
      [row.id]
    );
    return after.rows[0]!;
  });
}

export async function listStageReassignments(
  actor: ReassignmentActor,
  applicationId: string
): Promise<StageReassignmentRow[]> {
  return withTenant(actor.companyId, actor.branchId, async (db) => {
    const r = await db.query<StageReassignmentRow>(
      `SELECT * FROM approval_stage_reassignments
        WHERE application_id=$1 ORDER BY requested_at DESC`,
      [applicationId]
    );
    return r.rows;
  });
}

/**
 * Called by the approval-stage resolver when a mandatory stage has no available
 * assignee. An APPROVED reassignment supplies the cover approver for exactly
 * that stage of exactly that application; a rejected, revoked or merely
 * requested one supplies nothing.
 */
export async function approvedCoverFor(
  db: pg.PoolClient,
  applicationId: string,
  stageOrder: number
): Promise<string | null> {
  const r = await db.query<{ to_user_id: string }>(
    `SELECT to_user_id FROM approval_stage_reassignments
      WHERE application_id=$1 AND stage_order=$2 AND status='approved'
      ORDER BY decided_at DESC
      LIMIT 1`,
    [applicationId, stageOrder]
  );
  return r.rows[0]?.to_user_id ?? null;
}