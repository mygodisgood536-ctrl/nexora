import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";
import { AppError } from "./errors";

/**
 * RULE 21.1.11 - company AI credentials.
 *
 * A secret is encrypted at rest with AES-256-GCM and bound, as authenticated
 * additional data, to the company that owns it. A ciphertext therefore cannot
 * be replayed for a different company even by someone with full database
 * access: decryption fails rather than yielding another tenant's key.
 *
 * The plaintext exists only inside the call that needs it, is handed straight
 * to one child process, and is never logged, returned by an API or written to
 * an audit value.
 */

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function vaultKey(): Buffer {
  return createHash("sha256")
    .update(`nexora:company-ai-secret:v1:${env.EVIDENCE_ENCRYPTION_KEY}`)
    .digest();
}

function aadFor(companyId: string): Buffer {
  return Buffer.from(`nexora:company-ai-secret:v1:${companyId}`, "utf8");
}

export function encryptCompanySecret(companyId: string, plaintext: string): string {
  if (!plaintext) throw AppError.unprocessable("The secret must not be empty");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, vaultKey(), nonce);
  cipher.setAAD(aadFor(companyId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/**
 * Decrypts a secret for one company. If the ciphertext was produced for a
 * different company, the AAD check fails and the secret is never returned.
 */
export function decryptCompanySecret(companyId: string, envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw AppError.internal("The stored company secret is not in a readable format");
  }
  const [, nonceB64, tagB64, dataB64] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv(ALGORITHM, vaultKey(), Buffer.from(nonceB64, "base64url"));
    decipher.setAAD(aadFor(companyId));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    // A wrong-company replay lands here. It is an isolation event, not a bug.
    throw AppError.forbidden("The stored company secret does not belong to this company");
  }
}

/** A secret is never echoed; only this shape ever leaves the service. */
export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return "";
  return "*".repeat(Math.max(8, Math.min(24, secret.length)));
}

export const COMPANY_SECRET_TAG_BYTES = TAG_BYTES;
