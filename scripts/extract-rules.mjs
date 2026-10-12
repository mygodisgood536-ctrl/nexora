import { readFileSync, writeFileSync } from "node:fs";

const txt = readFileSync("docs/verification/VISION-v3.9-AUTHORITY.txt", "utf8");
const lines = txt.split(/\r?\n/);

const rules = [];
const re = /^(RULE|Rule)\s+(\d+(?:\.\d+)+)\s*[—-]\s*(.*)$/;

lines.forEach((raw, i) => {
  const line = raw.replace(/^\t+/, "").trim();
  const m = re.exec(line);
  if (m) {
    rules.push({
      id: m[2],
      kind: "RULE",
      text: m[3].trim(),
      line: i + 1,
      part: currentPart(i),
    });
  }
});

// Part boundaries
function currentPart(idx) {
  for (let j = idx; j >= 0; j--) {
    const l = lines[j].trim();
    const pm = /^PART\s+(\d+)/.exec(l);
    if (pm) return Number(pm[1]);
  }
  return 0;
}

// Prohibitions in Part 15
const p15 = [];
{
  const start = lines.findIndex((l) => /^PART 15/.test(l.trim()));
  const end = lines.findIndex((l) => /^PART 16/.test(l.trim()));
  for (let i = start; i >= 0 && i < end; i++) {
    const l = lines[i].replace(/^\t+/, "").trim();
    if (/^#?\s*\d{1,2}\s*[.)]\s+/.test(l) && l.length > 30) p15.push({ line: i + 1, text: l });
  }
}

const parts = [];
lines.forEach((l, i) => {
  const m = /^PART\s+(\d+)\s*[—-]\s*(.*)$/.exec(l.trim());
  if (m) parts.push({ part: Number(m[1]), title: m[2].trim(), line: i + 1 });
});

const byPart = {};
for (const r of rules) {
  byPart[r.part] = (byPart[r.part] || 0) + 1;
}

writeFileSync(
  "docs/verification/vision-rules.json",
  JSON.stringify({ total: rules.length, byPart, parts, rules, prohibitions: p15 }, null, 2),
  "utf8"
);

console.log("TOTAL RULES:", rules.length);
console.log("PER PART:", JSON.stringify(byPart));
console.log("PROHIBITIONS:", p15.length);