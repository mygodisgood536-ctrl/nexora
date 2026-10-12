import pg from "pg";
import { env } from "../config/env";

/**
 * Serverless-aware connection pool.
 *
 * On a long-running Node server this pool is warm and `max: 10` is sensible.
 * On a serverless platform (Vercel) EVERY concurrent invocation may get its own
 * instance and therefore its own pool, so the effective ceiling is
 * `max x concurrent instances`. A fixed 10 can exhaust the database's
 * connection limit quickly and produce intermittent "timeout exceeded when
 * trying to connect" failures that look nothing like the real cause.
 *
 * Two things make this safe on Vercel without weakening it locally:
 *   - `DATABASE_POOL_MAX` is configurable, and the deployment guide tells you
 *     to point DATABASE_URL at a POOLED endpoint (Neon pooler / PgBouncer /
 *     Supabase pooler) so the database, not the lambda, bounds concurrency.
 *   - `connectionTimeoutMillis` is bounded, so an unreachable database fails
 *     the request quickly instead of burning the function's wall-clock.
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
  // Fail fast rather than hanging a serverless invocation on an unreachable DB.
  connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
  // TLS is driven by DATABASE_URL (sslmode=/sslrootcert=) unless explicitly
  // overridden. There is no "encrypt but do not verify" option here.
  ...(env.DATABASE_SSL === "disable"
    ? { ssl: false }
    : env.DATABASE_SSL === "verify-full"
      ? { ssl: { rejectUnauthorized: true } }
      : {})
});

export async function dbHealth(): Promise<"up" | "down"> {
  try {
    await pool.query("SELECT 1");
    return "up";
  } catch {
    return "down";
  }
}

export async function withTenantSession<T>(
  companyId: string,
  branchId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  if (!companyId) {
    throw new Error("withTenantSession requires a company id");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
    await client.query("SELECT set_config('app.branch_id', $1, true)", [branchId]);
    // Branch-scoped session enforcement (Part 1 §9): when a branch context
    // is present, enable branch restriction so RLS policies limit access
    // to that branch's data only. Always reset the flag first so a
    // pooled connection that was previously used for a branch-restricted
    // session cannot leak the restriction into a wider subsequent call.
    await client.query("SELECT set_config('app.branch_restricted', 'off', true)");
    if (branchId) {
      await client.query("SELECT set_config('app.branch_restricted', 'on', true)");
    }
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

export async function closePool(): Promise<void> {
  await pool.end();
}
