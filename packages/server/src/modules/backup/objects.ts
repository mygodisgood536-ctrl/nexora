import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { decryptFile, encryptFile, sha256File, type BackupKeys } from "./crypto";
import { addEntry, newManifest, type BackupManifest } from "./manifest";
import { siteById, type BackupPolicy } from "./policy";

/**
 * RULE 20.4.3 - evidence/object storage gets its own encrypted replication.
 *
 * A database-only backup is explicitly not a complete Nexora backup, so the
 * object store is replicated on its own schedule with its own encrypted
 * artefacts, its own retention window and its own site list. Every object is
 * checked against the digest the database recorded for it before it is carried
 * forward, so replication cannot silently propagate a corrupted object.
 */

export interface ObjectReplicationResult {
  backupId: string;
  objects: number;
  bytes: number;
  matched: number;
  mismatched: number;
  notInDatabase: number;
  finishedAt: string;
  siteIds: string[];
  artefacts: Array<{ siteId: string; region: string; path: string; bytes: number; sha256: string }>;
}

export interface ObjectReplicationOptions {
  keys: BackupKeys;
  policy: BackupPolicy;
  /** The live evidence/object storage root. */
  sourceRoot: string;
  /** Scratch space for the working copy and the encrypted artefact. */
  workRoot: string;
  siteIds: string[];
  /**
   * Digest the database recorded for each object, keyed by storage reference.
   * A digest of null means the object is on disk but not referenced.
   */
  expectedHashes?: Map<string, string | null>;
}

export async function replicateObjects(
  options: ObjectReplicationOptions
): Promise<{ result: ObjectReplicationResult; manifest: BackupManifest }> {
  const { keys, policy, sourceRoot, workRoot, siteIds, expectedHashes } = options;
  await mkdir(sourceRoot, { recursive: true });
  const id = `objects-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const files = await listFiles(sourceRoot);
  let bytes = 0;
  let matched = 0;
  let mismatched = 0;
  let notInDatabase = 0;
  for (const file of files) {
    bytes += (await stat(file)).size;
    const rel = file.slice(sourceRoot.length + 1).replace(/\\/g, "/");
    if (!expectedHashes) continue;
    if (!expectedHashes.has(rel)) {
      notInDatabase += 1;
      continue;
    }
    const expected = expectedHashes.get(rel) ?? null;
    if (!expected) {
      notInDatabase += 1;
      continue;
    }
    const digest = createHash("sha256").update(await readFile(file)).digest("hex");
    if (digest === expected) matched += 1;
    else mismatched += 1;
  }

  const staging = join(workRoot, `${id}-objects`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await cp(sourceRoot, staging, { recursive: true, force: true });
  const tarPath = join(workRoot, `${id}.tar`);
  await tarDirectory(staging, tarPath);

  let manifest = newManifest(id, policy);
  const artefacts: ObjectReplicationResult["artefacts"] = [];
  for (const siteId of siteIds) {
    const site = siteById(policy, siteId);
    const destination = join(site.root, id, "objects.tar");
    await encryptFile(keys, tarPath, destination, artefactAad(id, "object_set"));
    const sha256 = await sha256File(destination);
    const size = (await stat(destination)).size;
    artefacts.push({ siteId, region: site.region, path: destination, bytes: size, sha256 });
    manifest = addEntry(manifest, {
      sequence: manifest.entries.length + 1,
      role: "object_set",
      backupId: id,
      artefact: "objects.tar",
      siteId,
      region: site.region,
      bytes: size,
      sha256,
      createdAt: new Date().toISOString(),
      encryptedAs: "aes-256-ctr+hmac-sha256"
    });
  }
  await rm(staging, { recursive: true, force: true });
  await rm(tarPath, { force: true });

  return {
    result: {
      backupId: id,
      objects: files.length,
      bytes,
      matched,
      mismatched,
      notInDatabase,
      finishedAt: new Date().toISOString(),
      siteIds,
      artefacts
    },
    manifest
  };
}

function artefactAad(backupId: string, role: string, sequence?: string): Buffer {
  return Buffer.from(`nexora-backup:v1|${role}|${backupId}|${sequence ?? ""}`, "utf8");
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(root, rel)));
    else out.push(join(root, rel));
  }
  return out;
}

async function tarDirectory(root: string, target: string): Promise<void> {
  const { createWriteStream } = await import("node:fs");
  const out = createWriteStream(target);
  const write = async (buf: Buffer) => {
    if (!out.write(buf)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
  };
  const pad = (size: number) => (size % 512 === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - (size % 512)));
  for (const file of await listFiles(root)) {
    const data = await readFile(file);
    const name = file.slice(root.length + 1).replace(/\\/g, "/");
    await write(header(name, data.length, "0"));
    await write(data);
    await write(pad(data.length));
  }
  await write(Buffer.alloc(1024));
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", reject);
  });
}

function header(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  const f = (value: string, offset: number, length: number) =>
    h.write(value.slice(0, length - 1), offset, length - 1, "utf8");
  f(name, 0, 100);
  f("0000644\0", 100, 8);
  f("0000000\0", 108, 8);
  f("0000000\0", 116, 8);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf8");
  h.write("00000000000\0", 136, 12, "utf8");
  h.write("        ", 148, 8, "utf8");
  h.write(type, 156, 1, "utf8");
  f("ustar\0" + "00", 257, 8);
  f("root\0", 265, 32);
  f("root\0", 297, 32);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return h;
}

export async function extractEncryptedTar(
  keys: BackupKeys,
  encryptedTar: string,
  destinationRoot: string,
  backupId: string
): Promise<{ files: number; root: string }> {
  await mkdir(destinationRoot, { recursive: true });
  const tarPath = join(destinationRoot, "objects.tar");
  await decryptFile(keys, encryptedTar, tarPath, artefactAad(backupId, "object_set"));
  const { execFileSync } = await import("node:child_process");
  execFileSync("tar", ["-xf", tarPath, "-C", destinationRoot], { stdio: "pipe" });
  await rm(tarPath, { force: true });
  return { files: (await listFiles(destinationRoot)).length, root: destinationRoot };
}
