import { Router } from "express";
import { z } from "zod";
import type { Request, Response } from "express";
import { AppError } from "../../lib/errors";
import { requireAuth, requireCompleteSession } from "../../middleware/auth";
import {
  changePassword,
  currentPrincipal,
  login,
  logout,
  refresh
} from "./service";

export const authRouter = Router();

const REFRESH_COOKIE = "nx_refresh";
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === REFRESH_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return undefined;
}

function setRefreshCookie(req: Request, res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/auth",
    maxAge: COOKIE_MAX_AGE_MS
  });
  void req;
}

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200)
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const issued = await login(
      req.headers.host,
      parsed.data.username,
      parsed.data.password,
      { ip: req.ip, userAgent: req.headers["user-agent"] }
    );
    setRefreshCookie(req, res, issued.refreshToken);
    res.status(200).json({
      accessToken: issued.accessToken,
      mustChangePassword: issued.mustChangePassword,
      principal: issued.principal
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const token = readRefreshCookie(req) ?? (req.body?.refreshToken as string | undefined);
    const issued = await refresh(token, {
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });
    setRefreshCookie(req, res, issued.refreshToken);
    res.status(200).json({
      accessToken: issued.accessToken,
      mustChangePassword: issued.mustChangePassword,
      principal: issued.principal
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (req, res, next) => {
  try {
    void logout(readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const claims = req.principal!;
    const live = await currentPrincipal(claims.sub, claims.companyId, claims.branchId ?? null);
    res.status(200).json({
      userId: live.userId,
      companyId: live.companyId,
      branchId: live.branchId,
      roles: live.roles,
      permissions: live.permissions,
      mustChangePassword: claims.mcp === true
    });
  } catch (err) {
    next(err);
  }
});

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200)
});

authRouter.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const claims = req.principal!;
    await changePassword(
      claims.sub,
      claims.companyId,
      parsed.data.currentPassword,
      parsed.data.newPassword
    );
    res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Guarded sample demonstrating the centralized session gate: full sessions
// only (must-change-password holders are rejected until they rotate their
// credential). Permission-verb enforcement is covered by requirePermission
// on business routes and by the merge-engine unit tests.
authRouter.get("/session-check", requireAuth, requireCompleteSession, (_req, res) => {
  res.status(200).json({ ok: true });
});
