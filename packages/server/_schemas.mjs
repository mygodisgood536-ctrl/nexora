// Extracts the request schemas the role journey needs. Read-only.
import fs from "node:fs";
const out = [];
const p = (s, n = 1400) => s.replace(/\s+/g, " ").slice(0, n);

const w = fs.readFileSync("src/modules/workers/routes.ts", "utf8");
const i = w.indexOf("const createWorkerSchema");
out.push("=== WORKER CREATE ===");
out.push(i < 0 ? "NOT FOUND" : p(w.slice(i, i + 1500)));
out.push("");
out.push("WORKER ROUTES: " + (w.match(/workersRouter\.(post|get|patch|put|delete)\(\s*"[^"]*"/g) || []).join(" | "));

const c = fs.readFileSync("src/modules/customers/routes.ts", "utf8");
const cp = c.indexOf('customersRouter.post(\n  "/"');
out.push("");
out.push("=== CUSTOMER CREATE ROUTE ===");
out.push(p(c.slice(cp, cp + 800)));
const cs = c.indexOf("Schema = z.object");
out.push("");
out.push("=== CUSTOMER SCHEMAS ===");
out.push(p(c.slice(cs, cs + 1200)));

const g = fs.readFileSync("src/modules/groups/routes.ts", "utf8");
out.push("");
out.push("GROUP ROUTES: " + (g.match(/groupsRouter\.(post|get|patch|delete)\(\s*"[^"]*"/g) || []).join(" | "));
const gm = g.match(/members?[^"]*/gi);
out.push("GROUP member-ish tokens: " + (gm ? [...new Set(gm)].slice(0, 12).join(", ") : "none"));

const b = fs.readFileSync("src/modules/branches/routes.ts", "utf8");
out.push("");
out.push("BRANCH ROUTES: " + (b.match(/branchesRouter\.(post|get|patch|delete)\(\s*"[^"]*"/g) || []).join(" | "));

fs.writeFileSync("../../_probe_out/schemas3.txt", out.join("\n"));