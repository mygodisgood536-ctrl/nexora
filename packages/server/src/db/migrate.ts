import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function adminUrlFor(runtimeUrl: string): string {
  const url = new URL(runtimeUrl);
  const admin = new URL(process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:nexora-dev@localhost:5432/postgres");
  admin.pathname = url.pathname;
  return admin.toString();
}

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    await admin.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = new Set(
      (await admin.query<{ filename: string }>("SELECT filename FROM _migrations")).rows.map((r) => r.filename)
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const executed: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      await admin.query("BEGIN");
      try {
        await admin.query(sql);
        await admin.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
        await admin.query("COMMIT");
      } catch (err) {
        await admin.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      executed.push(file);
    }
    return executed;
  } finally {
    await admin.end();
  }
}

/**
 * Resets a database to an empty schema and returns it to a state the application
 * role can actually USE.
 *
 * RLS SAFETY: this grants table/sequence privileges to the application role, but
 * deliberately does NOT grant BYPASSRLS and does not change ownership. The role
 * is therefore still subject to every RLS policy, so tenant isolation is
 * unchanged. The application continues to reach data only through
 * `withTenant()` (tenant context) or `withBypass()` (platform/pre-auth path).
 *
 * BUG FIXED (ISS-008): this previously granted only `USAGE ON SCHEMA`, so any
 * caller of resetDatabase() left the application role unable to read or write a
 * single table - and migrations exited 0, so the breakage was silent.
 */
export async function resetDatabase(adminDatabaseUrl: string): Promise<void> {
  // The application role may be named differently per environment.
  const appRole = process.env.APP_DATABASE_ROLE ?? "nexora";
  const admin = new pg.Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    await admin.query("DROP SCHEMA public CASCADE");
    await admin.query("CREATE SCHEMA public");

    // Does the application role exist at all? Granting to a missing role errors.
    const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appRole]);
    if (exists.rowCount === 0) {
      throw new Error(
        `resetDatabase: application role "${appRole}" does not exist in this cluster. ` +
          `Create it, or set APP_DATABASE_ROLE to the correct role.`
      );
    }

    // Schema access.
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);
    await admin.query(`GRANT CREATE ON SCHEMA public TO ${appRole}`);

    // Objects that exist right now (e.g. created by an earlier provisioning step).
    await admin.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${appRole}`);
    await admin.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${appRole}`);
    await admin.query(`GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO ${appRole}`);

    // Objects created LATER. Migrations run as the admin role, so without these
    // default privileges every table a migration creates would again be
    // inaccessible to the application - the same silent breakage as before.
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${appRole}`
    );
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${appRole}`
    );
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO ${appRole}`
    );
  } finally {
    await admin.end();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (invokedDirectly) {
  const runtimeUrl = process.env.DATABASE_URL ?? "postgres://nexora:nexora@localhost:5432/nexora_dev";
  runMigrations(adminUrlFor(runtimeUrl))
    .then((executed) => {
      // eslint-disable-next-line no-console -- CLI entry point
      console.log(executed.length ? `applied ${executed.length} migration(s)` : "already up to date");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
