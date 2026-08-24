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

export async function resetDatabase(adminDatabaseUrl: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    await admin.query("DROP SCHEMA public CASCADE");
    await admin.query("CREATE SCHEMA public");
    await admin.query("GRANT USAGE ON SCHEMA public TO nexora");
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
