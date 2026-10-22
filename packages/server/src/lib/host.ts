/**
 * Portal address resolution (Vision Part 1 §2.3, Part 2 §2.4).
 *
 * The Vision's URL law:
 *   RULE 2.3.1  the company slug is fixed at creation, unique platform-wide,
 *                derived from the company name, and the company's own optional
 *                domain is "pointed at the same application" and "never changes
 *                the internal slug".
 *   §2.4        "the URL supplies the scope; the credential identifies the
 *                person; the role assignment supplies the portal."
 *
 * Three address forms therefore resolve to the same slug, none of them weaker
 * than another:
 *
 *   1. PLATFORM HOSTNAME  acme.nexora.app            the Vision default
 *   2. COMPANY DOMAIN     portal.acme.com            Vision-permitted, verified
 *   3. TENANT PATH        example.vercel.app/acme    same application, shared apex
 *
 * Form 3 exists so the platform can run on a host that issues one apex and no
 * user subdomains — Vercel's *.vercel.app does not — while still honouring the
 * rule the Vision is actually protecting: a system-generated, stable,
 * platform-unique address that supplies the scope before authentication, with no
 * company picker anywhere in the flow.
 *
 * SECURITY. None of these forms widens access:
 *  - every form is a LOOKUP KEY resolved against real rows, never an authority;
 *  - the tenant session and row-level security are identical on all three;
 *  - the credential is always checked inside the resolved company;
 *  - an unknown, unverified or forged address resolves to nothing and is
 *    rejected exactly as an unknown host always was.
 */
import { env } from "../config/env";

export interface HostCandidate {
  companySlug: string;
  branchSlug: string | null;
}

/** Address forms, as returned by `parsePortalAddress`. */
export interface PortalAddress {
  /** Slug candidates from a platform hostname or a tenant path. */
  candidates: HostCandidate[];
  /**
   * A company-owned domain to look up in `company_domains`, or null.
   * Set only when the host is NOT a platform apex and NOT a local dev host.
   */
  customDomain: string | null;
  /** True when the address carried no tenant at all (e.g. the apex itself). */
  empty: boolean;
}

/** First path segments that can never be a company slug. */
export const RESERVED_PATH_SEGMENTS = new Set([
  "api",
  "platform",
  "assets",
  "favicon.ico",
  "robots.txt",
  "index.html"
]);

/**
 * Path segments that introduce an API surface.
 *
 * A tenant prefix is ONLY meaningful when it is followed by an API path. Portal
 * pages are served as static assets and never reach this server, but the check
 * is made explicit anyway so a page name such as `/money` can never be mistaken
 * for a company slug if a request like that does arrive.
 */
const API_ROOTS = new Set(["api", "platform"]);

/**
 * Mirrors the database constraint on `companies.slug` (`^[a-z0-9-]+$`).
 *
 * Deliberately identical to the DB rule: if the parser were stricter, a slug the
 * database accepts could become unreachable through its own address form, which
 * would be a silent, un-debuggable lockout for that company. Rejecting a
 * non-matching label only means "no company has this slug", which is the same
 * outcome as an unknown host.
 */
const DB_SLUG_PATTERN = /^[a-z0-9-]*[a-z0-9][a-z0-9-]*$/;

/**
 * A company/branch part produced by splitting on a dash must be a clean slug:
 * no leading or trailing dash. This only affects where a boundary is *guessed*;
 * it never limits which slugs are addressable.
 */
const PART_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Splits a label into company/branch candidates, longest company first.
 *
 * Slugs on both sides may contain dashes, so every dash position is a possible
 * boundary. The caller resolves candidates against real rows and takes the first
 * that matches a real company (and a real branch, when one is named), which is
 * why ordering is longest-company-first: `acme-kampala-mukono` prefers the more
 * specific company before the shorter one.
 */
export function splitSlugCandidates(label: string): HostCandidate[] {
  if (!DB_SLUG_PATTERN.test(label)) return [];
  const candidates: HostCandidate[] = [{ companySlug: label, branchSlug: null }];
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== "-") continue;
    const companySlug = label.slice(0, i);
    const branchSlug = label.slice(i + 1);
    if (PART_SLUG_PATTERN.test(companySlug) && PART_SLUG_PATTERN.test(branchSlug)) {
      candidates.push({ companySlug, branchSlug });
    }
  }
  // Longest company first, so `acme-kampala-mukono` prefers company `acme-kampala`
  // branch `mukono` over company `acme` branch `kampala-mukono`. A real company
  // slug is far more likely to be the longer prefix, and the caller takes the
  // first candidate that matches real rows.
  candidates.sort((a, b) => {
    if (b.companySlug.length !== a.companySlug.length) {
      return b.companySlug.length - a.companySlug.length;
    }
    return (a.branchSlug?.length ?? 0) - (b.branchSlug?.length ?? 0);
  });
  return candidates;
}

