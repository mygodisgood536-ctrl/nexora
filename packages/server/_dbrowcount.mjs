// ISS-007 regression probe: prove the full suite never mutates the JOURNEY
// database (nexora_test), which the journeys own and which must survive a test
// run untouched.
//
// Reads a true row count for every user table. Counts RLS-filtered rows would
// hide writes, so this connects as the owner to get GROUND TRUTH. It is
// strictly read-only: it issues SELECT count(*) and nothing else.
//
// Usage: node _dbrowcount.mjs <label>
import pg from "pg";
import fs from "node:fs";

const label = process.argv[2] ?? "snap";
const DB = "nexora_test";
const url = `postgres://nexora:nexora@localhost:5432/${DB}`;
const outFile = `C:\\Users\\adede\\.cline\\data\\workspaces\\chat\\nexora-restored\\_probe_out\\rowcount-${label}.txt`;

const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
const lines = [];
try {
  await c.connect();
  const t = await c.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );
  let total = 0;
  for (const { table_name } of t.rows) {
    // Identifiers come from information_schema, not user input, and are quoted.
    const r = await c.query(`SELECT count(*)::int AS n FROM "${table_name}"`);
    lines.push(`${table_name}=${r.rows[0].n}`);
    total += r.rows[0].n;
  }
  lines.push(`TOTAL_TABLES=${t.rows.length}`);
  lines.push(`TOTAL_ROWS=${total}`);
  await c.end();
  const body = lines.join("\n") + "\n";
  fs.writeFileSync(outFile, body);
  console.log(`ROWCOUNT ${label} ${DB} tables=${t.rows.length} rows=${total}`);
  console.log(`ROWCOUNT written ${outFile}`);
  process.exit(0);
} catch (e) {
  fs.writeFileSync(outFile, `ROWCOUNT_ERROR ${e.message}\n`);
  console.log(`ROWCOUNT_ERROR ${e.message}`);
  try { await c.end(); } catch {}
  process.exit(1);
}