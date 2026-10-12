import { readFileSync, writeFileSync } from "node:fs";

/* Reads the built descriptors so the design document can never drift from the
   real navigation model. */
const desc = readFileSync("packages/web/src/workspaces/descriptors.ts", "utf8");

const start = desc.indexOf("export const WORKSPACES");
const body = desc.slice(start);

const roles = [];
const re = /^\s{2}([a-z_]+):\s*\{\s*$/gm;
let m;
const keys = [];
while ((m = re.exec(body)) !== null) keys.push({ key: m[1], idx: m.index });

for (let i = 0; i < keys.length; i++) {
  const chunk = body.slice(keys[i].idx, i + 1 < keys.length ? keys[i + 1].idx : body.length);
  const label = /label:\s*"([^"]+)"/.exec(chunk)?.[1] ?? keys[i].key;
  const purpose = /purpose:\s*"([^"]+)"/.exec(chunk)?.[1] ?? "";
  const workplace = /workplace:\s*"(all|area|own|none)"/.exec(chunk)?.[1] ?? "none";
  const blocks = [...chunk.matchAll(/\{ label: "([^"]+)", metric: "([^"]+)" \}/g)].map((b) => ({
    label: b[1],
    metric: b[2]
  }));
  const groups = [...chunk.matchAll(/G\("([a-z_]+)",\s*"([^"]+)",\s*\[([\s\S]*?)\]\)/g)].map((g) => {
    const items = [...g[3].matchAll(/\["([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\]/g)].map((i) => ({
      to: i[1],
      label: i[2],
      icon: i[3]
    }));
    return { key: g[1], title: g[2], items };
  });
  roles.push({ key: keys[i].key, label, purpose, workplace, blocks, groups });
}

writeFileSync("docs/verification/_descriptors-dump.json", JSON.stringify(roles, null, 2), "utf8");
console.log("roles parsed:", roles.length);
for (const r of roles) {
  const pages = r.groups.reduce((n, g) => n + g.items.length, 0);
  console.log(`  ${r.key.padEnd(38)} ${String(r.groups.length).padStart(2)} groups  ${String(pages).padStart(2)} pages  workplace=${r.workplace}`);
}