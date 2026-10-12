import { readFileSync, writeFileSync } from "node:fs";

const part1 = readFileSync("docs/DESIGN-INSTRUCTIONS.part1.md", "utf8");
const roles = readFileSync("docs/verification/_design-roles.md", "utf8");

if (!part1.includes("<!-- ROLE SECTIONS INSERTED HERE (generated from the built descriptors) -->")) {
  throw new Error("role-section marker not found in part1");
}

const merged = part1.replace(
  "<!-- ROLE SECTIONS INSERTED HERE (generated from the built descriptors) -->",
  roles.trim()
);

writeFileSync("docs/DESIGN-INSTRUCTIONS.part1.md", merged, "utf8");
console.log("merged. total chars:", merged.length);
console.log("role subsections:", (merged.match(/^### 4\.\d+/gm) ?? []).length);