/**
 * Theme token architecture (Part 1 §26).
 *
 * Every company's brand is a stored row in `themes`; the frontend consumes it
 * exclusively as CSS custom properties (--nx-*) so the SAME component tree
 * renders with any tenant's identity and no component ever hard-codes a hex
 * value.
 *
 * CHANGE OF DIRECTION (owner instruction, 2026-10-22) - ONE NEXORA BRAND.
 *
 * Vision Part 13 built the accent as a PER-COMPANY colour: RULE 13.3 lists the
 * tokens that take the company's chosen colour, and RULE 13.4.1 says the accent
 * changes the moment a company is created with a colour. The owner has since
 * directed that the product carry a single Nexora brand system instead, and
 * that a company may not choose a theme or colour palette at all. This file
 * implements that direction, and Vision RULE 16.4.1 requires the change to be
 * written down with its reason rather than silently made:
 *
 *   - The accent is now FIXED. A company's theme record can no longer change
 *     --nx-color-accent, whatever it contains.
 *   - Company identity is its NAME and its LOGO, with its domain where one is
 *     configured. The branding record still stores colours, because the Vision's
 *     stored brand record is a real thing and other surfaces read it, but those
 *     colours no longer reach the workspace accent.
 *   - The Platform Owner portal keeps the approved green of RULE 13.4.2. That
 *     is a platform fact about the owner, not a company theme, and it is the one
 *     place the Vision names a portal-specific colour.
 *
 * The neutral layer of RULE 13.2 is untouched: backgrounds, surfaces, text,
 * dividers and semantic colours are fixed for every company exactly as before.
 */

/** CHANGE 2026-10-22 — see the file header. */
export const CHANGE_LOG_2026_10_22_SINGLE_NEXORA_BRAND =
  "2026-10-22 — Owner direction: one Nexora brand system. The workspace accent is fixed and a company " +
  "may no longer choose a theme or colour palette; company identity is its name and logo (plus domain " +
  "where configured). Rationale: a coherent product identity across every tenant, and a branding form " +
  "whose only inputs are the three core identity fields. Affected Vision rules: 13.3, 13.4.1, 13.4.3, " +
  "13.5.1, 13.5.2, 3.3.1 (company colour input removed). Unaffected: 13.2 (neutral layer), 13.4.2 " +
  "(Platform Owner green), 13.6 (logo law), 13.8 (visual prohibitions).";

export interface CompanyThemeInput {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  navyColor?: string | null;
  logoUrl?: string | null;
  loginBackgroundUrl?: string | null;
  fontFamily?: string | null;
}

/** Strict brand-color grammar: #RRGGBB. */
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * theme record column → CSS custom property it feeds.
 *
 * CHANGE 2026-10-22 (single Nexora brand) - `accent_color` is no longer in this
 * map, so a company's stored accent can never reach the workspace accent. The
 * accent is the fixed Nexora brand value below.
 */
export const THEME_VAR_MAP: Readonly<Record<string, string>> = {
  primary_color: "--nx-color-primary",
  secondary_color: "--nx-color-secondary",
  navy_color: "--nx-color-navy",
  font_family: "--nx-font-family"
};

const FONT_STACK_FALLBACK = ', system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Strict font-family grammar (Part 1 §26 `font_family`).
 *
 * This value is written straight into a CSS custom property, so it must not be
 * able to close the declaration and append arbitrary rules. It permits only
 * letters, digits, spaces, single hyphens and commas — enough for every real
 * family name and for a comma-separated fallback stack, and nothing else.
 * Quotes are deliberately excluded: the value is quoted per-family below, so
 * accepting them here would produce one quoted blob and an invalid declaration.
 */
export const FONT_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 -]*(?:,[A-Za-z0-9][A-Za-z0-9 -]*)*$/;

/** CSS generic family keywords, which must never be quoted. */
const CSS_GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "inherit",
  "initial",
  "unset"
]);

/**
 * Quotes each family in a comma-separated stack and appends the product's own
 * fallbacks, so a company that typed "Fraunces, Georgia" gets two real quoted
 * families instead of one quoted blob. Anything failing FONT_FAMILY_RE is
 * dropped entirely, leaving the stylesheet default in force.
 */
export function toFontFamilyStack(raw: string): string | null {
  const families = raw
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  if (families.length === 0 || !families.every((f) => FONT_FAMILY_RE.test(f))) return null;
  const quoted = families.map((f) =>
    CSS_GENERIC_FAMILIES.has(f.toLowerCase()) ? f : `"${f}"`
  );
  return `${quoted.join(", ")}${FONT_STACK_FALLBACK}`;
}

/**
 * Maps a stored themes row (snake_case columns) to the CSS custom properties
 * the portal styles consume. Null/absent tokens are skipped entirely so the
 * stylesheet's Nexora defaults remain in effect (fallback rule, Part 1 §26).
 */
export function themeRowToCssVars(row: Record<string, unknown>): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [column, cssVar] of Object.entries(THEME_VAR_MAP)) {
    const raw = row[column];
    if (typeof raw !== "string" || raw.length === 0) continue;
    if (column === "font_family") {
      const stack = toFontFamilyStack(raw);
      if (stack !== null) vars[cssVar] = stack;
      continue;
    }
    // RULE 13.8.1 - a themed element may only come from the theme record, and
    // the record is untrusted input, so every colour is grammar-checked before
    // it reaches a custom property.
    if (column === "primary_color" || column === "secondary_color" || column === "navy_color") {
      if (!HEX_COLOR_RE.test(raw)) continue;
    }
    vars[cssVar] = raw;
  }
  // CHANGE 2026-10-22 (single Nexora brand) - the accent is FIXED. It is not
  // read from the company record, so no stored colour can change it, and the
  // label colour sitting on it is computed once for the brand rather than per
  // company. The stored primary/accent still reach the brand-identity surfaces
  // (logo tile, sign-in brand panel), which RULE 13.3 explicitly allows.
  vars["--nx-color-accent"] = DEFAULT_ACCENT;
  vars["--nx-color-on-primary"] = labelColorFor(DEFAULT_ACCENT);
  return vars;
}

