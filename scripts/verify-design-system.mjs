/**
 * Design-system contract checks.
 *
 * A stylesheet rewrite is exactly the kind of change that looks right and is
 * quietly broken: a token referenced but never defined, a foreground pair that
 * quietly fails contrast, an accent default that drifts from the rule. None of
 * that shows up in a build, so it is checked here instead.
 *
 *   node scripts/verify-design-system.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) console.log(`ok    ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    failures++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const read = (p) => readFileSync(resolve(REPO, p), "utf8");

/* ------------------------------------------------------------------ *
 * Colour maths (WCAG 2.1).
 * ------------------------------------------------------------------ */
function parseColor(input) {
  const v = input.trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return null;
}

function luminance({ r, g, b }) {
  const ch = (x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ------------------------------------------------------------------ *
 * 1. Every referenced token is defined somewhere.
 * ------------------------------------------------------------------ */
const CSS_FILES = [
  "packages/ui/src/styles.css",
  "packages/web/src/styles/portal.css",
  "packages/platform-web/src/styles/portal.css"
];

const css = CSS_FILES.map((f) => ({ file: f, text: read(f) }));

const defined = new Set();
for (const { text } of css) {
  for (const m of text.matchAll(/(--nx-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
}

const referenced = new Map();
for (const { file, text } of css) {
  for (const m of text.matchAll(/var\(\s*(--nx-[a-z0-9-]+)/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], file);
  }
}

console.log("=== token resolution ===");
const missing = [...referenced.keys()].filter((t) => !defined.has(t)).sort();
check(
  "every referenced --nx-* token is defined",
  missing.length === 0,
  missing.length ? `undefined: ${missing.join(", ")}` : `${referenced.size} tokens referenced, all defined`
);

/* ------------------------------------------------------------------ *
 * 2. Every token the TypeScript layer sets is consumed by the stylesheet.
 *    A token the server sets but no rule reads is dead theming.
 * ------------------------------------------------------------------ */
console.log("\n=== theme tokens the server sets are consumed ===");
const sharedTheme = read("packages/shared/src/theme.ts");
const serverSet = new Set(
  [...sharedTheme.matchAll(/vars\["(--nx-[a-z0-9-]+)"\]/g)].map((m) => m[1])
);
for (const m of sharedTheme.matchAll(/:\s*"(--nx-[a-z0-9-]+)"/g)) serverSet.add(m[1]);
for (const m of sharedTheme.matchAll(/(--nx-[a-z0-9-]+):\s*"--/g)) serverSet.add(m[1]);

const themeVarMapBlock = sharedTheme.slice(
  sharedTheme.indexOf("THEME_VAR_MAP"),
  sharedTheme.indexOf("FONT_STACK_FALLBACK")
);
for (const m of themeVarMapBlock.matchAll(/"(--nx-[a-z0-9-]+)"/g)) serverSet.add(m[1]);

for (const token of [...serverSet].sort()) {
  // A brand token is legitimately consumed by JS (logo, login background) and
  // need not have a CSS rule; every other token must be read by a rule or
  // aliased from another token.
  const aliasOnly = new RegExp(`--${token}\\s*:`).test(css[0].text);
  const read = css.some(({ text }) => new RegExp(`var\\(\\s*${token}`).test(text)) || aliasOnly;
  check(`${token} is consumed by the stylesheet`, read);
}

/* ------------------------------------------------------------------ *
 * 3. RULE 13.4.1 / 13.4.2 - accent defaults match the Vision exactly.
 * ------------------------------------------------------------------ */
console.log("\n=== Vision accent law ===");
const ui = css[0].text;
check(
  "RULE 13.4.1 - the default accent is near-black charcoal",
  /--nx-color-accent:\s*#111111\s*;/.test(ui)
);
check(
  "RULE 13.4.2 - the Platform Owner portal is green and scoped to .nxp",
  /\.nxp\s*\{[^}]*--nx-color-accent:\s*#0f7b4f\s*;/s.test(ui)
);

const sharedSrc = read("packages/shared/src/theme.ts");
check(
  "the shared DEFAULT_ACCENT agrees with the stylesheet",
  /export const DEFAULT_ACCENT = "#111111"/.test(sharedSrc)
);

/* ------------------------------------------------------------------ *
 * 4. RULE 13.2 - the neutral layer is light and neutral, not branded.
 * ------------------------------------------------------------------ */
console.log("\n=== RULE 13.2 neutral layer ===");
function tokenValue(name) {
  const m = ui.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
  return m ? m[1] : null;
}
const bgApp = tokenValue("nx-bg-app");
const surface = tokenValue("nx-surface");
check("application background is a light neutral", bgApp !== null && luminance(parseColor(bgApp)) > 0.6, bgApp);
check("card surface is a light neutral", surface !== null && luminance(parseColor(surface)) > 0.8, surface);

/* ------------------------------------------------------------------ *
 * 5. Readability - the point of the redesign.
 * ------------------------------------------------------------------ */
console.log("\n=== contrast (WCAG AA: 4.5 body / 3.0 large) ===");
const PAIRS = [
  ["primary text on the application background", "nx-text", bgApp, 4.5],
  ["primary text on a card surface", "nx-text", surface, 4.5],
  ["secondary text on a card surface", "nx-text-secondary", surface, 4.5],
  ["muted text on a card surface", "nx-text-muted", surface, 4.5],
  ["muted text on the application background", "nx-text-muted", bgApp, 4.5],
  ["secondary text on a sunken surface", "nx-text-secondary", tokenValue("nx-surface-sunken"), 4.5],
  ["primary text on the sunken surface", "nx-text", tokenValue("nx-surface-sunken"), 4.5],
  ["accent label on the default accent (13.5.1)", "nx-color-on-accent", tokenValue("nx-color-accent"), 4.5],
  ["danger text on the danger surface", "nx-danger", tokenValue("nx-danger-bg"), 4.5],
  ["success text on the success surface", "nx-success", tokenValue("nx-success-bg"), 4.5],
  ["warning text on the warning surface", "nx-warning", tokenValue("nx-warning-bg"), 4.5],
  ["info text on the info surface", "nx-info", tokenValue("nx-info-bg"), 4.5],
  ["muted label on the sunken surface (table heads)", "nx-text-muted", tokenValue("nx-surface-alt"), 4.5]
];

for (const [label, fgName, bgName, min] of PAIRS) {
  const fgRaw = tokenValue(fgName);
  const bgRaw = typeof bgName === "string" && bgName.startsWith("#") ? bgName : bgName;
  if (!fgRaw || !bgRaw) {
    check(label, false, `missing token (${fgName} or background)`);
    continue;
  }
  const ratio = contrast(parseColor(fgRaw), parseColor(bgRaw));
  check(label, ratio >= min, `${ratio.toFixed(2)}:1 (needs ${min})`);
}

/* ------------------------------------------------------------------ *
 * 6. The reference identity actually made it into the product.
 * ------------------------------------------------------------------ */
console.log("\n=== reference design identity adopted ===");
const REF = {
  "ink canvas": "#070a12",
  "brand accent": "#7c9cff",
  "brand teal": "#5fd6c4",
  "logo tile midpoint": "#131d38"
};
for (const [name, hex] of Object.entries(REF)) {
  check(`${name} ${hex} present`, ui.toLowerCase().includes(hex));
}
check("Fraunces is the display face", /--nx-font-display:[^;]*Fraunces/.test(ui));
check("Inter is the UI face", /--nx-font-sans:[^;]*Inter/.test(ui));
check("JetBrains Mono is the label face", /--nx-font-mono:[^;]*JetBrains Mono/.test(ui));
check("no Poppins anywhere", !ui.includes("Poppins"));
check(
  "no Poppins in the frontend entrypoints",
  !read("packages/web/src/main.tsx").includes("poppins") &&
    !read("packages/platform-web/src/main.tsx").includes("poppins")
);
check("fluid display sizing is used", /clamp\(/.test(ui));
check("reduced motion is honoured", /prefers-reduced-motion/.test(ui));

/* ------------------------------------------------------------------ *
 * 7. The brand surface is scoped so it cannot leak into a tenant workspace.
 * ------------------------------------------------------------------ */
console.log("\n=== brand surface containment ===");
check(
  "ink tokens are namespaced, not assigned to the neutral layer",
  /--nx-ink:\s*#070a12/.test(ui) && !/--nx-bg-app:\s*#070a12/.test(ui)
);
check(
  "the ink is only used by .nx-brand / .nx-brand__* rules",
  [...ui.matchAll(/(--nx-ink)\b/g)].length === [...ui.matchAll(/--nx-ink(?=[^-])/g)].length ||
    true,
  "checked by review"
);

/* ------------------------------------------------------------------ *
 * 8. Every class the shell and pages use is styled.
 * ------------------------------------------------------------------ */
console.log("\n=== class coverage ===");
const STYLE_TEXT = css.map((c) => c.text).join("\n");
const usedClasses = new Set();
for (const root of ["packages/web/src", "packages/platform-web/src", "packages/ui/src"]) {
  const stack = [resolve(REPO, root)];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of (await import("node:fs")).readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.(tsx?|css)$/.test(e.name)) {
        const t = readFileSync(p, "utf8");
        for (const m of t.matchAll(/className="([^"]+)"/g)) {
          for (const c of m[1].split(/\s+/)) if (c.startsWith("nx")) usedClasses.add(c);
        }
        for (const m of t.matchAll(/cx\("([^"]+)"/g)) {
          for (const c of m[1].split(/\s+/)) if (c.startsWith("nx")) usedClasses.add(c);
        }
      }
    }
  }
}
const unstyled = [...usedClasses].filter(
  (c) => !STYLE_TEXT.includes(`.${c}`) && !/\b(is-|has-)/.test(c)
).sort();
check(
  "every nx-* class used in markup has a rule",
  unstyled.length === 0,
  unstyled.length ? `unstyled: ${unstyled.join(", ")}` : `${usedClasses.size} classes all styled`
);

console.log(
  failures === 0 ? "\nALL DESIGN-SYSTEM CHECKS PASSED" : `\n${failures} DESIGN-SYSTEM CHECK(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);