/** Backwards-compatible view of `splitSlugCandidates`. */
export function parsePortalHost(hostHeader: string | undefined | null): HostCandidate[] {
  const address = parsePortalAddressFromHost(hostHeader);
  return address.candidates;
}

/**
 * Resolves a Host header to an address.
 *
 * A host under the configured platform apex (`acme.nexora.app`) yields slug
 * candidates. A host under `.localhost` is the LOCAL DEVELOPMENT equivalent of
 * the same form - `acme.localhost` is `acme.nexora.app` pointed at the
 * developer's machine - and yields the same candidates. Any other multi-label
 * host is treated as a COMPANY DOMAIN and is only accepted when a verified row
 * exists for it, so an unregistered domain cannot resolve, and the apex itself
 * resolves to nothing.
 *
 * The `.localhost` form is not a weakening of any rule. Like the apex form, the
 * label is only a LOOKUP KEY: it is resolved against real `companies` rows
 * before a single credential is checked, so a forged label resolves to nothing
 * and grants exactly what the apex form would have granted. It exists so that
 * the platform can be exercised on a machine that has no wildcard DNS, which is
 * also what the automated suite relies on.
 */
export function parsePortalAddressFromHost(hostHeader: string | undefined | null): PortalAddress {
  const EMPTY: PortalAddress = { candidates: [], customDomain: null, empty: true };
  if (!hostHeader) return EMPTY;

  const host = hostHeader.split(":")[0]!.toLowerCase().replace(/\.$/, "");
  if (!host) return EMPTY;
  // The bare localhost and a bare IP address are not company addresses.
  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return EMPTY;

  const apex = env.PLATFORM_APEX.trim().toLowerCase().replace(/^\.+|\.+$/g, "");

  if (apex && host.endsWith(`.${apex}`)) {
    const label = host.slice(0, -(apex.length + 1));
    // The bare apex, and any deeper nesting, are not company addresses.
    if (!label || label.includes(".")) return EMPTY;
    return { candidates: splitSlugCandidates(label), customDomain: null, empty: false };
  }

  // Local development: `acme.localhost` is the platform-hostname form pointed at
  // this machine. The label resolves against real company rows exactly as the
  // apex form does, so it authorises nothing the apex form would not.
  if (host.endsWith(".localhost")) {
    const label = host.slice(0, -".localhost".length);
    if (!label || label.includes(".")) return EMPTY;
    return { candidates: splitSlugCandidates(label), customDomain: null, empty: false };
  }

  if (host === apex) return EMPTY;

  // Not a platform address: only a real, verifiable company domain can use it.
  // DNS ownership is proven out of band before the row is marked verified.
  return {
    candidates: [],
    customDomain: host,
    empty: false
  };
}

/**
 * Reads a tenant prefix from a request path.
 *
 * A prefix counts ONLY when the segment after it is an API root, so a portal
 * page name such as `/money` can never be mistaken for a company slug.
 * Accepts `acme`, `acme/…` and the branch form `acme-mukono`, returning the same
 * candidate set the hostname form produces.
 */
export function parsePortalPath(pathname: string | undefined | null): HostCandidate[] {
  if (!pathname) return [];
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  const second = segments[1];
  if (!first || !second) return [];
  if (!API_ROOTS.has(second.toLowerCase())) return [];
  const lowered = first.toLowerCase();
  if (RESERVED_PATH_SEGMENTS.has(lowered)) return [];
  if (first.length > 60) return [];
  return splitSlugCandidates(lowered);
}

/** Resolves slug and custom-domain candidates from one request. */
export function parsePortalAddress(
  hostHeader: string | undefined | null,
  pathname?: string | undefined | null
): PortalAddress {
  const fromHost = parsePortalAddressFromHost(hostHeader);
  const fromPath = parsePortalPath(pathname);

  // A tenant prefix outranks the hostname so a path-addressed tenant always
  // addresses the company it names, never one implied by the host.
  const candidates = fromPath.length > 0 ? fromPath : fromHost.candidates;
  const customDomain = fromPath.length > 0 ? null : fromHost.customDomain;

  return { candidates, customDomain, empty: candidates.length === 0 && customDomain === null };
}
