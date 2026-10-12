import type { Request } from "express";
import { parsePortalPath } from "../lib/host";

declare module "express-serve-static-core" {
  interface Request {
    /**
     * The original request path, captured before any tenant prefix was removed.
     * Address resolution needs the untouched path so it can read the prefix.
     */
    tenantPath?: string;
  }
}

/**
 * Detects a `/<company-slug>` prefix on the request path, removes it from
 * `req.url`, and preserves the original path for address resolution.
 *
 * Why strip it here rather than mount the API under every possible prefix: one
 * code path means one set of rules. `/acme/api/v1/auth/login` and
 * `/api/v1/auth/login` then traverse the identical router tree, the identical
 * permission checks and the identical row-level security. The prefix selects the
 * tenant; it never selects a code path.
 *
 * This supports the tenant path form of the URL law (Vision Part 1 §2.3) on
 * hosts that issue a single apex and no user subdomains — Vercel's *.vercel.app
 * among them — while the platform hostname form continues to work unchanged.
 *
 * Security notes:
 *  - The prefix is only a LOOKUP KEY. It is resolved against real company rows
 *    before any credential is checked, so a forged prefix fails closed exactly
 *    as an unknown Host header does.
 *  - Reserved first segments (`api`, `platform`, `assets`, …) are never treated
 *    as a tenant, so the Platform Owner console and static assets can never be
 *    swallowed by a tenant prefix.
 *  - An unknown branch in the prefix resolves to nothing rather than falling
 *    back to Head Office, so a mistyped address never widens scope.
 */
export function tenantPrefix(req: Request, _res: unknown, next: () => void): void {
  const url = req.url ?? "/";
  const queryStart = url.indexOf("?");
  const pathname = queryStart === -1 ? url : url.slice(0, queryStart);

  // Preserve the untouched path for resolveHostContext / theme resolution.
  req.tenantPath = pathname;

  const candidates = parsePortalPath(pathname);
  if (candidates.length > 0) {
    // Remove only the matched prefix segment, preserving the query string.
    // `parsePortalPath` has already confirmed an API path follows, so a portal
    // page name such as `/money` is never treated as a tenant.
    const segment = pathname.split("/").filter(Boolean)[0]!;
    const afterSegment = pathname.slice(pathname.indexOf(segment) + segment.length);
    req.url = `${afterSegment || "/"}${queryStart === -1 ? "" : url.slice(queryStart)}`;
  }
  next();
}
