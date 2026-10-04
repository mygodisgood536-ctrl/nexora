import { chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { AppError } from "../../lib/errors";
import { decryptFile, encryptFile, sha256File, type BackupKeys } from "./crypto";
import { addEntry, newManifest, readManifest, writeManifest, manifestPath, type BackupManifest } from "./manifest";
import { siteById, type BackupPolicy } from "./policy";

/**
 * RULE 20.4.1 - continuous transaction/WAL backup and point-in-time recovery.
 *
 * PostgreSQL hands every completed WAL segment to `archive_command`. This is
 * that command: the segment is encrypted, placed at the primary archive site and
 * copied to the isolated protected vault, and recorded in the manifest. Because
 * the archive is continuous, a restore can be replayed forward to any moment
 * after the base backup - which is what the drill proves.
 */

export interface WalArchiveResult {
  segment: string;
  /** The restore set this segment belongs to, so base + WAL share one manifest. */
  backupId: string;
  sites: string[];
  sha256: string;
  bytes: number;
  archivedAt: string;
}

export interface WalArchiveOptions {
  keys: BackupKeys;
  policy: BackupPolicy;
  /** The directory PostgreSQL is archiving from (its pg_wal/archive_status). */
  segmentPath: string;
  /** Scratch space for the plaintext working copy. */
  workRoot: string;
  siteIds: string[];
  /** Groups WAL into a rolling backup id so a restore has one manifest. */
  backupId?: string;
}

export function walAad(backupId: string, segment: string): Buffer {
  return Buffer.from(`nexora-backup:v1|wal_segment|${backupId}|${segment}`, "utf8");
}

export async function archiveWalSegment(options: WalArchiveOptions): Promise<WalArchiveResult> {
  const { keys, policy, segmentPath, workRoot, siteIds } = options;
  const segment = segmentPath.replace(/\\/g, "/").split("/").pop() ?? "unknown";
  const backupId = options.backupId ?? process.env.BACKUP_RUN_ID ?? "wal-continuous";
  const staging = join(workRoot, `${backupId}-${segment}`);
  await mkdir(workRoot, { recursive: true });
  // PostgreSQL deletes the source segment once the command succeeds, so the
  // archiver copies it before doing anything else.
  const { cp } = await import("node:fs/promises");
  await cp(segmentPath, staging, { force: true });

  const aad = walAad(backupId, segment);
  let sha256 = "";
  let bytes = 0;
  for (const siteId of siteIds) {
    const site = siteById(policy, siteId);
    const destination = join(site.root, backupId, "wal", `${segment}.nxbk`);
    await encryptFile(keys, staging, destination, aad);
    sha256 = await sha256File(destination);
    bytes = (await stat(destination)).size;
    if (site.vault) {
      // RULE 20.4.4 - a vault copy is written once and is never replaceable.
      await chmod(destination, 0o400).catch(() => undefined);
    }
  }
  await rm(staging, { force: true });

  return { segment, backupId, sites: siteIds, sha256, bytes, archivedAt: new Date().toISOString() };
}

/**
 * The restore_command side. PostgreSQL asks for a segment by name during
 * recovery; this decrypts the archived copy, or exits non-zero so PostgreSQL
 * ends recovery at the last segment it could obtain - which is exactly how a
 * point-in-time target is honoured.
 */
export function restoreCommandScript(keys: BackupKeys, policy: BackupPolicy): string {
  const primary = siteById(policy, policy.primarySiteId);
  return [
    `${process.execPath}`,
    join(process.cwd(), "dist", "backup", "nexora-backup.mjs"),
    "restore-wal",
    `--site-root=${JSON.stringify(primary.root)}`,
    `--backup-id=${JSON.stringify(process.env.BACKUP_RUN_ID ?? "wal-continuous")}`,
    "%f",
    "%p"
  ].join(" ");
}

export async function restoreWalSegment(
  keys: BackupKeys,
  siteRoot: string,
  backupId: string,
  segment: string,
  destinationPath: string
): Promise<boolean> {
  const encrypted = join(siteRoot, backupId, "wal", `${segment}.nxbk`);
  try {
    await stat(encrypted);
  } catch {
    return false;
  }
  await decryptFile(keys, encrypted, destinationPath, walAad(backupId, segment));
  return true;
}

/**
 * RULE 20.4.5 - retention. Artefacts are removed only when BOTH the policy's
 * window has passed AND the declared minimum count is still satisfied, and the
 * protected copy is never pruned by the same run that prunes the primary.
 */
export interface RetentionPlan {
  siteId: string;
  backupId: string;
  role: "base_backup" | "object_set";
  ageDays: number;
  remove: boolean;
  reason: string;
}

export async function planRetention(
  policy: BackupPolicy,
  inventory: Array<{ siteId: string; backupId: string; role: "base_backup" | "object_set"; createdAt: string }>
): Promise<RetentionPlan[]> {
  const now = Date.now();
  const plans: RetentionPlan[] = [];
  for (const site of policy.sites) {
    const siteItems = inventory.filter((i) => i.siteId === site.id);
    const window =
      siteItems.some((i) => i.role === "object_set") && !siteItems.some((i) => i.role === "base_backup")
        ? policy.objectRetentionDays
        : policy.fullBackupRetentionDays;
    const minKeep = site.vault ? policy.minimumFullBackups : 1;
    const ordered = [...siteItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    ordered.forEach((item, index) => {
      const ageDays = (now - new Date(item.createdAt).getTime()) / 86_400_000;
      const beyondWindow = ageDays > window;
      const beyondMinimum = index >= minKeep;
      const remove = beyondWindow && beyondMinimum;
      plans.push({
        siteId: site.id,
        backupId: item.backupId,
        role: item.role,
        ageDays,
        remove,
        reason: remove
          ? `older than the ${window}-day window and outside the ${minKeep}-copy minimum`
          : beyondWindow
            ? `older than the ${window}-day window but inside the ${minKeep}-copy minimum`
            : `within the ${window}-day window`
      });
    });
  }
  return plans;
}

export async function applyRetention(
  plans: RetentionPlan[],
  policy: BackupPolicy
): Promise<Array<{ path: string; removed: boolean; reason: string }>> {
  const results: Array<{ path: string; removed: boolean; reason: string }> = [];
  for (const plan of plans.filter((p) => p.remove)) {
    const site = siteById(policy, plan.siteId);
    if (site.vault) {
      // The protected copy is append-only: the policy prunes the primary, and
      // the vault is retained beyond it.
      results.push({
        path: join(site.root, plan.backupId),
        removed: false,
        reason: "RULE 20.4.4: the protected copy is never pruned by retention"
      });
      continue;
    }
    const path = join(site.root, plan.backupId);
    await rm(path, { recursive: true, force: true });
    results.push({ path, removed: true, reason: plan.reason });
  }
  return results;
}

export async function listBackups(policy: BackupPolicy, siteId: string): Promise<string[]> {
  const site = siteById(policy, siteId);
  try {
    return (await readdir(site.root)).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

export async function recordArchiveInManifest(
  keys: BackupKeys,
  policy: BackupPolicy,
  backupId: string,
  result: WalArchiveResult
): Promise<BackupManifest> {
  let manifest: BackupManifest;
  try {
    manifest = readManifest(keys, manifestPath(siteById(policy, policy.primarySiteId).root, backupId), backupId);
  } catch {
    manifest = newManifest(backupId, policy);
  }
  for (const siteId of result.sites) {
    const site = siteById(policy, siteId);
    manifest = addEntry(manifest, {
      sequence: manifest.entries.length + 1,
      role: "wal_segment",
      backupId,
      artefact: result.segment,
      siteId,
      region: site.region,
      bytes: result.bytes,
      sha256: result.sha256,
      createdAt: result.archivedAt,
      encryptedAs: "aes-256-ctr+hmac-sha256"
    });
  }
  writeManifest(keys, policy, manifest, [policy.primarySiteId]);
  return manifest;
}

export function requireBackupKey(): string {
  const keyFile = process.env.BACKUP_KEY_FILE;
  let key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key && keyFile) {
    // The archiving process is started by PostgreSQL, not by an operator shell,
    // so the key is read from the protected key file it alone can read. That
    // file is deliberately NOT an application credential (RULE 20.4.1).
    try {
      key = readFileSync(keyFile, "utf8").trim();
    } catch {
      key = undefined;
    }
  }
  if (!key || key.length < 32) {
    throw AppError.internal(
      "BACKUP_ENCRYPTION_KEY must be set (or readable from BACKUP_KEY_FILE) to at least 32 characters; RULE 20.4.1 requires backups to be encrypted with a key held apart from application credentials"
    );
  }
  if (process.env.EVIDENCE_ENCRYPTION_KEY && key === process.env.EVIDENCE_ENCRYPTION_KEY) {
    throw AppError.internal(
      "BACKUP_ENCRYPTION_KEY must differ from the application key; a backup key that the application also holds is not an isolated credential"
    );
  }
  return key;
}

/**
 * The run id currently being archived under. A scheduled base backup publishes
 * it, so every WAL segment written from then on belongs to the same restore set
 * as that base backup. With no published run, segments accumulate under a
 * rolling id and are still restorable.
 */
export function activeRunId(workRoot: string): string {
  try {
    const value = readFileSync(join(workRoot, "active-run-id.txt"), "utf8").trim();
    if (value) return value;
  } catch {
    // No run published yet.
  }
  return process.env.BACKUP_RUN_ID ?? "wal-continuous";
}

export async function publishRunId(workRoot: string, backupId: string): Promise<void> {
  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, "active-run-id.txt"), backupId, "utf8");
}

export async function writeControlFile(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}
