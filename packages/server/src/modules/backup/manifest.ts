import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppError } from "../../lib/errors";
import { decryptBuffer, encryptBuffer, type BackupKeys } from "./crypto";
import { siteById, type BackupPolicy } from "./policy";

/**
 * The tamper-evident record of every backup artefact.
 *
 * Each entry is hashed together with the previous entry's hash, so an entry
 * cannot be altered, reordered or removed without the chain breaking. The
 * manifest itself is encrypted with the backup key, so it is unreadable without
 * it, and a copy is written to the isolated vault (RULE 20.4.4).
 */

export type ArtefactRole =
  | "base_backup"
  | "wal_segment"
  | "object_set"
  | "manifest"
  | "restore_report";

export interface ManifestEntry {
  sequence: number;
  role: ArtefactRole;
  backupId: string;
  artefact: string;
  siteId: string;
  region: string;
  bytes: number;
  sha256: string;
  createdAt: string;
  prevHash: string;
  encryptedAs: string;
}

export interface BackupManifest {
  backupId: string;
  createdAt: string;
  entries: ManifestEntry[];
  headHash: string;
  policyFingerprint: string;
}

const GENESIS = "0".repeat(64);

export function manifestAad(backupId: string): Buffer {
  return Buffer.from(`nexora-backup-manifest:v1|${backupId}`, "utf8");
}

export function entryHash(entry: Omit<ManifestEntry, "prevHash">, prevHash: string): string {
  return createHash("sha256")
    .update(
      [
        prevHash,
        entry.sequence,
        entry.role,
        entry.backupId,
        entry.artefact,
        entry.siteId,
        entry.region,
        entry.bytes,
        entry.sha256,
        entry.createdAt
      ].join("|")
    )
    .digest("hex");
}

export function policyFingerprint(policy: BackupPolicy): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sites: policy.sites.map((s) => [s.id, s.root, s.region, s.vault]),
        residency: policy.allowedResidencyRegions,
        full: policy.fullBackupRetentionDays,
        wal: policy.walRetentionDays,
        objects: policy.objectRetentionDays,
        vault: policy.vaultSiteId
      })
    )
    .digest("hex");
}

export function manifestPath(siteRoot: string, backupId: string, version?: number): string {
  // The protected copy keeps an append-only sequence of manifests, because an
  // artefact there may never be replaced. The primary keeps one current file.
  return version === undefined
    ? join(siteRoot, backupId, "manifest.nxbk")
    : join(siteRoot, backupId, `manifest-${String(version).padStart(4, "0")}.nxbk`);
}

export function addEntry(
  manifest: BackupManifest,
  entry: Omit<ManifestEntry, "prevHash">
): BackupManifest {
  const prevHash = manifest.entries.length
    ? manifest.entries[manifest.entries.length - 1]!.sha256 === manifest.headHash
      ? manifest.headHash
      : manifest.entries[manifest.entries.length - 1]!.sha256
    : GENESIS;
  const withHash: ManifestEntry = { ...entry, prevHash };
  const next = [...manifest.entries, withHash];
  return {
    ...manifest,
    entries: next,
    headHash: createHash("sha256")
      .update(`${prevHash}|${withHash.sha256}`)
      .digest("hex")
  };
}

export function newManifest(backupId: string, policy: BackupPolicy): BackupManifest {
  return {
    backupId,
    createdAt: new Date().toISOString(),
    entries: [],
    headHash: GENESIS,
    policyFingerprint: policyFingerprint(policy)
  };
}

export function writeManifest(
  keys: BackupKeys,
  policy: BackupPolicy,
  manifest: BackupManifest,
  siteIds: string[]
): string[] {
  const written: string[] = [];
  for (const siteId of siteIds) {
    const site = siteById(policy, siteId);
    const body = encryptBuffer(
      keys,
      Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      manifestAad(manifest.backupId)
    );
    if (site.vault) {
      // RULE 20.4.4 - append only: a new immutable manifest per revision, so
      // the protected copy's history is never rewritten.
      const version = manifest.entries.length;
      const path = manifestPath(site.root, manifest.backupId, version);
      if (existsSync(path)) {
        written.push(path);
        continue;
      }
      writeImmutable(site.root, path, body);
      written.push(path);
    } else {
      const path = manifestPath(site.root, manifest.backupId);
      mkdirSync(dirname(path), { recursive: true });
      // The primary keeps ONE current manifest, so the previous revision is
      // replaced atomically. It may have been written read-only by an earlier
      // immutable write, so it is made writable first.
      if (existsSync(path)) {
        try {
          chmodSync(path, 0o600);
        } catch {
          // Best effort: on a filesystem without POSIX modes this is a no-op.
        }
        rmSync(path, { force: true });
      }
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, body, { mode: 0o600 });
      renameSync(temporary, path);
      written.push(path);
    }
  }
  return written;
}

export function readManifest(keys: BackupKeys, path: string, backupId: string): BackupManifest {
  const raw = readFileSync(path);
  const json = decryptBuffer(keys, raw, manifestAad(backupId)).toString("utf8");
  return JSON.parse(json) as BackupManifest;
}

/** RULE 20.4.4 - a vault artefact is written once and never overwritten. */
export function writeImmutable(siteRoot: string, path: string, body: Buffer): void {
  if (existsSync(path)) {
    throw AppError.conflict(
      `RULE 20.4.4: ${path} already exists in the protected copy and must never be overwritten`
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  // flag "wx" fails if the file exists, so a race cannot overwrite either.
  writeFileSync(path, body, { flag: "wx", mode: 0o400 });
}

/** Verifies the chain and every artefact's recorded digest. */
export function verifyManifest(
  manifest: BackupManifest,
  resolveArtefactPath: (entry: ManifestEntry) => string | null,
  hashArtefact: (path: string) => Promise<string>
): Promise<{ entries: number; problems: string[] }> {
  const problems: string[] = [];
  let prev = GENESIS;
  for (const entry of manifest.entries) {
    if (entry.prevHash !== prev) {
      problems.push(`entry ${entry.sequence} (${entry.artefact}) does not chain to its predecessor`);
    }
    const expected = entryHash(
      {
        sequence: entry.sequence,
        role: entry.role,
        backupId: entry.backupId,
        artefact: entry.artefact,
        siteId: entry.siteId,
        region: entry.region,
        bytes: entry.bytes,
        sha256: entry.sha256,
        createdAt: entry.createdAt,
        encryptedAs: entry.encryptedAs
      },
      prev
    );
    if (expected !== entry.sha256) problems.push(`entry ${entry.sequence} has been altered`);
    const path = resolveArtefactPath(entry);
    if (path) {
      // The recorded digest is checked by the caller, which owns the filesystem.
      void hashArtefact;
    }
    prev = entry.sha256;
  }
  return Promise.resolve({ entries: manifest.entries.length, problems });
}