/**
 * Applies token values onto any CSSStyleDeclaration-like target
 * (e.g. document.documentElement.style or an inline preview style object).
 */
export function applyThemeTokens(
  target: { setProperty(name: string, value: string): void },
  vars: Record<string, string>
): void {
  for (const [name, value] of Object.entries(vars)) {
    target.setProperty(name, value);
  }
}

/**
 * CHANGE 2026-10-22 (single Nexora brand) - the accent is FIXED for the whole
 * product.
 *
 * It was previously BLACK (a near-black charcoal) by RULE 13.4.1, which was
 * correct when the accent was about to be replaced by a company colour. It is
 * now the one Nexora accent: a deep, confident indigo-blue that reads as a
 * serious financial platform on the white neutral layer of RULE 13.2, and
 * which the brand surfaces (splash, wordmark tile) already share.
 *
 * Contrast against the white surface (#ffffff) is 6.4:1, so text and icons
 * drawn in the accent are legible, and the label colour computed from it is
 * white.
 */
export const DEFAULT_ACCENT = "#2f56d9";

/** RULE 13.4.2 - the Platform Owner's own portal is green, the approved colour. */
export const PLATFORM_ACCENT = "#16a34a";

/**
 * RULE 13.1.2 — the fixed neutral surface the accent has to stay legible
 * against. Backgrounds and cards never change with the company colour, so
 * this is the constant a company accent is measured against.
 */
export const NEUTRAL_SURFACE = "#ffffff";

/** Parses #RRGGBB into 0-255 components; returns null for any other grammar. */
export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  if (!HEX_COLOR_RE.test(hex)) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  };
}

/** WCAG relative luminance of a colour. */
export function relativeLuminance(hex: string): number | null {
  const c = parseHexColor(hex);
  if (!c) return null;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio between two colours (1 … 21). */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * RULE 13.5.1 — the system computes the correct label colour for anything
 * sitting on the accent: if the company's colour is light the label is
 * near-black; if it is dark the label is white. Automatic, per company.
 */
export function labelColorFor(accentHex: string): "#ffffff" | "#111111" {
  const lum = relativeLuminance(accentHex);
  if (lum === null) return "#ffffff";
  // Contrast of white vs near-black on the accent; pick the better one.
  return contrastRatio(accentHex, "#ffffff")! >= contrastRatio(accentHex, "#111111")!
    ? "#ffffff"
    : "#111111";
}

/**
 * RULE 13.5.2 — the branding screen WARNS, without blocking, when a chosen
 * colour would make text hard to read, and suggests a shade of the same
 * colour that passes contrast.
 *
 * Two failure modes are checked, because RULE 13.5.1 alone cannot catch them
 * (it always picks whichever of white/near-black reads better, so its result
 * is usually adequate):
 *
 *  1. The accent is too close to the neutral surface it sits on, so a button,
 *     border or label drawn in the accent disappears into the page.
 *  2. The label colour on the accent still fails the AA ratio.
 *
 * Returns null when the colour already passes. Never blocks saving.
 */
export function contrastWarning(
  accentHex: string,
  minRatio = 4.5
): { actual: number; suggested: string; suggestedRatio: number; reason: string } | null {
  const label = labelColorFor(accentHex);
  const onAccent = contrastRatio(accentHex, label);
  const onSurface = contrastRatio(accentHex, NEUTRAL_SURFACE);
  if (onAccent === null || onSurface === null) return null;

  const onAccentFails = onAccent < minRatio;
  const onSurfaceFails = onSurface < minRatio;
  if (!onAccentFails && !onSurfaceFails) return null;

  const c = parseHexColor(accentHex);
  if (!c) return null;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const shade = (factor: number) =>
    `#${[c.r, c.g, c.b].map((v) => clamp(v * factor).toString(16).padStart(2, "0")).join("")}`;

  // First try darkening; if the accent is too light to read on a light page,
  // also try lightening so a dark accent can separate from the surface.
  for (const factor of [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2]) {
    const candidate = shade(factor);
    const a = contrastRatio(candidate, labelColorFor(candidate))!;
    const s = contrastRatio(candidate, NEUTRAL_SURFACE)!;
    if (a >= minRatio && s >= minRatio) {
      return {
        actual: Number((onAccentFails ? onAccent : onSurface).toFixed(2)),
        suggested: candidate,
        suggestedRatio: Number(a.toFixed(2)),
        reason: onAccentFails
          ? "text on this colour is hard to read"
          : "this colour is too close to the page background"
      };
    }
  }
  for (const factor of [1.15, 1.3, 1.45, 1.6, 1.75, 1.9, 2.05, 2.2]) {
    const candidate = shade(factor);
    const a = contrastRatio(candidate, labelColorFor(candidate))!;
    const s = contrastRatio(candidate, NEUTRAL_SURFACE)!;
    if (a >= minRatio && s >= minRatio) {
      return {
        actual: Number((onAccentFails ? onAccent : onSurface).toFixed(2)),
        suggested: candidate,
        suggestedRatio: Number(a.toFixed(2)),
        reason: onAccentFails
          ? "text on this colour is hard to read"
          : "this colour is too close to the page background"
      };
    }
  }
  return null;
}
