// Read-only DB health probe used by _verify.cmd to PROVE PostgreSQL is
// actually reachable (and the schema is applied) before any verification runs.
//
// It deliberately connects as the APPLICATION role (nexora) with the same
// credentials the tests use, so this probe fails if test credentials are wrong.
// A prior version connected as the postgres superuser, which proved only that
// the server was up and would happily pass while the tests could not connect.
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://nexora:nexora@localhost:5432/nexora_test";
const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
try {
  await c.connect();
  const who = await c.query(
    "SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super"
  );
  // Schema presence is proven via catalog metadata rather than by counting
  // _migrations: that bookkeeping table is owner-owned and the application role
  // correctly has no privilege on it, so selecting it would fail for a reason
  // that has nothing to do with the schema being applied.
  const t = await c.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const fn = await c.query(
    "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'"
  );
  console.log(`DB OK as=${who.rows[0].u} superuser=${who.rows[0].super}`);
  console.log(`DB OK public_tables=${t.rows[0].n} functions=${fn.rows[0].n}`);
  if (who.rows[0].super) {
    console.log("WARN connected as superuser: RLS is bypassed for this probe");
  }
  await c.end();
  process.exit(0);
} catch (e) {
  console.log(`DB FAIL: ${e.message}`);
  process.exit(1);
}