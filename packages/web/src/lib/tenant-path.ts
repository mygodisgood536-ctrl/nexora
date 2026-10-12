/**
 * Tenant address prefix for the company portal (Vision Part 1 §2.3).
 *
 * The platform serves a company portal on ONE of two address forms:
 *
 *   hostname : acme.nexora.app/money          the Vision's default form
 *   path     : nexora.vercel.app/acme/money    same application, shared apex
 *
 * The path form exists because a hosting provider that issues a single apex and
 * no user subdomains (Vercel's *.vercel.app) cannot serve the hostname form.
 * It changes only HOW the tenant is addressed — never WHAT the tenant may do.
 * Once resolved, every request runs the identical router tree, the identical
 * permission checks and the identical row-level security, and the session token
 * still carries the company and branch ids.
 *
 * Detection is pure string work on the current path; it never consults the
 * network, so the first paint (including the branded login screen) is not
 * delayed by it.
 */

/**
 * First path segments that are portal routes or platform resources, never a
 * company slug. Must stay in step with the reserved list on the server
 * (`packages/server/src/lib/host.ts`) and with the app's routes.
 */
const RESERVED = new Set([
  "api",
  "platform",
  "assets",
  "people",
  "branches",
  "customers",
  "groups",
  "credit",
  "approvals",
  "money",
  "audit",
  "findings",
  "trace",
  "control",
  "capability",
  "reports",
  "performance",
  "workplace",
  "field",
  "recovery",
  "service",
  "technical",
  "providers",
  "notifications",
  "profile",
  "eod",
  "login",
  "favicon.ico",
  "robots.txt",
  "index.html"
]);

/** Detects the tenant prefix, returning "" when the address supplies none. */
export function detectTenantPrefix(pathname: string = window.location.pathname): string {
  const first = pathname.split("/").filter(Boolean)[0];
  if (!first) return "";
  const lowered = first.toLowerCase();
  if (RESERVED.has(lowered)) return "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(lowered)) return "";
  if (lowered.length > 60) return "";
  return lowered;
}

export const TENANT_PREFIX: string = detectTenantPrefix();

/** BrowserRouter basename — lets every route stay written as `/money`. */
export const ROUTER_BASENAME: string = TENANT_PREFIX ? `/${TENANT_PREFIX}` : "";

export { RESERVED as RESERVED_PORTAL_SEGMENTS };
