import { readFileSync } from "node:fs";

/* Routes declared in App.tsx */
const appSrc = readFileSync("packages/web/src/App.tsx", "utf8");
const routes = new Set();
for (const m of appSrc.matchAll(/<Route\s+path="([^"]+)"/g)) routes.add(m[1]);

/* Every nav target in every descriptor + command palette */
const desc = readFileSync("packages/web/src/workspaces/descriptors.ts", "utf8");
const targets = new Map(); // route -> [labels]
const linkRe = /\["(\/[^"]*)",\s*"([^"]+)"/g;
for (const m of desc.matchAll(linkRe)) {
  const route = m[1];
  const list = targets.get(route) ?? [];
  list.push(m[2]);
  targets.set(route, list);
}

/* Dynamic routes in descriptors, e.g. /capability/:key */
const dynamic = new Set();
for (const r of targets.keys()) {
  const base = r.split("/").filter(Boolean)[0];
  if (base && [...routes].some((rr) => rr === "/" + base || rr.startsWith("/" + base + "/"))) {
    if (!routes.has(r)) dynamic.add(r);
  }
}

console.log("=== ROUTES DECLARED (" + routes.size + ") ===");
[...routes].sort().forEach((r) => console.log("  " + r));

console.log("\n=== NAV TARGETS (" + targets.size + ") ===");
const dead = [];
for (const [route, labels] of [...targets.entries()].sort()) {
  const ok = routes.has(route);
  const isDynamic = dynamic.has(route);
  if (!ok && !isDynamic) dead.push([route, labels]);
  console.log(`  ${ok || isDynamic ? "OK  " : "DEAD"} ${route}  (${labels.length} link${labels.length === 1 ? "" : "s"})`);
}

console.log("\n=== DEAD NAV TARGETS (" + dead.length + ") ===");
for (const [route, labels] of dead) console.log(`  ${route}  <- ${labels.join(", ")}`);

/* Unreachable routes (declared but nothing links to them) */
console.log("\n=== ROUTES WITH NO NAV LINK ===");
const linkedExact = new Set([...targets.keys()].filter((t) => routes.has(t)));
for (const r of [...routes].sort()) {
  if (!linkedExact.has(r)) console.log("  " + r);
}