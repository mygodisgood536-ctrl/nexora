// Narrow, reliable search for destructive database operations in the server
// package only. The codebase-wide search is polluted by unrelated projects.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "C:/Users/adede/.cline/data/workspaces/chat/nexora-restored/packages/server";
const DIRS = ["src", "tests", "verify", "scripts"];
const PAT = /TRUNCATE|resetDatabase|DROP SCHEMA|DROP TABLE|DELETE FROM\s+\w+\s*(;|$)/;
const EXTS = new Set([".ts", ".mts", ".mjs", ".js"]);

const hits = [];
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p); continue; }
    const dot = p.lastIndexOf(".");
    if (dot === -1 || !EXTS.has(p.slice(dot))) continue;
    let body;
    try { body = readFileSync(p, "utf8"); } catch { continue; }
    body.split(/\r?\n/).forEach((line, i) => {
      if (PAT.test(line)) hits.push(`${relative(ROOT, p)}:${i + 1}  ${line.trim().slice(0, 130)}`);
    });
  }
}
for (const d of DIRS) walk(join(ROOT, d));

console.log(`=== destructive-op hits in packages/server (${DIRS.join(", ")}) ===`);
if (hits.length === 0) console.log("  (none)");
else hits.forEach((h) => console.log("  " + h));