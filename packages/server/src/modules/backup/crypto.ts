import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Backup encryption (Vision RULE 20.4.1, 20.4.2, 20.4.3).
 *
 * Every backup artefact - the full base backup, every WAL segment, the object
 * replication set and the protected vault copy - is encrypted with a key that
 * is NOT any application key. A stolen backup file is unreadable without the
 * backup key, which is held separately from the application credentials.
 *
 * The scheme is encrypt-then-MAC with AES-256-CTR and HMAC-SHA256, chosen so a
 * multi-gigabyte WAL stream is encrypted in constant memory. The ciphertext is
 * additionally bound to the artefact it belongs to (role, backup id, sequence),
 * so a segment from one backup cannot be silently substituted into another.
 */

const MAGIC = "nxbk1";
const CHUNK = 1 << 20;

export interface BackupKeys {
  encKey: Buffer;
  macKey: Buffer;
}

export function deriveBackupKeys(masterKey: string): BackupKeys {
  if (masterKey.length < 32) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be at least 32 characters");
  }
  const material = Buffer.from(masterKey, "utf8");
  return {
    encKey: Buffer.from(hkdfSync("sha256", material, Buffer.alloc(0), "nexora-backup-encryption", 32)),
    macKey: Buffer.from(hkdfSync("sha256", material, Buffer.alloc(0), "nexora-backup-integrity", 32))
  };
}

/** The identity a ciphertext is bound to. */
export function artefactAad(parts: { role: string; backupId: string; sequence?: string | number }): Buffer {
  return Buffer.from(`nexora-backup:v1|${parts.role}|${parts.backupId}|${parts.sequence ?? ""}`, "utf8");
}

/**
 * HMAC over an artefact. `start` is the first ciphertext byte, so the same
 * function verifies a file in place without decrypting it first.
 */
function macFor(
  keys: BackupKeys,
  aad: Buffer,
  iv: Buffer,
  ciphertextPath: string,
  start = 0
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mac = createHmac("sha256", keys.macKey);
    mac.update(MAGIC);
    mac.update(aad);
    mac.update(iv);
    const stream = createReadStream(ciphertextPath, { start, highWaterMark: CHUNK });
    stream.on("data", (chunk) => mac.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(mac.digest()));
  });
}

/** Encrypts a file: source stays, destination is header + MAC + ciphertext. */
export async function encryptFile(
  keys: BackupKeys,
  sourcePath: string,
  destinationPath: string,
  aad: Buffer
): Promise<{ iv: string }> {
  await mkdir(dirname(destinationPath), { recursive: true });
  const iv = randomBytes(16);
  const bodyPath = `${destinationPath}.body`;
  const cipher = createCipheriv("aes-256-ctr", keys.encKey, iv);
  await pipeline(createReadStream(sourcePath, { highWaterMark: CHUNK }), cipher, createWriteStream(bodyPath));
  const mac = await macFor(keys, aad, iv, bodyPath);
  const header = Buffer.from(`${MAGIC}.${aad.toString("base64url")}.${iv.toString("base64url")}.`, "utf8");
  await composeFile(bodyPath, destinationPath, Buffer.concat([header, mac]));
  // The intermediate body is working space, never an artefact: leaving it
  // behind would double the stored backup and confuse a later verification.
  await rm(bodyPath, { force: true });
  return { iv: iv.toString("base64url") };
}

/** header || mac || body, written without buffering the body in memory. */
async function composeFile(bodyPath: string, destinationPath: string, prefix: Buffer): Promise<void> {
  const out = createWriteStream(destinationPath, { flags: "w" });
  const write = (chunk: Buffer) =>
    out.write(chunk) ? Promise.resolve() : new Promise<void>((resolve) => out.once("drain", () => resolve()));
  await write(prefix);
  const stream = createReadStream(bodyPath, { highWaterMark: CHUNK });
  for await (const chunk of stream) {
    await write(chunk as Buffer);
  }
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", reject);
  });
}

