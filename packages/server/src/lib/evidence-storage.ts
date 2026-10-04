import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { env } from "../config/env";

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const storageKey = createHash("sha256").update(env.EVIDENCE_ENCRYPTION_KEY).digest();

export interface EvidenceObjectInput {
  companyId: string;
  branchId: string;
  customerId: string;
  bytes: Buffer;
  mimeType: string;
}

export interface StoredEvidenceObject {
  storageObjectRef: string;
  imageSha256: string;
  fileSizeBytes: number;
  mimeType: "image/jpeg" | "image/png";
}

function detectImageMime(bytes: Buffer): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  return null;
}

function objectPath(storageObjectRef: string): string {
  const root = resolve(env.EVIDENCE_STORAGE_ROOT);
  const path = resolve(root, storageObjectRef);
  const rel = relative(root, path);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || rel === "") {
    throw new Error("Invalid evidence object reference");
  }
  return path;
}

/**
 * The absolute location of a stored evidence object. Recovery tooling and
 * integrity drills need to reach the object itself, and the containment check
 * is the same one the write path uses.
 */
export function objectPathForTest(storageObjectRef: string): string {
  return objectPath(storageObjectRef);
}

export async function putImmutableEvidenceObject(
  input: EvidenceObjectInput
): Promise<StoredEvidenceObject> {
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    throw new Error("Evidence bytes are required");
  }
  if (input.bytes.length > MAX_EVIDENCE_BYTES) {
    throw new Error("Evidence object exceeds the maximum size");
  }
  const detectedMime = detectImageMime(input.bytes);
  if (!detectedMime || detectedMime !== input.mimeType) {
    throw new Error("Evidence bytes do not match the declared image MIME type");
  }

  const storageObjectRef = [
    "v1",
    input.companyId,
    input.branchId,
    input.customerId,
    `${randomUUID()}.enc`
  ].join("/");
  const path = objectPath(storageObjectRef);
  await mkdir(dirname(path), { recursive: true });

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", storageKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(input.bytes), cipher.final()]);
  const payload = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
  await writeFile(path, payload, { flag: "wx", mode: 0o600 });

  return {
    storageObjectRef,
    imageSha256: createHash("sha256").update(input.bytes).digest("hex"),
    fileSizeBytes: input.bytes.length,
    mimeType: detectedMime
  };
}

export async function verifyEvidenceObject(
  storageObjectRef: string,
  expectedSha256: string,
  expectedSize: number
): Promise<{ exists: boolean; valid: boolean; actualSha256: string | null; actualSize: number | null; error: string | null }> {
  let payload: Buffer;
  try {
    payload = await readFile(objectPath(storageObjectRef));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      return { exists: false, valid: false, actualSha256: null, actualSize: null, error: "object_missing" };
    }
    return { exists: false, valid: false, actualSha256: null, actualSize: null, error: "object_unreadable" };
  }
  try {
    const nonce = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", storageKey, nonce);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const actualSha256 = createHash("sha256").update(plaintext).digest("hex");
    return {
      exists: true,
      valid: actualSha256 === expectedSha256 && plaintext.length === expectedSize,
      actualSha256,
      actualSize: plaintext.length,
      error: null
    };
  } catch {
    return { exists: true, valid: false, actualSha256: null, actualSize: null, error: "object_decryption_failed" };
  }
}

export async function deleteEvidenceObject(storageObjectRef: string): Promise<void> {
  await rm(objectPath(storageObjectRef), { force: true });
}
