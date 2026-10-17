import type pg from "pg";
import { pool, withTenantSession } from "./pool";
import { AppError } from "../lib/errors";
import { getRequestContext } from "../lib/async-context";

/**
 * Repository base (ROADMAP §5.3): refuses to execute without an established
 * tenant session — every tenant query goes through here so a missing
 * company context fails closed instead of silently leaking.
 */
export async function withTenant<T>(
  companyId: string | null | undefined,
  branchId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  if (!companyId) {
    throw AppError.internal("tenant session required but missing");
  }
  return withTenantSession(companyId, branchId, fn);
}

/**
 * RULE 14.3.1 / 18.17 - the role assignment used. Stamped on every transaction
 * so `audit_logs.role_used` defaults to it (migration 0089) and no audit
 * writer can forget to record which duty acted.
 */
async function stampActingRole(client: pg.PoolClient): Promise<void> {
  const roleKey = getRequestContext()?.actor?.roleKey;
  if (roleKey) {
    await client.query("SELECT set_config('app.role_used', $1, true)", [roleKey]);
  }
}

/** Pre-auth / platform-path transaction: RLS bypass flag set for the txn. */
export async function withBypass<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
    await stampActingRole(client);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
