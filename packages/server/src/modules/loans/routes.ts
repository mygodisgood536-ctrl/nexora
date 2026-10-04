// Stage 7C - Lending domain REST endpoints (Part 1 Section 23).
// All endpoints are RLS-scoped via the caller's tenant session.
import { Router } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import {  requireCompleteSession, requirePermission  } from "../../middleware/auth";
import {
  createApplication,
  createApprovalChain,
  createLoanProduct,
  decideApplication,
  disburse,
  getApplication,
  getApplicationPreview,
  getActiveApplicationGuarantor,
  getApplicationPartyInformation,
  getMyApprovalQueue,
  getDisbursementHold,
  listDisbursementHolds,
  listApplicationGuarantors,
  saveApplicationGuarantor,
  saveApplicationPartyInformation,
  getApplicationBankDetails,
  getApplicationFees,
  getApplicationStages,
  getApplicationTerms,
  getApprovalChainSteps,
  listApplications,
  listApprovalChains,
  listLoanProducts,
  withdrawApplication,
  resubmitApplication,
  saveApplicationBankDetails,
  saveApplicationTerms,
  saveApplicationFee,
  saveApplicationStage,
} from "./service";
import {
  uploadDocument,
  listDocuments,
  confirmDocument,
  createCreditAssessment,
  listCreditAssessments,
  type LoanDocumentRow
} from "./documents";
import {
  createPendingEvidenceUpload,
  listLoanApplicationEvidence,
  listPendingEvidenceUploads,
  markPendingEvidenceUploadFailed,
  recordLoanApplicationEvidence
} from "../loan-evidence/service";
import { verifyLiveEvidenceProof } from "../face-captures/proof";

export const loansRouter = Router();
export const loanProductsRouter = Router();
export const approvalChainsRouter = Router();
export const loanApplicationsRouter = Router();
export const loanDisbursementsRouter = Router();

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

// Numeric field: accept either a JSON number or a numeric string,
// reject everything else. Schema-level transform is simpler than
// a top-level refine and matches the rest of the modules' style.
const numericString = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected a numeric value" });
    return z.NEVER;
  }
  return n;
});

const productSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).nullable().optional(),
  minPrincipal: numericString,
  maxPrincipal: numericString,
  interestRate: numericString,
  interestMethod: z.string().max(40).nullable().optional(),
  cycleDays: numericString,
  cycleCount: numericString,
  expectedRepaymentPerCycle: numericString,
  expectedSavingsPerCycle: numericString,
  approvalChainId: z.string().regex(UUID_RE, "approvalChainId must be a UUID"),
});

loanProductsRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const parsed = productSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await createLoanProduct(actor(req), parsed.data, metaFrom(req)));
  })
);

loanProductsRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const activeOnly = req.query.activeOnly === "true";
    res.json(await listLoanProducts(actor(req), { activeOnly }));
  })
);
const chainStepSchema = z.object({
  stageOrder: numericString,
  stepName: z.string().min(1).max(100),
  roleId: z.string().regex(UUID_RE, "roleId must be a UUID"),
  mandatory: z.boolean().optional()
});

const chainSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).nullable().optional(),
  onRejection: z.enum(["return_to_applicant", "previous_stage"]).optional(),
  steps: z.array(chainStepSchema).min(1),
});

approvalChainsRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const parsed = chainSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await createApprovalChain(actor(req), parsed.data, metaFrom(req)));
  })
);

approvalChainsRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json(await listApprovalChains(actor(req)));
  })
);

approvalChainsRouter.get(
  "/:id/steps",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid chain id");
    res.json(await getApprovalChainSteps(actor(req), id));
  })
);

const pendingUploadSchema = z.object({
  party: z.enum(["customer", "guarantor"]),
  evidenceType: z.enum(["government_id", "house", "business", "loan_form", "default_form"]),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/i),
  objectIdentifier: z.string().min(1).max(300)
});

const evidenceSchema = z.object({
  evidenceType: z.enum(["government_id", "house", "business", "loan_form", "default_form"]),
  party: z.enum(["customer", "guarantor"]),
  identityName: z.string().min(2).max(200).nullable().optional(),
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
  pendingUploadId: z.string().regex(UUID_RE, "pendingUploadId must be a UUID").nullable().optional(),
  captureProof: z.object({
    jti: z.string().regex(UUID_RE, "capture proof jti must be a UUID"),
    issuedAt: z.number().int().positive(),
    signature: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/)
  })
});

