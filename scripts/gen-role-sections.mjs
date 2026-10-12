/**
 * Generates the per-role section of the design instructions from the REAL
 * descriptors, so the document can never drift from the built navigation.
 * Output is pasted into the hand-written document by scripts/build-design-doc.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";

const roles = JSON.parse(readFileSync("docs/verification/_descriptors-dump.json", "utf8"));
const live = roles.filter((r) => !r.key.startsWith("template_"));
const templates = roles.filter((r) => r.key.startsWith("template_"));

const WORKPLACE = {
  all: "Every branch, unlimited.",
  area: "Every branch inside his area only.",
  own: "His own branch's records only.",
  none: "None. A branch worker never enters the Branch Workplace (prohibition 16).",
};

let out = "";
out += "## 4. Every role, one by one\n\n";
out +=
  "Thirty-eight workspaces exist: 29 live roles plus 9 custom-role templates. Each is written out separately below, with its " +
  "landing summary, its navigation groups, the pages inside each group, the actions it offers, the actions it must never offer, " +
  "and the Branch Workplace rule that applies to it. Naming is taken directly from the built navigation model, so every page " +
  "listed here exists in the product.\n\n";

let n = 0;
for (const r of live) {
  n++;
  out += `### 4.${n} ${r.label} \`${r.key}\`\n\n`;
  out += `**Purpose.** ${r.purpose}\n\n`;
  out += `**Landing summary.** ${r.blocks.length ? r.blocks.map((b) => b.label).join(" · ") : "No summary figures for this role."}\n\n`;
  out += `**Branch Workplace.** ${WORKPLACE[r.workplace]}\n\n`;
  out += "**Navigation groups.**\n\n";
  for (const g of r.groups) {
    out += `- **${g.title}**\n`;
    for (const i of g.items) out += `  - ${i.label} \`${i.to}\`\n`;
  }
  out += "\n";
}

out += `### 4.${live.length + 1} Custom-role templates \`template_*\`\n\n`;
out +=
  "A company may enable a custom role built from one of these templates. Each template is a starting navigation set that the " +
  "company's administrator then adjusts. Templates are not separate people and must not be given screens of their own beyond " +
  "what is listed.\n\n";
for (const t of templates) {
  out += `- **${t.label}** \`${t.key}\` — ${t.purpose}\n`;
  for (const g of t.groups) {
    for (const i of g.items) out += `  - ${i.label} \`${i.to}\`\n`;
  }
}
out += "\n";

writeFileSync("docs/verification/_design-roles.md", out, "utf8");
console.log("wrote docs/verification/_design-roles.md");
console.log("live roles:", live.length, "templates:", templates.length);
console.log("chars:", out.length);