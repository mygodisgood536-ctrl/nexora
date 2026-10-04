#!/usr/bin/env node
/**
 * The Nexora backup shipper and scheduler (Vision RULE 20.4.1, 20.4.2, 20.4.3).
 *
 * One long-running process, started independently of PostgreSQL, that:
 *
 *   1. drains completed WAL segments from the staging directory that
 *      PostgreSQL's archive_command copies them into, encrypting each one,
 *      placing it at the primary archive site and in the isolated protected
 *      vault, recording it in the tamper-evident manifest, and only then
 *      removing the staged plaintext;
 *   2. replicates the evidence/object store on its own interval, with its own
 *      encrypted artefacts, its own retention and its own sites (RULE 20.4.3);
 *   3. takes a full encrypted base backup on the declared schedule
 *      (RULE 20.4.2), publishing the run id so the WAL segments that follow
 *      belong to the same restore set;
 *   4. applies the declared retention policy, never touching the vault.
 *
 * It is deliberately a separate, long-lived process rather than something
 * PostgreSQL spawns per segment: a one-shot child per segment is expensive and,
 * on some hosts, destabilises the server. The archive_command only copies.
 */
import { readdir, rm, stat, rename } from "node:fs/promises";
import { join } from "node:path";
import { deriveBackupKeys, encryptFile, sha256File } from "../src/modules/backup/crypto.ts";
import { loadPolicy, siteById, type BackupPolicy } from "../src/modules/backup/policy.ts";
import {
  addEntry,
  manifestPath,
  newManifest,
  readManifest,
  writeManifest
} from "../src/modules/backup/manifest.ts";
import { takeBaseBackup } from "../src/modules/backup/base-backup.ts";
import { replicateObjects } from "../src/modules/backup/objects.ts";
import {
  activeRunId,
  applyRetention,
  listBackups,
  planRetention,
  publishRunId,
  recordArchiveInManifest
} from "../src/modules/backup/wal.ts";

export interface ShipperOptions {
  policy: BackupPolicy;
  keys: ReturnType<typeof deriveBackupKeys>;
  stagingDir: string;
  workRoot: string;
  adminUrl: string;
  dataDirectory: string;
  evidenceRoot: string;
}

