import { apiUrl } from "./api";

export interface CompanyTheme {
  /** RULE 13.6.1 - the logo is pre-auth so the login screen is fully branded. */
  company?: { name?: string; slug?: string; logoUrl?: string | null };
  tokens?: Record<string, string>;
}

/**
 * RULE 13.6.2 - the company logo, or null when the company has not uploaded
 * one. Callers render a styled name placeholder rather than a broken image.
 */
export function companyLogo(): string | null {
  const url = themeCache?.company?.logoUrl;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/**
 * RULE 13.4.1 / Part 1 §26 - the portal host's stored theme is applied as CSS
 * custom properties BEFORE first paint, so even the login screen carries the
 * company identity. Nexora's neutral defaults stay for anything unset.
 */
export async function fetchCompanyTheme(): Promise<CompanyTheme | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(apiUrl("/theme"), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as CompanyTheme;
  } catch {
    return null;
  }
}

let themeCache: CompanyTheme | null = null;

/** The theme the host resolved pre-auth, cached for the shell and login screens. */
export function companyTheme(): CompanyTheme | null {
  return themeCache;
}

/** The company name carried by the pre-auth theme, when the host resolved one. */
export function companyName(): string {
  return themeCache?.company?.name ?? "Nexora";
}

export function applyThemeTokens(theme: CompanyTheme | null): void {
  if (!theme?.tokens) return;
  for (const [name, value] of Object.entries(theme.tokens)) {
    document.documentElement.style.setProperty(name, value);
  }
}

export async function applyCompanyTheme(): Promise<CompanyTheme | null> {
  const theme = await fetchCompanyTheme();
  themeCache = theme;
  applyThemeTokens(theme);
  if (theme?.company?.name) {
    document.title = `${theme.company.name} - Nexora`;
  }
  return theme;
}
