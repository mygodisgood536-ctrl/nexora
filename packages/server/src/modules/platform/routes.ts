import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {
  closeSupportSession,
  companySummary,
  createAnnouncement,
  createCompany,
  getGlobalSettings,
  listAnnouncements,
  listCompanies,
  listPlatformAudit,
  listSupportSessions,
  openSupportSession,
  poLogin,
  poLogout,
  poRefresh,
  putGlobalSetting,
  setAnnouncementStatus,
  setCompanyStatus,
  verifyPoToken
} from "./service";

export const platformRouter = Router();

const PO_COOKIE = "nxp_refresh";

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return undefined;
}

function requirePo(req: Request): { sub: string; email: string } {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw AppError.unauthorized();
  const claims = verifyPoToken(header.slice(7));
  return { sub: claims.sub, email: claims.email };
}

function authed(
  handler: (po: { sub: string; email: string }, req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    try {
      const po = requirePo(req);
      handler(po, req, res).catch(next);
    } catch (err) {
      next(err);
    }
  };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional()
});

platformRouter.get("/healthz", wrap(async (_req, res) => {
  void _req;
  res.status(200).json({ status: "ok", service: "nexora-platform-api" });
}));

platformRouter.post("/auth/login", wrap(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  const session = await poLogin(parsed.data.email, parsed.data.password, parsed.data.totp, {
    ip: req.ip,
    userAgent: req.headers["user-agent"]
  });
  res.cookie(PO_COOKIE, session.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/platform/v1",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  res.status(200).json({ accessToken: session.accessToken, owner: session.owner });
}));

platformRouter.post("/auth/refresh", wrap(async (req, res) => {
  const result = await poRefresh(readCookie(req, PO_COOKIE) ?? req.body?.refreshToken);
  res.cookie(PO_COOKIE, result.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/platform/v1",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  res.status(200).json({ accessToken: result.accessToken, owner: result.owner });
}));

platformRouter.post("/auth/logout", wrap(async (req, res) => {
  await poLogout(readCookie(req, PO_COOKIE));
  res.clearCookie(PO_COOKIE, { path: "/platform/v1" });
  res.status(204).end();
}));

platformRouter.get("/me", authed(async (po, _req, res) => {
  void _req;
  res.json({ ownerId: po.sub, email: po.email });
}));

const companySchema = z.object({
  name: z.string().min(2).max(100),
  codePrefix: z.string().regex(/^[A-Za-z]{3,6}$/),
  contactEmail: z.string().email().optional(),
  planTier: z.string().max(40).optional()
});

platformRouter.get("/companies", authed(async (_po, _req, res) => {
  void _po; void _req;
  res.json(await listCompanies());
}));

platformRouter.post("/companies", authed(async (po, req, res) => {
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", "Validation failed",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  res.status(201).json(await createCompany(po.email, parsed.data));
}));

const statusSchema = z.object({
  action: z.enum(["submit_for_activation", "activate", "suspend", "reactivate"]),
  reason: z.string().max(500).optional()
});

platformRouter.post("/companies/:id/status", authed(async (po, req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  res.json(await setCompanyStatus(po.email, String(req.params.id), parsed.data.action, parsed.data.reason));
}));

platformRouter.get("/global-settings", authed(async (_po, _req, res) => {
  void _po; void _req;
  res.json(await getGlobalSettings());
}));

platformRouter.put("/global-settings/:key", authed(async (po, req, res) => {
  await putGlobalSetting(po.email, String(req.params.key), req.body?.value);
  res.status(204).end();
}));

platformRouter.get("/announcements", authed(async (_po, _req, res) => {
  void _po; void _req;
  res.json(await listAnnouncements());
}));

platformRouter.post("/announcements", authed(async (po, req, res) => {
  const schema = z.object({
    title: z.string().min(2).max(200),
    body: z.string().min(2).max(4000),
    severity: z.enum(["info", "warning", "critical"])
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  res.status(201).json(await createAnnouncement(po.email, parsed.data));
}));

platformRouter.post("/announcements/:id/:status", authed(async (po, req, res) => {
  const status = req.params.status;
  if (status !== "active" && status !== "expired") {
    throw AppError.badRequest("Status must be active or expired");
  }
  await setAnnouncementStatus(po.email, String(req.params.id), status);
  res.status(204).end();
}));

platformRouter.get("/support-access", authed(async (_po, _req, res) => {
  void _po; void _req;
  res.json(await listSupportSessions());
}));

platformRouter.post("/support-access", authed(async (po, req, res) => {
  const schema = z.object({
    companyId: z.string().uuid(),
    reason: z.string().min(10).max(500),
    durationMinutes: z.number().int().min(5).max(480)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  res.status(201).json(
    await openSupportSession(po.email, parsed.data.companyId, parsed.data.reason, parsed.data.durationMinutes)
  );
}));

platformRouter.post("/support-access/:id/close", authed(async (po, req, res) => {
  await closeSupportSession(po.email, String(req.params.id));
  res.status(204).end();
}));

// Aggregate-only drill-down; requires an OPEN support session for the company.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

platformRouter.get("/companies/:id/summary", authed(async (po, req, res) => {
  const sessionId = (req.query.sessionId as string | undefined) ?? "";
  const companyId = String(req.params.id);
  if (!UUID_RE.test(sessionId) || !UUID_RE.test(companyId)) {
    // Malformed ids can never match an open session: fail closed with the
    // same envelope as a missing session rather than a 500.
    res.status(403).json({
      error: { code: "SUPPORT_SESSION_REQUIRED", message: "No open support access session" }
    });
    return;
  }
  res.json(await companySummary(po.email, sessionId, companyId));
}));

platformRouter.get("/audit", authed(async (_po, req, res) => {
  void _po;
  const limit = Number(req.query.limit ?? 100);
  res.json(await listPlatformAudit(Number.isFinite(limit) ? limit : 100));
}));
