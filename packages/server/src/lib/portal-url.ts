import { env } from "../config/env";

/**
 * Generated company addresses (Vision Part 1 §2.3, RULE 2.3.1).
 *
 * RULE 2.3.1 fixes the SLUG — created once, unique platform-wide, derived from
 * the company name — and says a company's own domain is "pointed at the same
 * application and never changes the internal slug". So the slug is the identity
 * and the address is presentation.
 *
 * Two presentation forms are generated, and BOTH resolve at runtime:
 *
 *   subdomain : {slug}.{PLATFORM_APEX}          the Vision default
 *   path      : {PLATFORM_BASE_URL}/{slug}      for hosts without wildcard DNS
 *
 * A hosting provider that issues only a single apex domain (Vercel's
 * *.vercel.app does not offer user subdomains) cannot serve the subdomain form.
 * Rather than weaken RULE 2.3.1 — or force a domain purchase — the path form
 * addresses the same tenant on the same application, so the URL still supplies
 * the scope and there is still no company picker (RULE 2.4.1).
 */

function apex(): string {
  return env.PLATFORM_APEX.trim().replace(/^\.+/, "").replace(/\/+$/, "");
}

function base(): string {
  return env.PLATFORM_BASE_URL.trim().replace(/\/+$/, "");
}

/** {slug}.{apex} — the Vision's specified company URL form. */
export function subdomainCompanyUrl(slug: string): string {
  return `${slug}.${apex()}`;
}

/** {slug}-{branchSlug}.{apex} — the Vision's specified branch URL form. */
export function subdomainBranchUrl(slug: string, branchSlug: string): string {
  return `${slug}-${branchSlug}.${apex()}`;
}

/** {base}/{slug} — the same tenant on the shared platform host. */
export function pathCompanyUrl(slug: string): string {
  return `${base()}/${slug}`;
}

/** {base}/{slug}-{branchSlug} — the same branch tenant on the shared host. */
export function pathBranchUrl(slug: string, branchSlug: string): string {
  return `${base()}/${slug}-${branchSlug}`;
}

/** The address handed to the one-time credential panel for this deployment. */
export function advertisedCompanyUrl(slug: string): string {
  return env.COMPANY_URL_MODE === "subdomain" ? subdomainCompanyUrl(slug) : pathCompanyUrl(slug);
}

export function advertisedBranchUrl(slug: string, branchSlug: string): string {
  return env.COMPANY_URL_MODE === "subdomain"
    ? subdomainBranchUrl(slug, branchSlug)
    : pathBranchUrl(slug, branchSlug);
}

/**
 * Both forms, returned to the Platform Owner so the company record always
 * carries its Vision-specified address even while the deployment is serving the
 * path form. Nothing is lost when the apex is later pointed at this project.
 */
export function companyAddressSet(slug: string): {
  subdomainUrl: string;
  pathUrl: string;
  advertisedUrl: string;
  apex: string;
  mode: "subdomain" | "path";
} {
  return {
    subdomainUrl: subdomainCompanyUrl(slug),
    pathUrl: pathCompanyUrl(slug),
    advertisedUrl: advertisedCompanyUrl(slug),
    apex: apex(),
    mode: env.COMPANY_URL_MODE
  };
}
