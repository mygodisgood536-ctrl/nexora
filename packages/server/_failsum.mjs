// Summarises a vitest JSON artifact: lists failing suites/tests with the first
// lines of each assertion message, so a RED verdict can be triaged directly.
import fs from "node:fs";

const file =
  process.argv[2] ??
  "C:\\Users\\adede\\.cline\\data\\workspaces\\chat\\nexora-restored\\packages\\server\\_probe_out_suite.json";
const j = JSON.parse(fs.readFileSync(file, "utf8"));

console.log(
  `TOTAL suites=${j.numTotalTestSuites} tests=${j.numTotalTests} passed=${j.numPassedTests} failed=${j.numFailedTests}`
);

const byFile = new Map();
for (const suite of j.testResults ?? []) {
  const name = (suite.name ?? "").split(/[\\/]/).pop();
  for (const a of suite.assertionResults ?? []) {
    if (a.status === "failed") {
      if (!byFile.has(name)) byFile.set(name, []);
      byFile.get(name).push(a);
    }
  }
}

let n = 0;
for (const [file_, asserts] of [...byFile.entries()].sort()) {
  console.log(`\n### ${file_.replace(/\.test\.ts$/, "")}  (${asserts.length} failed)`);
  for (const a of asserts) {
    n++;
    console.log(`  - ${a.fullName ?? a.title}`);
    const msg = (a.failureMessages ?? []).join(" ").split("\n").filter(Boolean);
    for (const line of msg.slice(0, 3)) console.log(`      ${line.trim().slice(0, 220)}`);
  }
}
console.log(`\nFAILED_ASSERTIONS_LISTED=${n}`);