const feeSchema = z.object({
  feeType: z.string().min(2).max(80),
  amount: z.number().nonnegative(),
  status: z.enum(["obligation", "waived", "pending_payment"])
});

const stageSchema = z.object({
  status: z.enum(["draft", "saved", "completed"]),
  payload: z.record(z.unknown())
});

const bankDetailsSchema = z.object({
  bankName: z.string().min(2).max(120),
  accountNumber: z.string().min(8).max(34),
  accountName: z.string().min(2).max(200),
  identityName: z.string().min(2).max(200)
});

const applicationSchema = z.object({
  customerId: z.string().regex(UUID_RE, "customerId must be a UUID"),
  productId: z.string().regex(UUID_RE, "productId must be a UUID"),
  principalAmount: numericString,
  repaymentMode: z.enum(["weekly", "daily"]).optional(),
  repaymentWeekday: z.number().int().min(0).max(6).nullable().optional(),
  repaymentPeriods: z.number().int().positive().optional(),
  interestPercentage: z.number().nonnegative().optional(),
  repaymentAmount: z.number().positive().optional()
});

loanApplicationsRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const parsed = applicationSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const body = parsed.data;
    const termValues = [
      body.repaymentMode,
      body.repaymentWeekday,
      body.repaymentPeriods,
      body.interestPercentage,
      body.repaymentAmount
    ];
    const hasTerms = termValues.some((value) => value !== undefined);
    const input = hasTerms
      ? {
          customerId: body.customerId,
          productId: body.productId,
          principalAmount: body.principalAmount,
          terms: {
            repaymentMode: body.repaymentMode!,
            repaymentWeekday: body.repaymentWeekday,
            repaymentPeriods: body.repaymentPeriods!,
            interestPercentage: body.interestPercentage!,
            repaymentAmount: body.repaymentAmount!
          }
        }
      : {
          customerId: body.customerId,
          productId: body.productId,
          principalAmount: body.principalAmount
        };
    if (hasTerms && (
      body.repaymentMode === undefined ||
      body.repaymentPeriods === undefined ||
      body.interestPercentage === undefined ||
      body.repaymentAmount === undefined
    )) {
      throw AppError.unprocessable("All loan-term fields are required when terms are supplied");
    }
    res.status(201).json(await createApplication(actor(req), input, metaFrom(req)));
  })
);

const termsSchema = z.object({
  repaymentMode: z.enum(["weekly", "daily"]),
  repaymentWeekday: z.number().int().min(0).max(6).nullable().optional(),
  repaymentPeriods: z.number().int().positive(),
  interestPercentage: z.number().nonnegative(),
  repaymentAmount: z.number().positive()
});

loanApplicationsRouter.put(
  "/:id/terms",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = termsSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await saveApplicationTerms(actor(req), { applicationId: id, ...parsed.data }, metaFrom(req)));
  })
);

loanApplicationsRouter.put(
  "/:id/bank-details",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = bankDetailsSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await saveApplicationBankDetails(actor(req), { applicationId: id, ...parsed.data }, metaFrom(req)));
  })
);

loanApplicationsRouter.get(
  "/:id/bank-details",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await getApplicationBankDetails(actor(req), id));
  })
);

loanApplicationsRouter.put(
  "/:id/fees",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = feeSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await saveApplicationFee(actor(req), { applicationId: id, ...parsed.data }, metaFrom(req)));
  })
);

loanApplicationsRouter.get(
  "/:id/fees",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await getApplicationFees(actor(req), id));
  })
);

loanApplicationsRouter.post(
  "/:id/evidence-uploads",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = pendingUploadSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await createPendingEvidenceUpload(actor(req), id, parsed.data, metaFrom(req)));
  })
);

loanApplicationsRouter.get(
  "/:id/evidence-uploads",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await listPendingEvidenceUploads(actor(req), id));
  })
);

loanApplicationsRouter.patch(
  "/:id/evidence-uploads/:uploadId/fail",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    const uploadId = String(req.params.uploadId);
    if (!UUID_RE.test(id) || !UUID_RE.test(uploadId)) throw AppError.badRequest("Invalid upload id");
    const reason = String((req.body ?? {}).reason ?? "");
    res.json(await markPendingEvidenceUploadFailed(actor(req), uploadId, reason, metaFrom(req), id));
  })
);

