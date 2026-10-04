import { Router } from "express";
import { z } from "zod";
import type { Request, Response } from "express";
import { AppError } from "../../lib/errors";
import {  requireAuth, requireCompleteSession  } from "../../middleware/auth";
import {
  changePassword,
  currentPrincipal,
  getActiveRoleLens,
  login,
  logout,
  refresh,
  ritualChangePassword,
  ritualCompleteProfile,
  ritualEnrollment,
  ritualStatus,
  ritualVerifyAuthenticator,
  setActiveRoleLens
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

function metaFrom(req: Request): { ip: string | undefined; userAgent: string | undefined; requestId: string | undefined } {
  return {
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    requestId: (req.headers["x-request-id"] as string | undefined) ?? undefined
  };
}

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const issued = await login(
      req.headers.host,
      parsed.data.username,
      parsed.data.password,
      metaFrom(req)
    );
    setRefreshCookie(req, res, issued.refreshToken);
    res.status(200).json({
      accessToken: issued.accessToken,
      mustChangePassword: issued.mustChangePassword,
      credentialState: issued.credentialState,
      principal: issued.principal
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const token = readRefreshCookie(req) ?? (req.body?.refreshToken as string | undefined);
    const issued = await refresh(token, metaFrom(req));
    setRefreshCookie(req, res, issued.refreshToken);
    res.status(200).json({
      accessToken: issued.accessToken,
      mustChangePassword: issued.mustChangePassword,
      credentialState: issued.credentialState,
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
      activeRoleKey: live.activeRoleKey,
      mustChangePassword: claims.mcp === true,
      credentialState: claims.cs ?? "secured"
    });
  } catch (err) {
    next(err);
  }
});

const activeRoleSchema = z.object({
  roleKey: z.string().min(1).max(80).nullable()
});

authRouter.get("/active-role", requireAuth, async (req, res, next) => {
  try {
    const claims = req.principal!;
    const result = await getActiveRoleLens(claims.sub, claims.companyId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.put("/active-role", requireAuth, async (req, res, next) => {
  try {
    const claims = req.principal!;
    const parsed = activeRoleSchema.safeParse(req.body);
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    await setActiveRoleLens(claims.sub, claims.companyId, parsed.data.roleKey);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
  // RULE 5.3.1.1 / 5.3.2 - confirmed twice, and authorised by a live code.
  confirmPassword: z.string().min(1).max(200),
  totpCode: z.string().min(6).max(6)
}).refine((value) => value.newPassword === value.confirmPassword, {
  message: "The new password and its confirmation do not match",
  path: ["confirmPassword"]
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
      parsed.data.newPassword,
      parsed.data.totpCode,
      metaFrom(req)
    );
    res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------- Credential ritual (RULE 4.2.1 / 5.3.1) ----------
// These endpoints are reachable while the credential ritual is incomplete
// (requireAuth only); everything else is gated by requireCompleteSession.

authRouter.get("/ritual/status", requireAuth, async (req, res, next) => {
  try {
    const claims = req.principal!;
    res.status(200).json(await ritualStatus(claims.sub, claims.companyId));
  } catch (err) {
    next(err);
  }
});

const enrollSchema = z.object({});

authRouter.post("/ritual/enrollment", requireAuth, async (req, res, next) => {
  try {
    const parsed = enrollSchema.safeParse(req.body ?? {});
    if (req.body && Object.keys(req.body).length > 0 && !parsed.success) {
      throw AppError.unprocessable("Validation failed");
    }
    const claims = req.principal!;
    const result = await ritualEnrollment(claims.sub, claims.companyId, metaFrom(req));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

const verifyTotpSchema = z.object({
  code: z.string().min(6).max(6)
});

authRouter.post("/ritual/verify-authenticator", requireAuth, async (req, res, next) => {
  try {
    const parsed = verifyTotpSchema.safeParse(req.body);
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const claims = req.principal!;
    await ritualVerifyAuthenticator(claims.sub, claims.companyId, parsed.data.code, metaFrom(req));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const ritualChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
  // RULE 5.3.1.1 - the new password is confirmed twice.
  confirmPassword: z.string().min(1).max(200),
  totpCode: z.string().min(6).max(6)
}).refine((value) => value.newPassword === value.confirmPassword, {
  message: "The new password and its confirmation do not match",
  path: ["confirmPassword"]
});

authRouter.post("/ritual/change-password", requireAuth, async (req, res, next) => {
  try {
    const parsed = ritualChangeSchema.safeParse(req.body);
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const claims = req.principal!;
    await ritualChangePassword(
      claims.sub,
      claims.companyId,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      parsed.data.totpCode,
      metaFrom(req)
    );
    res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const completeProfileSchema = z.object({
  passportPhotoUrl: z.string().max(500).nullable().optional(),
  passportFileHash: z.string().max(128).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  birthDay: z.number().int().min(1).max(31).nullable().optional(),
  birthMonth: z.number().int().min(1).max(12).nullable().optional()
});

authRouter.post("/ritual/complete-profile", requireAuth, async (req, res, next) => {
  try {
    const parsed = completeProfileSchema.safeParse(req.body);
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const claims = req.principal!;
    const issued = await ritualCompleteProfile(
      claims.sub,
      claims.companyId,
      parsed.data,
      metaFrom(req)
    );
    setRefreshCookie(req, res, issued.refreshToken);
    res.status(200).json({
      accessToken: issued.accessToken,
      mustChangePassword: false,
      credentialState: issued.credentialState,
      principal: issued.principal
    });
  } catch (err) {
    next(err);
  }
});

// Guarded sample demonstrating the centralized session gate: full secured
// sessions only — credential-issued / ritual-in-progress holders are rejected
// until the mandatory ritual completes. Permission-verb enforcement is
// covered by requirePermission on business routes and the merge-engine tests.
authRouter.get("/session-check", requireAuth, requireCompleteSession, (_req, res) => {
  res.status(200).json({ ok: true });
});