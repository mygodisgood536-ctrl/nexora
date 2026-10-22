import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {
  closeSupportSession,
  companySummary,
  createAnnouncement,
  createCompany,
  getCompanyDetail,
  getCompanyTheme,
  getGlobalSettings,
  listAnnouncements,
  listCompanies,
  listCompanyBranches,
  listEnabledRoles,
  listPlatformAudit,
  listSupportSessions,
  openSupportSession,
  poAuthenticatorStatus,
  poBeginAuthenticatorSetup,
  poLogin,
  poLogout,
  poRefresh,
  poVerifyAuthenticator,
  putGlobalSetting,
  saveCompanyDraft,
  discardCompanyDraft,
  setAnnouncementStatus,
  setCompanyStatus,
  setEnabledRoles,
  updateCompanyTheme,
  verifyPoToken
} from "./service";
import {
  activateConfiguration,
  createConfiguration,
  listCompanyConfigurations,
  listFreeModels as listAiFreeModels,
  listProviderModels as listAiProviderModels,
  listProviders as listAiProviders,
  revokeConfiguration,
  verifyConfiguration
} from "../company-ai/config-service";

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
  await poLogout(readCookie(req, PO_COOKIE) ?? req.body?.refreshToken);
  res.clearCookie(PO_COOKIE, { path: "/platform/v1" });
  res.status(204).end();
}));

// RULE 14.1.1 / 14.2.1 - the owner's authenticator enrolment path.
// These two endpoints close Vision finding F-01: before them there was no way
// for the Platform Owner to hold an authenticator at all, while the vision
// states the owner "is not exempt from security". Login refuses to issue a
// session until enrolment completes, so this is the only way forward.
const poPasswordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

platformRouter.post("/auth/authenticator/setup", wrap(async (req, res) => {
  const parsed = poPasswordSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  const result = await poBeginAuthenticatorSetup(parsed.data.email, parsed.data.password, {
    ip: req.ip,
    userAgent: req.headers["user-agent"]
  });
  // The seed is returned exactly once, to the person enrolling. RULE 14.5.1:
  // it is never logged, never emailed and never retrievable again.
  res.status(201).json(result);
}));

platformRouter.post("/auth/authenticator/verify", wrap(async (req, res) => {
  const parsed = poPasswordSchema.extend({ code: z.string().min(6).max(6) }).safeParse(req.body);
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  await poVerifyAuthenticator(parsed.data.email, parsed.data.password, parsed.data.code, {
    ip: req.ip,
    userAgent: req.headers["user-agent"]
  });
  res.status(200).json({ enrolled: true });
}));

platformRouter.get("/auth/authenticator/status", wrap(async (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email : "";
  if (!email) throw AppError.badRequest("email is required");
  res.json(await poAuthenticatorStatus(email));
}));

platformRouter.get("/me", authed(async (po, _req, res) => {
  void _req;
  res.json({ ownerId: po.sub, email: po.email });
}));

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be #RRGGBB");
const urlish = z.string().max(500).regex(/^(https:\/\/|\/)/, "must be https:// or root-relative");

const brandingSchema = z
  .object({
    primaryColor: hexColor.optional(),
    secondaryColor: hexColor.optional(),
    accentColor: hexColor.optional(),
    navyColor: hexColor.optional(),
    logoUrl: urlish.nullable().optional(),
    loginBackgroundUrl: urlish.nullable().optional(),
    fontFamily: z.string().regex(/^[A-Za-z0-9 _-]{2,60}$/).optional()
  })
  .strict();

