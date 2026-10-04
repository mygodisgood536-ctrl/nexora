import fs from "node:fs";
const out = [];
// 1. the real accounting/journal route
const a = fs.readFileSync("src/modules/accounting/routes.ts", "utf8");
out.push("ACCOUNTING ROUTES:");
out.push((a.match(/accountingRouter\.(get|post)\(\s*"[^"]*"/g) || []).join(" | "));
// 2. group member route permissions
const g = fs.readFileSync("src/modules/groups/routes.ts", "utf8");
const i = g.indexOf("/:id/members");
out.push("");
out.push("GROUP MEMBER POST ROUTE:");
out.push(g.slice(Math.max(0, i - 60), i + 420).replace(/\s+/g, " "));
// 3. what permissions does collection_officer's bundle grant?
out.push("");
const b = fs.readFileSync("../../packages/shared/src/roles.ts", "utf8");
const j = b.indexOf("collection_officer");
out.push("CO BUNDLE:");
out.push(b.slice(j, j + 700).replace(/\s+/g, " "));
fs.writeFileSync("../../_probe_out/diag3.txt", out.join("\n"));