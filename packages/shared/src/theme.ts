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
