import pg from "pg";
import { env } from "../config/env";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000
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
