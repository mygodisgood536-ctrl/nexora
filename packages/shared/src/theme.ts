/**
 * Theme token architecture (Part 1 §26).
 *
 * Every company's brand is a stored row in `themes`; the frontend consumes it
 * exclusively as CSS custom properties (--nx-*) so the SAME component tree
 * renders with any tenant's identity and no component ever hard-codes a hex
 * value. Nexora's own palette (styles/theme.css defaults) is the literal
 * fallback wherever a company has not overridden a token.
 */

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

/** theme record column → CSS custom property it feeds. */
export const THEME_VAR_MAP: Readonly<Record<string, string>> = {
  primary_color: "--nx-color-primary",
  secondary_color: "--nx-color-secondary",
  accent_color: "--nx-color-accent",
  navy_color: "--nx-color-navy",
  font_family: "--nx-font-family"
};

const FONT_STACK_FALLBACK = ', system-ui, -apple-system, "Segoe UI", sans-serif';

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
    vars[cssVar] =
      column === "font_family" ? `"${raw.replace(/"/g, "")}"${FONT_STACK_FALLBACK}` : raw;
  }
  // RULE 13.5.1 — the label colour on the accent is computed, never chosen.
  const accent = typeof row.primary_color === "string" && HEX_COLOR_RE.test(row.primary_color)
    ? row.primary_color
    : DEFAULT_ACCENT;
  vars["--nx-color-accent"] = accent;
  vars["--nx-color-on-primary"] = labelColorFor(accent);
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
 * RULE 13.4.1 — with no company chosen, the product's accent is BLACK (a
 * near-black charcoal). The moment a company is created with a colour, every
 * accent token takes that colour instead.
 */
export const DEFAULT_ACCENT = "#111111";

/** RULE 13.4.2 — the Platform Owner's own portal is green, the approved colour. */
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
