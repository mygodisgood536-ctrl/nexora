import fs from "node:fs";
const s = fs.readFileSync("src/modules/workers/service.ts", "utf8");
const out = [];
const i = s.indexOf("single_branch scope requires");
out.push("SCOPE VALIDATION:");
out.push(s.slice(Math.max(0, i - 900), i + 200).replace(/\s+/g, " "));
// What does createWorker return?
const j = s.indexOf("export async function createWorker");
out.push("");
out.push("createWorker signature/return:");
out.push(s.slice(j, j + 900).replace(/\s+/g, " "));
const k = s.indexOf("initial_password", j);
out.push("");
out.push("around initial_password:");
out.push(s.slice(Math.max(j, k - 700), k + 500).replace(/\s+/g, " "));
fs.writeFileSync("../../_probe_out/workersvc.txt", out.join("\n"));