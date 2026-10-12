import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = "packages/web/src";
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) files.push(p);
  }
})(dir);

const findings = [];

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const lines = src.split(/\r?\n/);

  lines.forEach((line, i) => {
    // Button-ish elements with no handler on the same or next 3 lines
    if (/<(button|Button)\b/.test(line)) {
      const window = lines.slice(i, i + 4).join(" ");
      const hasHandler = /onClick=|onChange=|onSubmit=|disabled=|to=|type="submit"|href=/.test(window);
      if (!hasHandler) {
        findings.push({ file: f, line: i + 1, kind: "control without handler", snippet: line.trim().slice(0, 100) });
      }
    }
    // Form without onSubmit
    if (/<form\b/.test(line) && !/onSubmit=/.test(src.slice(0, src.length).match(/<form[^>]*>/)?.[0] ?? "")) {
      findings.push({ file: f, line: i + 1, kind: "form without onSubmit", snippet: line.trim().slice(0, 100) });
    }
    // Clickable div/span (accessibility smell)
    if (/<(div|span)[^>]*onClick=/.test(line) && !/role=|tabIndex/.test(line)) {
      findings.push({ file: f, line: i + 1, kind: "clickable non-interactive element", snippet: line.trim().slice(0, 100) });
    }
    // img without alt
    if (/<img\b/.test(line) && !/alt=/.test(line)) {
      findings.push({ file: f, line: i + 1, kind: "img without alt", snippet: line.trim().slice(0, 100) });
    }
    // Placeholder TODO markers
    if (/\bTODO\b|\bFIXME\b|not implemented|coming soon|placeholder/i.test(line)) {
      findings.push({ file: f, line: i + 1, kind: "TODO/placeholder marker", snippet: line.trim().slice(0, 100) });
    }
    // href="#" dead link
    if (/href="#"/.test(line)) {
      findings.push({ file: f, line: i + 1, kind: "dead href=#", snippet: line.trim().slice(0, 100) });
    }
  });
}

const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);

console.log("=== DEAD-CONTROL / A11Y SCAN ===");
for (const [k, v] of Object.entries(byKind)) {
  console.log(`\n## ${k} (${v.length})`);
  for (const f of v.slice(0, 20)) console.log(`  ${f.file}:${f.line}  ${f.snippet}`);
}
console.log(`\nTOTAL: ${findings.length}`);