const companySchema = z.object({
  name: z.string().min(2).max(100),
  codePrefix: z.string().regex(/^[A-Za-z]{3,6}$/),
  contactEmail: z.string().email().optional(),
  planTier: z.string().max(40).optional(),
  // RULE 3.3.1 — the create-company form requires the MD's full name (it
  // becomes the MD's username) and the MD's phone number. The MD's email is
  // optional and is never a login credential.
  mdFullName: z.string().min(3).max(120),
  mdPhone: z.string().min(4).max(40),
  mdEmail: z.string().email().max(200).optional(),
  // RULE 5.7.4 — only the day and month of birth are ever collected or stored.
  mdBirthDay: z.number().int().min(1).max(31).optional(),
  mdBirthMonth: z.number().int().min(1).max(12).optional(),
  branding: brandingSchema.optional(),
  enabledRoleKeys: z.array(z.string()).optional(),
  // RULE 3.3.1 - the company's own optional domain. It is recorded as
  // UNVERIFIED: DNS ownership is proven out of band, and until then the address
  // must never resolve. A domain that is already claimed is rejected.
  domain: z
    .string()
    .max(253)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
      "domain must be a valid hostname such as loans.example.com"
    )
    .optional(),
  // RULE 3.3.3 - completing a previously saved draft.
  draftId: z.string().uuid().optional()
});

// RULE 3.3.3 — a draft holds whatever the wizard has collected so far, so
// every field (beyond nothing at all) is optional here.
const draftSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  codePrefix: z.string().regex(/^[A-Za-z]{3,6}$/).optional(),
  contactEmail: z.string().email().optional(),
  planTier: z.string().max(40).optional(),
  branding: brandingSchema.optional(),
  domain: z
    .string()
    .max(253)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
      "domain must be a valid hostname such as loans.example.com"
    )
    .optional()
});

// RULE 3.6.6 - search, filter, sort and paginate the Companies workspace.
platformRouter.get("/companies", authed(async (_po, req, res) => {
  void _po;
  const q = req.query as Record<string, string | undefined>;
  res.json(
    await listCompanies({
      search: q.search ?? null,
      status: q.status ?? null,
      sort: q.sort ?? null,
      order: q.order === "asc" ? "asc" : q.order === "desc" ? "desc" : null,
      limit: q.limit ? Number(q.limit) : null,
      offset: q.offset ? Number(q.offset) : null
    })
  );
}));

// RULE 3.6.4 - the Company Detail workspace for exactly the selected company.
platformRouter.get("/companies/:id/detail", authed(async (_po, req, res) => {
  void _po;
  res.json(await getCompanyDetail(uuidParam(req)));
}));

// RULE 3.3.3 — draft lifecycle: save, resume, discard. A draft company sits in
// "In setup" status and cannot be logged into; the login path already refuses
// any company whose status is not `active`.
platformRouter.post("/companies/draft", authed(async (po, req, res) => {
  const parsed = draftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", "Validation failed",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  res.status(201).json(await saveCompanyDraft(po.email, parsed.data));
}));

platformRouter.get("/companies/drafts", authed(async (_po, _req, res) => {
  res.json(await listCompanies({ status: "in_setup", limit: 100, offset: 0 }));
}));

platformRouter.put("/companies/drafts/:id", authed(async (po, req, res) => {
  const parsed = draftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", "Validation failed",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  res.json(await saveCompanyDraft(po.email, parsed.data, uuidParam(req)));
}));

platformRouter.delete("/companies/drafts/:id", authed(async (po, req, res) => {
  await discardCompanyDraft(po.email, uuidParam(req));
  res.status(204).end();
}));

platformRouter.post("/companies", authed(async (po, req, res) => {
  // RULE 3.3.3 — `?draft=true` saves a draft. It must never silently create a
  // live company, which is exactly what it used to do (ISS-004).
  if (String((req.query as Record<string, unknown>).draft) === "true") {
    const parsed = draftSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(422, "VALIDATION_ERROR", "Validation failed",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    res.status(201).json(await saveCompanyDraft(po.email, parsed.data));
    return;
  }
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", "Validation failed",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  res.status(201).json(
    await createCompany(po.email, parsed.data, { draftId: parsed.data.draftId })
  );
}));