/**
 * Parses the artefact header: `nxbk1.<aad>.<iv>.<mac><ciphertext>`.
 * Returns the byte offset at which the MAC begins.
 */
function parseHeader(head: Buffer): { aad: Buffer; iv: Buffer; macOffset: number; headerEnd: number } {
  const text = head.toString("utf8", 0, Math.min(head.length, 4096));
  if (!text.startsWith(`${MAGIC}.`)) {
    throw new Error(`Not a Nexora backup artefact (bad magic in ${head.length} bytes)`);
  }
  const afterMagic = MAGIC.length + 1;
  const dotAad = text.indexOf(".", afterMagic);
  if (dotAad < 0) throw new Error("Truncated backup artefact: missing AAD terminator");
  const dotIv = text.indexOf(".", dotAad + 1);
  if (dotIv < 0) throw new Error("Truncated backup artefact: missing IV terminator");
  return {
    aad: Buffer.from(text.slice(afterMagic, dotAad), "base64url"),
    iv: Buffer.from(text.slice(dotAad + 1, dotIv), "base64url"),
    macOffset: dotIv + 1,
    headerEnd: dotIv + 1 + 32
  };
}

export async function decryptFile(
  keys: BackupKeys,
  encryptedPath: string,
  destinationPath: string,
  expectedAad: Buffer
): Promise<{ bytes: number }> {
  const handle = await import("node:fs/promises").then((fs) => fs.open(encryptedPath, "r"));
  const head = Buffer.alloc(4096);
  const { bytesRead } = await handle.read(head, 0, head.length, 0);
  await handle.close();
  const { aad, iv, macOffset, headerEnd } = parseHeader(head.subarray(0, bytesRead));
  const mac = head.subarray(macOffset, headerEnd);
  if (!aad.equals(expectedAad)) {
    throw new Error(
      `Backup artefact ${encryptedPath} belongs to a different backup or role than the one being restored`
    );
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  const decipher = createDecipheriv("aes-256-ctr", keys.encKey, iv);
  await pipeline(
    createReadStream(encryptedPath, { start: headerEnd }),
    decipher,
    createWriteStream(destinationPath)
  );

  // The MAC covers the stored ciphertext, verified in place at the byte range it
  // was written to, before anything downstream trusts the plaintext.
  const actual = await macFor(keys, aad, iv, encryptedPath, headerEnd);
  if (mac.length !== 32 || !timingSafeEqual(actual, mac)) {
    throw new Error(`Backup artefact failed its integrity check: ${encryptedPath}`);
  }
  return { bytes: (await stat(encryptedPath)).size - headerEnd };
}

/** Small in-memory encryption for manifests and control files. */
export function encryptBuffer(keys: BackupKeys, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-ctr", keys.encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const mac = createHmac("sha256", keys.macKey)
    .update(Buffer.concat([Buffer.from(MAGIC, "utf8"), aad, iv, ciphertext]))
    .digest();
  return Buffer.concat([
    Buffer.from(`${MAGIC}.${aad.toString("base64url")}.${iv.toString("base64url")}.`, "utf8"),
    mac,
    ciphertext
  ]);
}

export function decryptBuffer(keys: BackupKeys, envelope: Buffer, expectedAad: Buffer): Buffer {
  const { aad, iv, headerEnd } = parseHeader(envelope);
  const mac = envelope.subarray(headerEnd - 32, headerEnd);
  const ciphertext = envelope.subarray(headerEnd);
  if (!aad.equals(expectedAad)) {
    throw new Error("Backup control file belongs to a different backup");
  }
  const expected = createHmac("sha256", keys.macKey)
    .update(Buffer.concat([Buffer.from(MAGIC, "utf8"), aad, iv, ciphertext]))
    .digest();
  if (mac.length !== 32 || !timingSafeEqual(expected, mac)) {
    throw new Error("Backup control file failed its integrity check");
  }
  const decipher = createDecipheriv("aes-256-ctr", keys.encKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path, { highWaterMark: CHUNK });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
