import fs from "node:fs";
const c = fs.readFileSync("src/modules/customers/routes.ts", "utf8");
const out = [];
// find every z.object schema definition name in this file
const names = [...c.matchAll(/const (\w*Schema\w*) = z\.object\(\{/g)].map((m) => m[1]);
out.push("SCHEMAS: " + names.join(", "));
for (const n of names) {
  const i = c.indexOf(`const ${n} = z.object({`);
  const seg = c.slice(i, i + 1100);
  if (/customerCode|firstName/.test(seg)) {
    out.push("");
    out.push(`--- ${n} ---`);
    out.push(seg.replace(/\s+/g, " ").slice(0, 1000));
  }
}
const pc = c.indexOf('customersRouter.post(\n  "/"');
if (pc < 0) {
  const i2 = c.indexOf('customersRouter.post("') >= 0 ? c.indexOf('customersRouter.post("') : c.indexOf("customersRouter.post(");
  out.push("");
  out.push("--- customer POST route ---");
  out.push(c.slice(i2, i2 + 700).replace(/\s+/g, " "));
}
fs.writeFileSync("../../_probe_out/schemas4.txt", out.join("\n"));