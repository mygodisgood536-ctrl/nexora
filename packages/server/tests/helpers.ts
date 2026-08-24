import jwt from "jsonwebtoken";
import type { PrincipalPayload } from "../src/middleware/auth";
import { env } from "../src/config/env";

export function signTestToken(payload: Partial<PrincipalPayload> & Pick<PrincipalPayload, "sub" | "companyId">): string {
  return jwt.sign(
    {
      sub: payload.sub,
      companyId: payload.companyId,
      branchId: payload.branchId ?? null,
      roles: payload.roles ?? []
    },
    env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "15m" }
  );
}