loanApplicationsRouter.post(
  "/:id/evidence",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = evidenceSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const body = parsed.data;
    const application = await getApplication(actor(req), id);
    const imageBytes = Buffer.from(body.imageBase64, "base64");
    const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
    const liveness = {
      checked: body.liveness.checked,
      passed: body.liveness.passed,
      provider: body.liveness.provider,
      ...(body.liveness.checks ? { checks: body.liveness.checks } : {})
    };
    const proofData = {
      customerId: application.customer_id,
      applicationId: id,
      party: body.party,
      evidenceType: body.evidenceType,
      identityName: body.identityName ?? null,
      mimeType: body.mimeType,
      imageSha256,
      liveness,
      deviceMetadata: body.deviceMetadata ?? {},
      location: body.location ?? {}
    };
    if (!verifyLiveEvidenceProof(proofData, body.captureProof)) {
      throw AppError.forbidden("The live evidence proof is invalid or expired");
    }
    res.status(201).json(await recordLoanApplicationEvidence(actor(req), {
      applicationId: id,
      evidenceType: body.evidenceType,
      party: body.party,
      identityName: body.identityName ?? null,
      bytes: imageBytes,
      mimeType: body.mimeType,
      liveness,
      deviceMetadata: body.deviceMetadata,
      location: body.location,
      expectedImageSha256: imageSha256,
      captureProofId: body.captureProof.jti,
      pendingUploadId: body.pendingUploadId ?? null
    }, metaFrom(req)));
  })
);

loanApplicationsRouter.get(
  "/:id/evidence",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await listLoanApplicationEvidence(actor(req), id));
  })
);

loanApplicationsRouter.put(
  "/:id/stages/:stageKey",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    const stageKey = String(req.params.stageKey) as Parameters<typeof saveApplicationStage>[2]["stageKey"];
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = stageSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await saveApplicationStage(
      actor(req),
      id,
      { stageKey, status: parsed.data.status, payload: parsed.data.payload },
      metaFrom(req)
    ));
  })
);

loanApplicationsRouter.get(
  "/:id/stages",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await getApplicationStages(actor(req), id));
  })
);

loanApplicationsRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listApplications(actor(req), { status, customerId, limit, offset }));
  })
);

loanApplicationsRouter.get(
  "/:id/terms",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await getApplicationTerms(actor(req), id));
  })
);

loanApplicationsRouter.get(
  "/:id/preview",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await getApplicationPreview(actor(req), id));
  })
);

loanApplicationsRouter.get(
  "/:id",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await getApplication(actor(req), id));
  })
);

const withdrawSchema = z.object({ reason: z.string().min(1).max(500) });

loanApplicationsRouter.post(
  "/:id/withdraw",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = withdrawSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await withdrawApplication(actor(req), id, parsed.data.reason, metaFrom(req)));
  })
);

// RULE 10.3.4 — an application returned to the applicant is never a dead end.
const resubmitSchema = z.object({ reason: z.string().min(1).max(500).optional() });

loanApplicationsRouter.post(
  "/:id/resubmit",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = resubmitSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await resubmitApplication(actor(req), id, parsed.data.reason ?? null, metaFrom(req)));
  })
);

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject", "request_information"]),
  reason: z.string().min(1).max(500),
});

loanApplicationsRouter.post(
  "/:id/decide",
  requireCompleteSession,
  requirePermission(["approve", "reject"]),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await decideApplication(actor(req), { applicationId: id, ...parsed.data }, metaFrom(req)));
  })
);

loanApplicationsRouter.get(
  "/approvals/mine",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json(await getMyApprovalQueue(actor(req)));
  })
);

const guarantorSchema = z.object({
  fullName: z.string().min(2).max(200),
  relationship: z.string().min(2).max(80),
  phone: z.string().min(3).max(40),
  address: z.string().min(2).max(400),
  occupation: z.string().max(120).nullable().optional(),
  houseAddress: z.string().max(400).nullable().optional(),
  street: z.string().max(200).nullable().optional(),
  directionToHouse: z.string().max(400).nullable().optional(),
  localAreaKnownAs: z.string().max(200).nullable().optional(),
  shopAddress: z.string().max(400).nullable().optional(),
  childName: z.string().max(200).nullable().optional(),
  averageDailyIncome: z.number().nonnegative().nullable().optional(),
  averageMonthlyIncome: z.number().nonnegative().nullable().optional(),
  identificationType: z.string().max(80).nullable().optional(),
  identificationNumber: z.string().max(120).nullable().optional()
});

loanApplicationsRouter.put(
  "/:id/guarantor",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = guarantorSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await saveApplicationGuarantor(actor(req), { applicationId: id, ...parsed.data }, metaFrom(req)));
  })
);

