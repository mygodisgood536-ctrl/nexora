import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";

export interface FaceCaptureProofData {
  customerId: string;
  applicationId: string | null;
  party: string;
  purpose: string;
  mimeType: string;
  imageSha256: string;
  liveness: {
    checked: boolean;
    passed: boolean;
    provider: string;
    checks?: Record<string, unknown>;
  };
  deviceMetadata: Record<string, unknown>;
  location: Record<string, unknown>;
  jti: string;
  issuedAt: number;
}

export interface FaceCaptureProof {
  jti: string;
  issuedAt: number;
  signature: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROOF_AGE_MS = 5 * 60 * 1000;

function canonicalPayload(data: FaceCaptureProofData): string {
  return JSON.stringify({
    customerId: data.customerId,
    applicationId: data.applicationId,
    party: data.party,
    purpose: data.purpose,
    mimeType: data.mimeType,
    imageSha256: data.imageSha256,
    liveness: data.liveness,
    deviceMetadata: data.deviceMetadata,
    location: data.location,
    jti: data.jti,
    issuedAt: data.issuedAt
  });
}

export function signFaceCaptureProof(data: FaceCaptureProofData, secret = env.FACE_CAPTURE_PROOF_SECRET): string {
  return createHmac("sha256", secret).update(canonicalPayload(data)).digest("base64url");
}

export interface LiveEvidenceProofData {
  customerId: string;
  applicationId: string;
  party: string;
  evidenceType: string;
  identityName: string | null;
  mimeType: string;
  imageSha256: string;
  liveness: {
    checked: boolean;
    passed: boolean;
    provider: string;
    checks?: Record<string, unknown>;
  };
  deviceMetadata: Record<string, unknown>;
  location: Record<string, unknown>;
  jti: string;
  issuedAt: number;
}

export type LiveEvidenceProof = FaceCaptureProof;

function canonicalEvidencePayload(data: LiveEvidenceProofData): string {
  return JSON.stringify({
    customerId: data.customerId,
    applicationId: data.applicationId,
    party: data.party,
    evidenceType: data.evidenceType,
    identityName: data.identityName,
    mimeType: data.mimeType,
    imageSha256: data.imageSha256,
    liveness: data.liveness,
    deviceMetadata: data.deviceMetadata,
    location: data.location,
    jti: data.jti,
    issuedAt: data.issuedAt
  });
}

export function signLiveEvidenceProof(
  data: LiveEvidenceProofData,
  secret = env.LIVE_CAPTURE_PROOF_SECRET
): string {
  return createHmac("sha256", secret).update(canonicalEvidencePayload(data)).digest("base64url");
}

export function verifyLiveEvidenceProof(
  data: Omit<LiveEvidenceProofData, "jti" | "issuedAt">,
  proof: LiveEvidenceProof,
  now = Date.now()
): boolean {
  if (!UUID_RE.test(proof.jti) || !Number.isInteger(proof.issuedAt)) return false;
  if (Math.abs(now - proof.issuedAt) > MAX_PROOF_AGE_MS) return false;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(proof.signature)) return false;
  const expected = signLiveEvidenceProof({ ...data, jti: proof.jti, issuedAt: proof.issuedAt });
  const actualBuffer = Buffer.from(proof.signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function verifyFaceCaptureProof(
  data: Omit<FaceCaptureProofData, "jti" | "issuedAt">,
  proof: FaceCaptureProof,
  now = Date.now()
): boolean {
  if (!UUID_RE.test(proof.jti) || !Number.isInteger(proof.issuedAt)) return false;
  if (Math.abs(now - proof.issuedAt) > MAX_PROOF_AGE_MS) return false;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(proof.signature)) return false;
  const expected = signFaceCaptureProof({ ...data, jti: proof.jti, issuedAt: proof.issuedAt });
  const actualBuffer = Buffer.from(proof.signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
