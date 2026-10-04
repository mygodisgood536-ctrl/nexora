// Splices the hardened proof together: keep the header/helpers (everything
// before the old proveContexts marker), then the new tail, then main().
import { readFileSync, writeFileSync } from "node:fs";

const DIR = "C:/Users/adede/.cline/data/workspaces/chat/nexora-restored/packages/server/verify";
const target = `${DIR}/iss008-proof.ts`;
const src = readFileSync(target, "utf8");

const MARKER = "/** Proves the three security contexts the application actually uses. */";
const at = src.indexOf(MARKER);
if (at === -1) {
  console.error("marker not found - refusing to splice");
  process.exit(2);
}

const head = src.slice(0, at);
const tail1 = readFileSync(`${DIR}/_iss008-tail.ts.part`, "utf8");
const main1 = readFileSync(`${DIR}/_iss008-main.ts.part`, "utf8");

writeFileSync(target, `${head}\n${tail1}\n${main1}`, "utf8");
console.log("spliced iss008-proof.ts OK");
console.log("has marker:", readFileSync(target, "utf8").includes(MARKER) ? "yes" : "no");