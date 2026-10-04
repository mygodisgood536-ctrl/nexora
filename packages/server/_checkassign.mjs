// Applies migrations and reports whether the Collection Officer role now holds
// the `assign` verb (the F-03 fix), for both the bundle and live companies.
import { spawnSync } from "node:child_process";
import pg from "pg";

const m = spawnSync("npx", ["tsx", "src/db/migrate.ts"], { encoding: "utf8", timeout: 180000, shell: true });
console.log("migrate exit:", m.status, (m.stdout || "").trim(), (m.stderr || "").trim().slice(0, 300));

const c = new pg.Client({ connectionString: "postgres://postgres:nexora-dev@localhost:5432/nexora_test" });
await c.connect();
const mig = await c.query("SELECT count(*)::int n FROM _migrations");
console.log("migrations:", mig.rows[0].n);
const has = await c.query(
  "SELECT count(*)::int n FROM _migrations WHERE filename='0082_collection_officer_group_management.sql'"
);
console.log("0082 applied:", has.rows[0].n === 1);
const bundle = await c.query(
  `SELECT count(*)::int n FROM platform_role_permission_bundles
    WHERE role_key='collection_officer' AND verb='assign'`
);
console.log("bundle assign rows:", bundle.rows[0].n);
const live = await c.query(
  `SELECT count(*)::int n FROM role_permissions rp
     JOIN roles r ON r.id = rp.role_id
    WHERE r.role_key='collection_officer' AND rp.verb='assign'`
);
console.log("live collection_officer roles with assign:", live.rows[0].n);
await c.end();