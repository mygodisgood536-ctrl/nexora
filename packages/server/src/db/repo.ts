import type pg from "pg";
import { pool, withTenantSession } from "./pool";
import { AppError } from "../lib/errors";

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

/** Pre-auth / platform-path transaction: RLS bypass flag set for the txn. */
export async function withBypass<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
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
