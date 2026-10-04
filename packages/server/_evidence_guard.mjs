// Evidence guard: a verification run is only honest if it PROVES its journeys ran.
//
// Why this exists: _go_roles.cmd reported EXITCODE=0 while never executing
// journey1 (ISS-003). A journey that crashes before writing its report, or that
// is silently skipped by its runner, both look identical to success.
//
// Two defences:
//   1. The caller deletes expected evidence files BEFORE the run, so a stale
//      report from a previous run cannot be mistaken for a fresh one.
//   2. After the run, every expected file must exist, be non-empty, and contain
//      the harness summary marker. Anything less exits non-zero.
//
// Usage: node _evidence_guard.mjs <file> [<file> ...]
//        MARKER can be overridden per file with  path=marker  syntax.
import fs from "node:fs";

const DEFAULT_MARKER = "total:";
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("EVIDENCE_GUARD: no evidence files declared");
  process.exit(2);
}

let failed = 0;

for (const spec of args) {
  const eq = spec.indexOf("=");
  const path = eq === -1 ? spec : spec.slice(0, eq);
  const marker = eq === -1 ? DEFAULT_MARKER : spec.slice(eq + 1);

  if (!fs.existsSync(path)) {
    console.error(`FAIL  evidence MISSING   ${path}`);
    failed++;
    continue;
  }

  const body = fs.readFileSync(path, "utf8");
  const bytes = Buffer.byteLength(body, "utf8");

  if (bytes === 0) {
    console.error(`FAIL  evidence EMPTY     ${path}`);
    failed++;
    continue;
  }

  if (!body.includes(marker)) {
    console.error(`FAIL  evidence UNMARKED  ${path} (no "${marker}")`);
    failed++;
    continue;
  }

  // The summary line proves the harness actually counted checks rather than
  // dying partway. Surface the counts so the evidence is readable at a glance.
  const summary = body.split(/\r?\n/).find((l) => l.includes(marker)) ?? "";
  console.log(`PASS  evidence OK        ${path} :: ${summary.trim()}`);
}

if (failed > 0) {
  console.error(`EVIDENCE_GUARD: ${failed}/${args.length} evidence file(s) failed`);
  process.exit(1);
}

console.log(`EVIDENCE_GUARD: all ${args.length} evidence file(s) verified`);
process.exit(0);