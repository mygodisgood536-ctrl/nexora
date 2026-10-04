// ISS-006 / Phase 1 privilege diagnosis (superuser view).
// Confirms: (a) tenant data intact, (b) whether the `nexora` application role has
// the table privileges it needs, (c) whether resetDatabase()'s schema-only GRANT
// would leave the app unable to write.
import pg from "pg";

const URL = "postgres://postgres:nexora-dev@localhost:5432/nexora_test";
const admin = new pg.Client({ connectionString: URL });
await admin.connect();

console.log("=== tenant data intact? (superuser) ===");
for (const t of ["companies", "users", "branches", "roles", "role_permissions", "customers"]) {
  const r = await admin.query(`SELECT count(*)::int n FROM ${t}`);
  console.log(`  ${t.padEnd(20)} ${r.rows[0].n}`);
}

console.log("\n=== table owners (pg_tables) ===");
const owners = await admin.query(
  `SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public'
    AND tablename IN ('companies','users','roles','_migrations') ORDER BY tablename`
);
for (const r of owners.rows) console.log(`  ${r.tablename.padEnd(14)} owner=${r.tableowner}`);

console.log("\n=== table-level privileges granted to 'nexora' ===");
const tg = await admin.query(
  `SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) p
     FROM information_schema.table_privileges
    WHERE grantee='nexora' AND table_schema='public'
    GROUP BY table_name ORDER BY table_name`
);
if (tg.rowCount === 0) console.log("  (NONE - nexora has no table privileges at all)");
for (const r of tg.rows) console.log(`  ${r.table_name.padEnd(22)} ${r.p}`);

console.log("\n=== schema acl for 'public' ===");
const sc = await admin.query(`SELECT nspacl::text acl FROM pg_namespace WHERE nspname='public'`);
console.log("  " + (sc.rows[0]?.acl ?? "(default)"));

console.log("\n=== EMPIRICAL: can the app role actually write? ===");
const app = new pg.Client({ connectionString: "postgres://nexora:nexora@localhost:5432/nexora_test" });
try {
  await app.connect();
  const s = await app.query("SELECT count(*)::int n FROM companies");
  console.log(`  nexora SELECT companies -> ${s.rows[0].n}`);
  const probeName = "PrivProbe " + Date.now();
  try {
    await app.query(
      "INSERT INTO companies (name, code_prefix, slug, status) VALUES ($1,$2,$3,'active')",
      [probeName, "PP" + String(Date.now()).slice(-4), "pp-" + Date.now()]
    );
    console.log("  nexora INSERT companies -> OK");
    await app.query("DELETE FROM companies WHERE name=$1", [probeName]);
  } catch (e) {
    console.log(`  nexora INSERT companies -> DENIED (${e.code}) ${e.message.slice(0, 90)}`);
  }
} catch (e) {
  console.log(`  nexora connect failed: ${e.message}`);
} finally {
  await app.end().catch(() => {});
}

await admin.end();