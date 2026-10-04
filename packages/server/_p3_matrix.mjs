// Phase 3 PREPARE: dump the LIVE permission matrix from PostgreSQL.
// This is the "actual database evidence" half of the permission reference; the
// Vision's Can/Cannot text is the other half. Comparing them is Phase 3's job.
import pg from "pg";

const c = new pg.Client({ connectionString: "postgres://nexora:nexora@localhost:5432/nexora_test" });
await c.connect();

const roles = await c.query(
  `SELECT r.role_key, r.name, r.category, r.is_system,
          count(rp.verb) AS verb_count
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
    GROUP BY r.role_key, r.name, r.category, r.is_system
    ORDER BY r.role_key`
);
console.log("=== LIVE ROLES (from DB) ===");
for (const r of roles.rows) {
  console.log(`  ${r.role_key.padEnd(24)} ${String(r.verb_count).padStart(3)} verbs  [${r.category}] sys=${r.is_system}`);
}

console.log("\n=== DISTINCT ROLE KEYS (deduped) ===");
const keys = await c.query(`SELECT DISTINCT role_key FROM roles ORDER BY role_key`);
console.log("  " + keys.rows.map((v) => v.role_key).join(", "));

console.log("\n=== VERBS PER ROLE (live role_permissions) ===");
const perms = await c.query(
  `SELECT r.role_key, rp.verb
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
    ORDER BY r.role_key, rp.verb`
);
const byRole = new Map();
for (const p of perms.rows) {
  if (!byRole.has(p.role_key)) byRole.set(p.role_key, new Set());
  byRole.get(p.role_key).add(p.verb);
}
for (const [k, v] of byRole) console.log(`  ${k} -> ${[...v].join(", ")}`);

console.log("\n=== PLATFORM BUNDLES (the catalogue every new company inherits) ===");
const bundles = await c.query(
  `SELECT role_key, verb FROM platform_role_permission_bundles ORDER BY role_key, verb`
);
const byBundle = new Map();
for (const b of bundles.rows) {
  if (!byBundle.has(b.role_key)) byBundle.set(b.role_key, []);
  byBundle.get(b.role_key).push(b.verb);
}
for (const [k, v] of byBundle) console.log(`  ${k} -> ${v.join(", ")}`);

console.log("\n=== FULL VERB VOCABULARY (platform-wide) ===");
const verbs = await c.query(`SELECT DISTINCT verb FROM platform_role_permission_bundles ORDER BY verb`);
console.log("  " + verbs.rows.map((v) => v.verb).join(", "));

await c.end();