// Decisive check for a Phase 3 anomaly: `roles` / `role_permissions` read empty
// from nexora_test, yet role logins succeeded minutes earlier and those logins
// resolve permissions from role_permissions. Establish the real state.
import pg from "pg";

const URL = "postgres://nexora:nexora@localhost:5432/nexora_test";
const c = new pg.Client({ connectionString: URL });
await c.connect();

const who = await c.query("SELECT current_database() d, current_user u");
console.log(`connected: db=${who.rows[0].d} user=${who.rows[0].u}`);

for (const t of ["companies", "users", "branches", "roles", "role_permissions", "platform_role_permission_bundles", "customers"]) {
  const r = await c.query(`SELECT count(*)::int n FROM ${t}`);
  console.log(`  ${t.padEnd(38)} ${r.rows[0].n}`);
}

const mig = await c.query("SELECT count(*)::int n FROM _migrations");
console.log(`  _migrations${" ".repeat(26)} ${mig.rows[0].n}`);

// Which company owns the most recently created company? Its roles should exist.
const last = await c.query(
  "SELECT id, name, status, created_at FROM companies ORDER BY created_at DESC LIMIT 3"
);
console.log("\nmost recent companies:");
for (const r of last.rows) console.log(`  ${r.created_at?.toISOString?.() ?? r.created_at}  ${r.status}  ${r.name}`);

if (last.rows[0]) {
  const forCo = await c.query("SELECT count(*)::int n FROM roles WHERE company_id=$1", [last.rows[0].id]);
  console.log(`\nroles for newest company (${last.rows[0].id}): ${forCo.rows[0].n}`);
}

await c.end();