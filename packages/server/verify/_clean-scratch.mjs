// Removes ABANDONED scratch databases left by earlier aborted proof runs.
// Only ever touches names beginning with the scratch prefix - never a real
// database - and terminates only backends attached to those scratch databases.
import pg from "pg";

const ADMIN =
  process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:nexora-dev@localhost:5432/postgres";
const PREFIX = "nexora_scratch_iss008";
const PROTECTED = new Set(["nexora_test", "nexora_dev", "nexora_unittest", "postgres", "template1"]);

const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 15_000 });
await c.connect();

const { rows } = await c.query(
  "SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname",
  [`${PREFIX}%`]
);

if (rows.length === 0) console.log("no abandoned scratch databases found");

for (const { datname } of rows) {
  if (PROTECTED.has(datname)) {
    console.log(`REFUSING to drop protected database ${datname}`);
    continue;
  }
  const killed = await c.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()",
    [datname]
  );
  await c.query(`DROP DATABASE IF EXISTS "${datname}"`);
  console.log(`dropped ${datname} (terminated ${killed.rowCount} backend(s))`);
}

await c.end();
console.log("scratch cleanup complete");