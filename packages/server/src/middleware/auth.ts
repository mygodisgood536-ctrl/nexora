import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import type { ScopeType } from "@nexora/shared";
import type { CredentialState } from "../lib/credential";
import { withTenant } from "../db/repo";

export interface PrincipalRoleRef {
  roleKey: string;
  scopeType: ScopeType;
  branchIds: string[];
  permissions: string[];
}

export interface PrincipalPayload {
  sub: string;
  companyId: string;
  branchId?: string | null;
  roles: PrincipalRoleRef[];
  /** must-change-password: session limited until first credential change. */
  mcp?: boolean;
  /** Credential lifecycle state (Vision Part 5 §5.4). */
  cs?: CredentialState;
  /** Active role lens for UI (Part 1 §16 role switcher). */
  activeRoleKey?: string | null;
  /**
   * Session epoch (migration 0052). RULE 14.4.3 / 5.8.2 — suspension, hold
   * and transfer must kill every outstanding session immediately, not after a
   * 15-minute token expiry. The epoch is stamped into the token and compared
   * against the user's current epoch on each authenticated request.
   */
  se?: number;
}

const TOKEN_OPTIONS: jwt.VerifyOptions = { algorithms: ["HS256"] };

export function verifyAccessToken(token: string): PrincipalPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET, TOKEN_OPTIONS) as PrincipalPayload;
  } catch {
    throw AppError.unauthorized("Invalid or expired session token");
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export function attachPrincipal(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) return next();
  try {
    req.principal = verifyAccessToken(token);
  } catch {
    return next();
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.principal) {
    next(AppError.unauthorized());
    return;
  }
  next();
}

/**
 * RULE 14.4.3 / 5.8.2 — immediate session invalidation. A security action
 * (worker suspension, portfolio hold, portfolio transfer, termination,
 * company suspension) increments the user's session epoch. Every outstanding
 * access token carries the epoch it was minted with, so a token from before
 * the action is refused here immediately rather than remaining usable until
 * its 15-minute expiry.
 */
export function requireLiveSession(req: Request, _res: Response, next: NextFunction): void {
  if (!req.principal) {
    next(AppError.unauthorized());
    return;
  }
  const tokenEpoch = req.principal.se;
  // A token minted before the epoch existed carries no claim; those are
  // already short-lived, so they are allowed and will carry an epoch on refresh.
  if (tokenEpoch === undefined) {
    next();
    return;
  }
  void withTenant(req.principal.companyId, null, async (db) => {
    const r = await db.query<{ session_epoch: number; status: string; company_status: string }>(
      `SELECT u.session_epoch, u.status, c.status AS company_status
         FROM users u JOIN companies c ON c.id = u.company_id
        WHERE u.id = $1`,
      [req.principal!.sub]
    );
    if ((r.rowCount ?? 0) === 0) {
      next(AppError.unauthorized("Session no longer valid"));
      return;
    }
    const row = r.rows[0]!;
    if (row.session_epoch !== tokenEpoch) {
      next(AppError.unauthorized("Session ended; sign in again"));
      return;
    }
    if (row.status === "suspended" || row.status === "terminated") {
      next(AppError.forbidden("Account is no longer active"));
      return;
    }
    if (row.company_status !== "active") {
      next(AppError.forbidden("Company is not active"));
      return;
    }
    next();
  }).catch(() => next(AppError.unauthorized("Session could not be verified")));
}

/**
 * Blocks token holders whose credential ritual ("Credential issued" /
 * "Ritual in progress") has not completed. RULE 4.2.2 / 5.3.3: until the
 * ritual completes, the account can reach nothing except the ritual screens
 * and sign-out; the response names the required next step.
 */
export function requireCompleteSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.principal) {
    next(AppError.unauthorized());
    return;
  }
  // RULE 14.4.3 / 5.8.2 — every gated surface first proves the session is
  // still live, so a suspension, hold or transfer takes effect immediately
  // rather than when the access token happens to expire.
  requireLiveSession(req, res, (err?: unknown) => {
    if (err) {
      next(err as AppError);
      return;
    }
    const { cs, mcp } = req.principal!;
    if (cs !== undefined) {
      if (cs === "secured") return next();
      const step =
        cs === "credential_issued" && mcp === true
          ? "change-password"
          : "change-password, authenticator setup, authenticator verification and profile";
      next(
        new AppError(
          403,
          "CREDENTIAL_RITUAL_REQUIRED",
          `Complete the credential ritual (required step: ${step}) to continue`
        )
      );
      return;
    }
    if (mcp === true) {
      next(new AppError(403, "MUST_CHANGE_PASSWORD", "Change your password to continue"));
      return;
    }
    next();
  });
}

/**
 * Requires the session to hold a permission verb. A single verb is the normal
 * case; where one action is legitimately held under different verbs by
 * different roles (for example approving or rejecting a stage), the accepted
 * alternatives are passed as an array and holding any one of them is enough.
 *
 * RULE 5.5.2 / the final no-inference rule: every gated surface declares the
 * authority it needs, so least privilege is enforced by the route itself
 * rather than being assumed.
 */
export function requirePermission(verb: string | string[]): (req: Request, _res: Response, next: NextFunction) => void {
  const verbs = Array.isArray(verb) ? verb : [verb];
  return (req, _res, next) => {
    if (!req.principal) {
      next(AppError.unauthorized());
      return;
    }
    const granted = req.principal.roles.some((role) =>
      verbs.some((needed) => role.permissions.includes(needed))
    );
    if (!granted) {
      next(AppError.forbidden(`Missing permission: ${verbs.join(" or ")}`));
      return;
    }
    next();
  };
}
