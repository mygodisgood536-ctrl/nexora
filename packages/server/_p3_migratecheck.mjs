// Does src/db/migrate.ts DESTROY existing data?
// Phase 3 found nexora_test completely empty (companies/users/roles/customers = 0)
// immediately after runs that had reported real data. The only thing _verify.cmd
// does before every journey is `tsx src/db/migrate.ts`. This proves or disproves
// that migrate is the destructive step.
//
// Method: write a marker row, run migrate, check whether the marker survived.
import { spawnSync } from "node:child_process";
import pg from "pg";

const URL = "postgres://nexora:nexora@localhost:5432/nexora_test";
const c = new pg.Client({ connectionString: URL });
await c.connect();

const marker = "MIGRATE_DESTRUCTION_PROBE_" + Date.now();
await c.query("DELETE FROM companies WHERE name=$1", [marker]);
const ins = await c.query(
  "INSERT INTO companies (name, code_prefix, slug, status) VALUES ($1,$2,$3,'active') RETURNING id",
  [marker, "MDP", "mdp-" + Date.now()]
);
console.log(`marker inserted: ${marker} id=${ins.rows[0].id}`);

let before = 0;
{
  const r = await c.query("SELECT count(*)::int n FROM companies");
  before = r.rows[0].n;
}
console.log(`companies BEFORE migrate: ${before}`);

const m = spawnSync("npx", ["tsx", "src/db/migrate.ts"], {
  encoding: "utf8", timeout: 180000, shell: true
});
console.log(`migrate exit=${m.status} :: ${(m.stdout || "").trim()} ${(m.stderr || "").trim().slice(0, 200)}`);

let after = 0;
let survived = 0;
{
  const r = await c.query("SELECT count(*)::int n FROM companies");
  after = r.rows[0].n;
  const s = await c.query("SELECT count(*)::int n FROM companies WHERE name=$1", [marker]);
  survived = s.rows[0].n;
}
console.log(`companies AFTER  migrate: ${after}`);
console.log(`MARKER SURVIVED: ${survived === 1 ? "YES - migrate is non-destructive" : "NO - MIGRATE DESTROYS DATA"}`);

await c.query("DELETE FROM companies WHERE name=$1", [marker]);
await c.end();