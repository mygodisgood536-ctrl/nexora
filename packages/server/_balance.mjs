// Reports the brace/paren balance of a TS file so structural errors can be
// found precisely instead of guessed at.
import fs from "node:fs";

const p = process.argv[2] ?? "verify/journey2.ts";
const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);

let depth = 0;
const opens = [];
lines.forEach((line, i) => {
  const before = depth;
  // Strip strings/comments crudely but well enough for this diagnostic.
  const clean = line
    .replace(/\/\/.*$/, "")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  for (const ch of clean) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  if (before !== depth) {
    opens.push(`${String(i + 1).padStart(4)} d=${String(depth).padStart(3)}  ${line.trim().slice(0, 88)}`);
  }
});
console.log("FINAL DEPTH:", depth, depth === 0 ? "(balanced)" : "(UNBALANCED)");
console.log("\nLast 25 depth changes:");
console.log(opens.slice(-25).join("\n"));