/** Drains every completed segment currently staged, oldest first. */
export async function shipWal(options: ShipperOptions): Promise<{
  shipped: string[];
  failures: Array<{ segment: string; error: string }>;
}> {
  const { policy, keys, stagingDir, workRoot } = options;
  const primary = siteById(policy, policy.primarySiteId);
  const vault = siteById(policy, policy.vaultSiteId);
  const backupId = activeRunId(workRoot);

  let staged: string[] = [];
  try {
    staged = (await readdir(stagingDir)).filter((name) => /^[0-9A-F]{24}(\.partial)?$/.test(name));
  } catch {
    return { shipped: [], failures: [] };
  }
  staged.sort();

  const shipped: string[] = [];
  const failures: Array<{ segment: string; error: string }> = [];
  for (const name of staged) {
    // A .partial file is still being written; it is not complete until renamed.
    if (name.endsWith(".partial")) continue;
    const segment = name.replace(/\.partial$/, "");
    const source = join(stagingDir, name);
    try {
      const aad = Buffer.from(`nexora-backup:v1|wal_segment|${backupId}|${segment}`, "utf8");
      const destination = join(primary.root, backupId, "wal", `${segment}.nxbk`);
      await encryptFile(keys, source, destination, aad);
      const sha256 = await sha256File(destination);
      const bytes = (await stat(destination)).size;
      // The protected copy is written from the same plaintext and is append-only.
      const vaultDestination = join(vault.root, backupId, "wal", `${segment}.nxbk`);
      await encryptFile(keys, source, vaultDestination, aad);
      const vaultSha = await sha256File(vaultDestination);
      if (vaultSha !== sha256) {
        throw new Error(`the vault copy of ${segment} does not match the primary copy`);
      }
      await recordArchiveInManifest(keys, policy, backupId, {
        segment,
        backupId,
        sites: [primary.id, vault.id],
        sha256,
        bytes,
        archivedAt: new Date().toISOString()
      });
      // Only now is the staged plaintext removed.
      await rm(source, { force: true });
      shipped.push(segment);
    } catch (error) {
      failures.push({ segment, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { shipped, failures };
}

export async function takeScheduledBaseBackup(
  options: ShipperOptions
): Promise<{ backupId: string; bytes: number; entries: number }> {
  const { policy, keys, workRoot } = options;
  const primary = siteById(policy, policy.primarySiteId);
  const vault = siteById(policy, policy.vaultSiteId);
  const { result, manifest } = await takeBaseBackup({
    keys,
    policy,
    adminUrl: options.adminUrl,
    dataDirectory: options.dataDirectory,
    workRoot,
    siteIds: [primary.id, vault.id]
  });
  await publishRunId(workRoot, result.backupId);
  writeManifest(keys, policy, manifest, [primary.id, vault.id]);
  return { backupId: result.backupId, bytes: result.bytes, entries: result.entries };
}

export async function replicateObjectStore(
  options: ShipperOptions
): Promise<{ backupId: string; objects: number; matched: number; mismatched: number }> {
  const { policy, keys, workRoot, evidenceRoot } = options;
  const primary = siteById(policy, policy.primarySiteId);
  const vault = siteById(policy, policy.vaultSiteId);
  const { result, manifest } = await replicateObjects({
    keys,
    policy,
    sourceRoot: evidenceRoot,
    workRoot,
    siteIds: [primary.id, vault.id]
  });
  writeManifest(keys, policy, manifest, [primary.id, vault.id]);
  return {
    backupId: result.backupId,
    objects: result.objects,
    matched: result.matched,
    mismatched: result.mismatched
  };
}

export async function runRetention(options: ShipperOptions): Promise<{
  removed: string[];
  retainedInVault: string[];
}> {
  const { policy, keys } = options;
  const inventory: Array<{
    siteId: string;
    backupId: string;
    role: "base_backup" | "object_set";
    createdAt: string;
  }> = [];
  for (const site of policy.sites) {
    for (const backupId of await listBackups(policy, site.id)) {
      let createdAt = new Date(0).toISOString();
      let role: "base_backup" | "object_set" = "base_backup";
      try {
        const manifest = readManifest(keys, manifestPath(site.root, backupId), backupId);
        createdAt = manifest.createdAt;
        role = manifest.entries.some((e) => e.role === "object_set") ? "object_set" : "base_backup";
      } catch {
        createdAt = (await stat(join(site.root, backupId))).birthtime.toISOString();
      }
      inventory.push({ siteId: site.id, backupId, role, createdAt });
    }
  }
  const plans = await planRetention(policy, inventory);
  const applied = await applyRetention(plans, policy);
  return {
    removed: applied.filter((a) => a.removed).map((a) => a.path),
    retainedInVault: applied.filter((a) => !a.removed).map((a) => a.path)
  };
}

async function main(): Promise<void> {
  const policy = loadPolicy();
  const keys = deriveBackupKeys(process.env.BACKUP_ENCRYPTION_KEY ?? readKeyFile());
  const options: ShipperOptions = {
    policy,
    keys,
    stagingDir: process.env.BACKUP_STAGING_DIR ?? "C:/NexoraBackup/wal-staging",
    workRoot: process.env.BACKUP_WORK_ROOT ?? "C:/NexoraBackup/work",
    adminUrl:
      process.env.ADMIN_DATABASE_URL ??
      "postgres://postgres:nexora-dev@localhost:5432/nexora_test",
    dataDirectory: process.env.PGDATA ?? "C:/Users/adede/nexora/.pg/data",
    evidenceRoot: process.env.EVIDENCE_STORAGE_ROOT ?? "C:/NexoraBackup/../nexora-evidence"
  };
  const intervalMs = Number(process.env.BACKUP_POLL_MS ?? 2000);
  const once = process.argv.includes("--once");
  const log = (event: string, detail: unknown) => {
    process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, detail })}\n`);
  };

  let lastFull = 0;
  let lastObjects = 0;
  for (;;) {
    try {
      const wal = await shipWal(options);
      if (wal.shipped.length || wal.failures.length) {
        log("wal", { shipped: wal.shipped, failures: wal.failures });
      }
      const now = Date.now();
      if (now - lastFull > policy.fullBackupIntervalHours * 3_600_000) {
        lastFull = now;
        log("base", await takeScheduledBaseBackup(options));
      }
      if (now - lastObjects > policy.objectRetentionDays * 86_400_000) {
        lastObjects = now;
        log("objects", await replicateObjectStore(options));
      }
      const retention = await runRetention(options);
      if (retention.removed.length) log("retention", retention);
    } catch (error) {
      log("error", error instanceof Error ? error.message : String(error));
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function readKeyFile(): string {
  const file = process.env.BACKUP_KEY_FILE;
  if (!file) throw new Error("BACKUP_ENCRYPTION_KEY or BACKUP_KEY_FILE is required");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("node:fs").readFileSync(file, "utf8").trim();
}

const invokedDirectly = process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`;
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

export { addEntry, newManifest, rename };
