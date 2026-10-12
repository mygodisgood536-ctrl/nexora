const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "packages", "server", "src", "modules");
const mods = process.argv.slice(2);
for (const m of mods) {
  const f = path.join(dir, m, "routes.ts");
  if (!fs.existsSync(f)) { console.log("NO", m); continue; }
  const t = fs.readFileSync(f, "utf8");
  console.log("==== " + m + " ====");
  const re = /\.(get|post|put|patch|delete)\(\s*["']([^"']*)["']/g;
  let x;
  while ((x = re.exec(t))) console.log("  " + x[1].toUpperCase() + " " + x[2]);
}
