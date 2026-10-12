import type pg from "pg";
import { withTenantSession } from "../../db/pool";

/**
 * Part 12 §12.31 (IT / System Administrator) — the Technical hub includes a
 * "Sessions" surface: who is signed in to this company, from where, since when,
 * and whether the session is still live.
 *
 * Rules honoured here:
 *  - Company-scoped only. The read runs inside `withTenantSession`, so RLS
 *    (RULE 1.1 / Stage 1) filters by `app.company_id` even if the query were
 *    wrong. A session belonging to another company is unreachable.
 *  - No secret material. `token_hash` is deliberately never selected: the
 *    column is a hash, but exposing it would be needless attack surface and
 *    would edge toward prohibition 22 (secrets in screens/exports).
 *  - Read-only. There is no write path here; ending someone's session happens
 *    through the credential controls that already exist (freeze, hold,
 *    terminate), each of which revokes sessions server-side and audits it.
 */
export interface SessionRow {
  id: string;
  userId: string;
  workerName: string;
  workerCode: string | null;
  status: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  createdIp: string | null;
  userAgent: string | null;
  live: boolean;
}

export interface SessionActor {
  userId: string;
  companyId: string;
  branchId: string | null;
}

export async function listSessions(
  actor: SessionActor,
  options: { limit?: number; includeExpired?: boolean } = {}
): Promise<SessionRow[]> {
  if (!actor.companyId) throw new Error("tenant session required but missing");
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);

  return withTenantSession(actor.companyId, actor.branchId, async (db: pg.PoolClient) => {
    const { rows } = await db.query<{
      id: string;
      user_id: string;
      full_name: string | null;
      worker_code: string | null;
      user_status: string | null;
      credential_state: string | null;
      created_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
      created_ip: string | null;
      user_agent: string | null;
    }>(
      `SELECT rt.id, rt.user_id,
              TRIM(CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name)) AS full_name,
              u.worker_code, u.status AS user_status, u.credential_state,
              rt.created_at, rt.expires_at, rt.revoked_at,
              rt.created_ip, rt.user_agent
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE ($2::boolean OR rt.revoked_at IS NULL)
        ORDER BY rt.created_at DESC
        LIMIT $1`,
      [limit, options.includeExpired === true]
    );

    return rows.map((row) => {
      const revoked = row.revoked_at !== null;
      const expired = row.expires_at.getTime() <= Date.now();
      const workerGone = row.user_status === "terminated";
      return {
        id: row.id,
        userId: row.user_id,
        workerName: row.full_name ?? row.user_id.slice(0, 8),
        workerCode: row.worker_code,
        status: revoked ? "revoked" : expired ? "expired" : "live",
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
        createdIp: row.created_ip,
        userAgent: row.user_agent,
        // A session is only live while the credential behind it is live: a
        // frozen or terminated worker's rows may still be unexpired, and
        // showing them as live would misstate the security posture.
        live: !revoked && !expired && !workerGone,
      };
    });
  });
}