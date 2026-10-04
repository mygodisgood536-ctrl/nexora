import { Router } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {  requireCompleteSession, requirePermission  } from "../../middleware/auth";
import { recordFaceCapture, listFaceCaptures, describeCaptureRejection, getFaceQualitySettings, updateFaceQualitySettings } from "../face-captures/service";
import { verifyFaceCaptureProof } from "../face-captures/proof";
import {
  createCustomer,
  getCustomer,
  getCustomerLoanHistory,
  getCustomerPortalAccess,
  listCustomers,
  setCustomerStatus,
  updateCustomerKyc,
  updateCustomerProfile,
} from "./service";

/**
 * Customer endpoints (Part 1 §22, Part 2 §26). All endpoints run inside
 * the caller's tenant session so RLS enforces company + branch isolation
 * automatically. Branch-scoped sessions are limited to their own branch
 * by the `rls_branch_scope` policy; explicit branch filters are honoured
 * for company-wide (head office) sessions.
 */

export const customersRouter = Router();

const faceQualitySchema = z.object({
  minBrightness: z.number().gt(0).max(1),
  minClarity: z.number().gt(0).max(1),
  requireFacePresent: z.boolean(),
  requireLiveness: z.boolean()
});

// RULE 19.5.2 - the quality controls a company enforces are readable, and
// changing them is a company setting change.
customersRouter.get(
  "/face-quality/settings",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json(await getFaceQualitySettings(actor(req)));
  })
);

customersRouter.put(
  "/face-quality/settings",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const parsed = faceQualitySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json({ thresholds: await updateFaceQualitySettings(actor(req), parsed.data, metaFrom(req)) });
  })
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actor(req: Request): { sub: string; companyId: string; branchId: string | null } {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function metaFrom(req: Request): { ip: string | null; userAgent: string | null; requestId: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
    requestId: req.header("x-request-id") ?? null,
  };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

const kycDocSchema = z.object({
  type: z.string().min(1).max(50),
  reference: z.string().min(1).max(200),
  confirmed: z.boolean().optional(),
});

/**
 * RULE 9.2.2 — the complete customer profile. `profile_complete` is computed
 * server-side from what was actually captured; the client never asserts it.
 */
const profileFields = {
  gender: z.enum(["male", "female"]).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateOfBirth must be YYYY-MM-DD").nullable().optional(),
  maritalStatus: z.enum(["single", "married", "divorced", "widowed"]).nullable().optional(),
  mothersMaidenName: z.string().max(120).nullable().optional(),
  alternativePhone: z.string().max(40).nullable().optional(),
  businessAddress: z.string().max(300).nullable().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
  identificationType: z.string().max(60).nullable().optional(),
  identificationNumber: z.string().max(120).nullable().optional(),
  bvn: z.string().regex(/^\d{11}$/, "bvn must be 11 digits").nullable().optional(),
  nin: z.string().regex(/^\d{11}$/, "nin must be 11 digits").nullable().optional(),
  occupation: z.string().max(120).nullable().optional(),
  businessType: z.string().max(120).nullable().optional(),
  estimatedIncome: z.number().nonnegative().nullable().optional(),
  nextOfKinName: z.string().max(120).nullable().optional(),
  nextOfKinRelationship: z.string().max(60).nullable().optional(),
  nextOfKinPhone: z.string().max(40).nullable().optional(),
  guarantorName: z.string().max(120).nullable().optional(),
  guarantorRelationship: z.string().max(60).nullable().optional(),
  guarantorPhone: z.string().max(40).nullable().optional(),
  guarantorAddress: z.string().max(300).nullable().optional()
};

const createSchema = z.object({
  branchId: z.string().regex(UUID_RE, "branchId must be a UUID"),
  firstName: z.string().min(1).max(80),
  middleName: z.string().max(80).nullable().optional(),
  lastName: z.string().min(1).max(80),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  address: z.string().min(4).max(300),
  kycDocuments: z.array(kycDocSchema).max(20).optional(),
  ...profileFields
});

const profileUpdateSchema = z.object({
  ...profileFields,
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  address: z.string().min(4).max(300).optional(),
  reason: z.string().min(5).max(500)
});

const faceCaptureSchema = z.object({
  applicationId: z.string().regex(UUID_RE, "applicationId must be a UUID").nullable().optional(),
  party: z.enum(["customer", "guarantor"]),
  purpose: z.enum(["registration", "loan_application"]),
  imageBase64: z.string().min(1).max(7_000_000),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  liveness: z.object({
    checked: z.boolean(),
    passed: z.boolean(),
    provider: z.string().min(1).max(120),
    checks: z.record(z.unknown()).optional()
  }),
  deviceMetadata: z.record(z.unknown()).optional(),
  location: z.record(z.unknown()).optional(),
  captureProof: z.object({
    jti: z.string().regex(UUID_RE, "capture proof jti must be a UUID"),
    issuedAt: z.number().int().positive(),
    signature: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/)
  })
});

customersRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("register_customer"),
  wrap(async (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const created = await createCustomer(actor(req), parsed.data, metaFrom(req));
    res.status(201).json(created);
  })
);

customersRouter.get(
  "/:id/face-captures",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    res.json(await listFaceCaptures(actor(req), id));
  })
);

customersRouter.post(
  "/:id/face-captures",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    const parsed = faceCaptureSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const body = parsed.data;
    const applicationId = body.applicationId ?? null;
    const imageBytes = Buffer.from(body.imageBase64, "base64");
    const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
    const liveness = {
      checked: body.liveness.checked,
      passed: body.liveness.passed,
      provider: body.liveness.provider,
      ...(body.liveness.checks ? { checks: body.liveness.checks } : {})
    };
    const proofData = {
      customerId: id,
      applicationId,
      party: body.party,
      purpose: body.purpose,
      mimeType: body.mimeType,
      imageSha256,
      liveness,
      deviceMetadata: body.deviceMetadata ?? {},
      location: body.location ?? {}
    };
    if (!verifyFaceCaptureProof(proofData, body.captureProof)) {
      throw AppError.forbidden("The face capture proof is invalid or expired");
    }
    const capture = await recordFaceCapture(actor(req), {
      customerId: id,
      applicationId,
      party: body.party,
      purpose: body.purpose,
      bytes: imageBytes,
      mimeType: body.mimeType,
      liveness,
      deviceMetadata: body.deviceMetadata,
      location: body.location,
      expectedImageSha256: imageSha256,
      captureProofId: body.captureProof.jti
    }, metaFrom(req));
    // RULE 9.4.4 — the rejected attempt is retained as immutable evidence, and
    // the worker is told exactly why it failed and must recapture.
    const rejection = describeCaptureRejection(capture);
    if (rejection) throw AppError.unprocessable(rejection);
    res.status(201).json(capture);
  })
);

customersRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const branchId = typeof req.query.branchId === "string" ? req.query.branchId : null;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const search = typeof req.query.search === "string" ? req.query.search : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const result = await listCustomers(actor(req), { branchId, status, search, limit, offset });
    res.json(result);
  })
);

// RULE 9.2.2 / 9.2.3 — complete or amend a customer's profile. Completeness is
// recomputed from the merged profile; the response names what is still missing.
customersRouter.patch(
  "/:id/profile",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    const parsed = profileUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const { reason, ...patch } = parsed.data;
    res.json(await updateCustomerProfile(actor(req), id, patch, reason, metaFrom(req)));
  })
);

customersRouter.get(
  "/:id",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    res.json(await getCustomer(actor(req), id));
  })
);

customersRouter.get(
  "/:id/loan-history",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    res.json(await getCustomerLoanHistory(actor(req), id));
  })
);

// Part 1 §22 — the C.O. dashboard reads a customer's provisioned portal
// credentials (issued at loan disbursement together with the VA).
customersRouter.get(
  "/:id/portal-access",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    res.json(await getCustomerPortalAccess(actor(req), id));
  })
);

const kycUpdateSchema = z.object({
  kycDocuments: z.array(kycDocSchema).max(20).optional(),
  kycComplete: z.boolean(),
  reason: z.string().max(500).nullable().optional(),
});

customersRouter.put(
  "/:id/kyc",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    const parsed = kycUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(
      await updateCustomerKyc(
        actor(req),
        { customerId: id, ...parsed.data },
        metaFrom(req)
      )
    );
  })
);

const statusSchema = z.object({
  action: z.enum(["suspend", "reactivate", "close"]),
  reason: z.string().min(1).max(500),
});

customersRouter.post(
  "/:id/status",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid customer id");
    const parsed = statusSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(
      await setCustomerStatus(
        actor(req),
        { customerId: id, ...parsed.data },
        metaFrom(req)
      )
    );
  })
);

