import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import type { PrincipalPayload } from "../../middleware/auth";

export interface AccessTokenClaims extends PrincipalPayload {
  /** must-change-password: limits the session until first credential change. */
  mcp?: boolean;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, { algorithm: "HS256", expiresIn: "15m" });
}

export function verifyAccessTokenClaims(token: string): AccessTokenClaims {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as AccessTokenClaims;
}
