import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

/**
 * RULE 14.5.1 — "Provider credentials, webhook secrets and authenticator seeds
 * are encrypted at rest, are never logged, never exported, never displayed
 * after saving except through an explicit authorised reveal, and never
 * included in support data."
 *
 * The previous implementation stored an authenticator seed as `base64(secret)`
 * in `totp_secret_encrypted`. Base64 is an encoding, not encryption: anyone
 * with a database dump could read every worker's, the MD's and the Platform
 * Owner's second factor and generate valid codes. This module replaces that
 * with real authenticated encryption.
 *
 * Design notes:
 *  - AES-256-GCM, so the ciphertext is authenticated: a tampered row fails to
 *    decrypt rather than yielding a wrong seed.
 *  - The key is derived per account with scrypt over
 *    `EVIDENCE_ENCRYPTION_KEY` plus the account's own identifier. A leaked row
 *    is therefore useless without also reading the key material.
 *  - Storage format `v1.<iv>.<ciphertext>.<tag>`. The `v1.` prefix means legacy
 *    base64 rows can be detected and rejected rather than silently accepted,
 *    which is what an attacker would otherwise rely on.
 *  - `isLegacySecret` exists so a caller can force a re-enrolment instead of
 *    upgrading a plaintext value in place (upgrading would require decrypting
 *    a value that was never encrypted).
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function deriveKey(accountRef: string, purpose: string): Buffer {
  return scryptSync(`${env.EVIDENCE_ENCRYPTION_KEY}|${purpose}|${accountRef}`, "nexora:secret:v1", 32);
}

/** Encrypts a secret for one account. `accountRef` should be a stable id/email. */
export function wrapSecret(plain: string, accountRef: string, purpose = "totp"): string {
  const key = deriveKey(accountRef, purpose);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), enc.toString("base64url"), tag.toString("base64url")].join(".");
}

/**
 * Decrypts a secret for one account.
 * Returns null for a null/blank input, and THROWS for anything that is not a
 * well-formed, authentic `v1.` value. Callers on a login path must treat a
 * throw as "this account cannot authenticate" rather than "no secret".
 */
export function unwrapSecret(stored: string | null | undefined, accountRef: string, purpose = "totp"): string | null {
  if (!stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("stored secret is not in the v1 encrypted format");
  }
  const [, ivB64, dataB64, tagB64] = parts as [string, string, string, string];
  const key = deriveKey(accountRef, purpose);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when a stored value predates real encryption (plain base64). */
export function isLegacySecret(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split(".");
  // A legacy value is base64 of an ASCII secret: one segment, no "v1." prefix.
  return !(parts.length === 4 && parts[0] === VERSION);
}

/** Constant-time comparison helper for secrets that are compared, not opened. */
export function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}