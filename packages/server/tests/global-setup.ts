import { config } from "dotenv";
import pg from "pg";

/**
 * Vitest global setup.
 *
 * ISS-007 FIX - test data no longer shares a database with verification journeys.
 *
 * Previously every suite pointed at `nexora_test`, the SAME database the
 * end-to-end journeys use. `tests/fixtures.ts` runs
 * `TRUNCATE TABLE companies CASCADE`, so any test run destroyed all journey
 * state, making evidence order-dependent and letting a regression run invalidate
 * the very evidence the journeys had produced.
 *
 * The automated suites now get their OWN database. Journeys keep `nexora_test`.
 * A test run can therefore no longer destroy verification evidence.
 */
const TEST_DB = process.env.UNIT_TEST_DATABASE ?? "nexora_unittest";

export async function setup(): Promise<void> {
  config({ path: new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") });

  process.env.NODE_ENV ??= "test";

  const adminUrl =
    process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:nexora-dev@localhost:5432/postgres";

  // The suites must run as the APPLICATION role, never as the migration
  // superuser. A superuser BYPASSES RLS (and holds BYPASSRLS), so pointing the
  // app at `postgres` would silently disable the very isolation
  // rls-isolation.test.ts exists to prove.
  const appUrl = process.env.APP_DATABASE_URL ?? `postgres://nexora:nexora@localhost:5432/${TEST_DB}`;
  const appDbUrl = new URL(appUrl);
  appDbUrl.pathname = `/${TEST_DB}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB]);
    if (exists.rowCount === 0) {
      // Identifier cannot be parameterised; TEST_DB is a trusted, code-owned value.
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
      // eslint-disable-next-line no-console -- setup diagnostics
      console.log(`[vitest] created isolated test database ${TEST_DB}`);
    }
  } finally {
    await admin.end();
  }

  // Publish the target BEFORE importing anything that builds a Pool.
  // `src/db/pool.ts` constructs its Pool at module load from
  // process.env.DATABASE_URL. `.env` (and _verify.cmd) both point that variable
  // at `nexora_test`, so importing first would permanently bind the running
  // application - and the TRUNCATE in tests/fixtures.ts - to the journey
  // database. Setting it afterwards is silently too late.
  process.env.DATABASE_URL = appDbUrl.toString();
  // Keep the admin URL out of the way so no module mistakes it for the app DB.
  process.env.ADMIN_DATABASE_URL = adminUrl;

  // Prepare the schema AND the application role's privileges in one step.
  // resetDatabase() drops/recreates the schema and re-grants table, sequence and
  // default privileges to the application role, so every table a migration
  // creates afterwards is genuinely usable by the app while still obeying RLS.
  const { resetDatabase, runMigrations, adminUrlFor } = await import("../src/db/migrate");
  await resetDatabase(adminUrlFor(appDbUrl.toString()));
  await runMigrations(adminUrlFor(appDbUrl.toString()));
}