loanApplicationsRouter.get(
  "/:id/guarantor",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json({
      guarantor: await getActiveApplicationGuarantor(actor(req), id),
      history: await listApplicationGuarantors(actor(req), id)
    });
  })
);

const partyInformationSchema = z.object({
  party: z.enum(["customer", "guarantor"]),
  nextOfKinName: z.string().max(200).nullable().optional(),
  nextOfKinRelationship: z.string().max(80).nullable().optional(),
  nextOfKinPhone: z.string().max(40).nullable().optional(),
  occupation: z.string().max(120).nullable().optional(),
  houseAddress: z.string().max(400).nullable().optional(),
  street: z.string().max(200).nullable().optional(),
  directionToHouse: z.string().max(400).nullable().optional(),
  childName: z.string().max(200).nullable().optional(),
  localAreaKnownAs: z.string().max(200).nullable().optional(),
  shopAddress: z.string().max(400).nullable().optional(),
  averageDailyIncome: z.number().nonnegative().nullable().optional(),
  averageMonthlyIncome: z.number().nonnegative().nullable().optional()
});

loanApplicationsRouter.put(
  "/:id/party-information",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = partyInformationSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json(await saveApplicationPartyInformation(actor(req), { applicationId: id, ...parsed.data }, metaFrom(req)));
  })
);

loanApplicationsRouter.get(
  "/:id/party-information",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await getApplicationPartyInformation(actor(req), id));
  })
);

const holdListSchema = z.object({
  status: z.enum(["virtual_account_pending", "resolved", "abandoned"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

loanDisbursementsRouter.get(
  "/holds",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const parsed = holdListSchema.safeParse(req.query ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.json({ holds: await listDisbursementHolds(actor(req), parsed.data) });
  })
);

loanDisbursementsRouter.get(
  "/holds/:applicationId",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    if (!UUID_RE.test(applicationId)) throw AppError.badRequest("Invalid application id");
    const hold = await getDisbursementHold(actor(req), applicationId);
    if (!hold) throw AppError.notFound("No disbursement hold for this application");
    res.json(hold);
  })
);

const disburseSchema = z.object({
  applicationId: z.string().regex(UUID_RE, "applicationId must be a UUID"),
  reason: z.string().min(1).max(500).optional(),
});

loanDisbursementsRouter.post(
  "/",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const parsed = disburseSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await disburse(actor(req), parsed.data, metaFrom(req)));
  })
);

// ------------------------------------------------------------------
// Part 1 Section 23 — Document Collection and the Credit Assessment
// stage. These are part of the loan lifecycle and must be reachable over
// HTTP; the services existed but were never mounted, so the stage could not
// actually be performed by a user.
// ------------------------------------------------------------------

const documentUploadSchema = z.object({
  docType: z.string().min(1).max(80),
  fileUrl: z.string().min(1).max(2000),
  // RULE 19.7 / 20.1.2 — content identity captured at upload, immutable after.
  fileSha256: z.string().min(8).max(200).nullable().optional(),
  fileSizeBytes: z.number().int().positive().nullable().optional(),
  mimeType: z.string().min(3).max(120).nullable().optional()
});

loanApplicationsRouter.post(
  "/:id/documents",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = documentUploadSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    res.status(201).json(await uploadDocument(actor(req), { ...parsed.data, applicationId: id }, metaFrom(req)));
  })
);

loanApplicationsRouter.get(
  "/:id/documents",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const rows: LoanDocumentRow[] = await listDocuments(actor(req), id);
    res.json(rows);
  })
);

loanApplicationsRouter.post(
  "/:id/documents/:documentId/confirm",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    const documentId = String(req.params.documentId);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    if (!UUID_RE.test(documentId)) throw AppError.badRequest("Invalid document id");
    res.json(await confirmDocument(actor(req), documentId, metaFrom(req)));
  })
);

const creditAssessmentSchema = z.object({
  decision: z.enum(["approve", "reject", "request_information"]),
  reason: z.string().min(1).max(1000)
});

loanApplicationsRouter.post(
  "/:id/credit-assessments",
  requireCompleteSession,
  requirePermission("create"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    const parsed = creditAssessmentSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw AppError.unprocessable("Validation failed");
    const { decision, reason } = parsed.data;
    res.status(201).json(await createCreditAssessment(actor(req), {
      applicationId: id, decision, reason
    }, metaFrom(req)));
  })
);

loanApplicationsRouter.get(
  "/:id/credit-assessments",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid application id");
    res.json(await listCreditAssessments(actor(req), id));
  })
);
