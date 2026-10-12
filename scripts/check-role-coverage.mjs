import { readFileSync } from "node:fs";

const shared = readFileSync("packages/shared/src/roles.ts", "utf8");
const keys = [...shared.matchAll(/\{ key: "([a-z_]+)", name:/g)].map((m) => m[1]);
const dump = JSON.parse(readFileSync("docs/verification/_descriptors-dump.json", "utf8"));
const have = new Set(dump.map((r) => r.key));

console.log("built-in roles:", keys.length);
console.log("workspace descriptors:", have.size);
const missing = keys.filter((k) => !have.has(k));
console.log("MISSING descriptor:", missing.length ? missing.join(", ") : "none");
const extra = [...have].filter((h) => !keys.includes(h) && !h.startsWith("template_"));
console.log("descriptors with no built-in role:", extra.length ? extra.join(", ") : "none");
console.log("template descriptors:", [...have].filter((h) => h.startsWith("template_")).length);