const statusSchema = z.object({
  action: z.enum(["submit_for_activation", "activate", "suspend", "reactivate"]),
  reason: z.string().max(500).optional()
});

platformRouter.post("/companies/:id/status", authed(async (po, req, res) => {
  // ISS-005 — a malformed id is the caller's mistake (400), never a Postgres
  // 22P02 escaping as a 500.
  const id = uuidParam(req);
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  res.json(await setCompanyStatus(po.email, id, parsed.data.action, parsed.data.reason));
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

platformRouter.get("/companies/:id/branches", authed(async (_po, req, res) => {
  void _po;
  res.json(await listCompanyBranches(uuidParam(req)));
}));

platformRouter.get("/audit", authed(async (_po, req, res) => {
  void _po;
  const limit = Number(req.query.limit ?? 100);
  res.json(await listPlatformAudit(Number.isFinite(limit) ? limit : 100));
}));

// ---------- branding & enabled roles (Part 1 §26; PO Spec §8/§9/§10) ----------

const uuidParam = (req: Request): string => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid company id");
  return id;
};

platformRouter.get("/companies/:id/theme", authed(async (_po, req, res) => {
  void _po;
  res.json(await getCompanyTheme(uuidParam(req)));
}));

platformRouter.put("/companies/:id/theme", authed(async (po, req, res) => {
  const parsed = brandingSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", "Validation failed",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const row = await updateCompanyTheme(po.email, uuidParam(req), parsed.data);
  res.json(row);
}));

platformRouter.get("/companies/:id/enabled-roles", authed(async (_po, req, res) => {
  void _po;
  res.json(await listEnabledRoles(uuidParam(req)));
}));

const enabledRolesSchema = z.object({ enabledRoleKeys: z.array(z.string().min(1)).max(32) });

platformRouter.put("/companies/:id/enabled-roles", authed(async (po, req, res) => {
  const parsed = enabledRolesSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  const result = await setEnabledRoles(po.email, uuidParam(req), parsed.data.enabledRoleKeys);
  res.json(result);
}));

// ---------------------------------------------------------------------------
// RULE 21.1.9 - the Platform Owner selects a company's AI provider and model.
// Every list below is what OpenCode reports right now; none is stored here.
// ---------------------------------------------------------------------------

platformRouter.get("/ai/free-models", authed(async (_po, _req, res) => {
  void _po;
  res.json(await listAiFreeModels());
}));

platformRouter.get("/ai/providers", authed(async (_po, _req, res) => {
  void _po;
  res.json(await listAiProviders());
}));

platformRouter.get("/ai/providers/:providerId/models", authed(async (_po, req, res) => {
  void _po;
  res.json(await listAiProviderModels(String(req.params.providerId)));
}));

const aiConfigurationSchema = z.object({
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(400).nullable().optional()
});

platformRouter.get("/companies/:id/ai-configuration", authed(async (po, req, res) => {
  res.json(await listCompanyConfigurations(po.email, uuidParam(req)));
}));

platformRouter.post("/companies/:id/ai-configuration", authed(async (po, req, res) => {
  const parsed = aiConfigurationSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  res.status(201).json(
    await createConfiguration(po.email, uuidParam(req), parsed.data)
  );
}));

platformRouter.post("/ai-configuration/:id/verify", authed(async (po, req, res) => {
  res.json(await verifyConfiguration(po.email, String(req.params.id)));
}));

platformRouter.post("/ai-configuration/:id/activate", authed(async (po, req, res) => {
  res.json(await activateConfiguration(po.email, String(req.params.id)));
}));

const revokeSchema = z.object({ reason: z.string().min(3).max(500) });

platformRouter.post("/companies/:id/ai-configuration/:configurationId/revoke", authed(async (po, req, res) => {
  const parsed = revokeSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw AppError.unprocessable("Validation failed");
  res.json(await revokeConfiguration(po.email, uuidParam(req), String(req.params.configurationId), parsed.data.reason));
}));
