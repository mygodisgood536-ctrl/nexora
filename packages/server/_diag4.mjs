import fs from "node:fs";
const out = [];
// C.O. permission bundle
const m = fs.readFileSync("src/db/migrations/0016_role_permission_bundles.sql", "utf8");
const i = m.indexOf("collection_officer");
out.push("C.O. BUNDLE (0016):");
out.push(m.slice(Math.max(0, i - 200), i + 900).replace(/\s+/g, " "));
// customer-assignments routes (the C.O.'s own assignment surface)
const p = fs.readFileSync("src/modules/performance/routes.ts", "utf8");
out.push("");
out.push("assignmentsRouter routes:");
out.push((p.match(/assignmentsRouter\.(get|post|patch|delete)\(\s*"[^"]*"/g) || []).join(" | "));
const k = p.indexOf("assignmentsRouter.post");
out.push("");
out.push("first assignments POST:");
out.push(p.slice(k, k + 500).replace(/\s+/g, " "));
fs.writeFileSync("../../_probe_out/diag4.txt", out.join("\n"));