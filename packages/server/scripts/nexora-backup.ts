#!/usr/bin/env node
/**
 * Nexora backup and recovery tool.
 *
 *   base                     take an encrypted online base backup
 *   objects                  replicate the evidence/object store, encrypted
 *   restore-wal <segment>    restore_command entry point for WAL replay
 *   plan-retention           report what the declared policy would prune
 *   apply-retention          prune the primary site to the declared window
 *   verify-manifest <id>     verify the artefact chain end to end
 *   drill <id>               restore into a separate cluster and verify it
 *   status                   show the configured sites, policy and artefacts
 *
 * Every artefact is encrypted with BACKUP_ENCRYPTION_KEY, which must be set and
 * must differ from any application key (Vision RULE 20.4.1, 20.4.4).
 */
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { deriveBackupKeys, decryptFile, sha256File } from "../src/modules/backup/crypto.ts";
import { loadPolicy, siteById } from "../src/modules/backup/policy.ts";
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
  archiveWalSegment,
  listBackups,
  planRetention,
  publishRunId,
  recordArchiveInManifest,
  requireBackupKey,
  restoreWalSegment
} from "../src/modules/backup/wal.ts";
import { runRestoreDrill } from "../src/modules/backup/drill.ts";

const command = process.argv[2] ?? "status";
const flag = (name: string, fallback?: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

function env(): {
  keys: ReturnType<typeof deriveBackupKeys>;
  workRoot: string;
  policy: ReturnType<typeof loadPolicy>;
} {
  const keys = deriveBackupKeys(requireBackupKey());
  const workRoot = resolve(flag("work-root", process.env.BACKUP_WORK_ROOT ?? join(process.cwd(), ".backup-work")));
  const policy = loadPolicy();
  return { keys, workRoot, policy };
}

async function main(): Promise<number> {
  const { keys, workRoot, policy } = env();
  await mkdir(workRoot, { recursive: true });

  if (command === "base") {
    const primary = siteById(policy, policy.primarySiteId);
    const vault = siteById(policy, policy.vaultSiteId);
    const { result, manifest } = await takeBaseBackup({
      keys,
      policy,
      adminUrl: process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:nexora-dev@localhost:5432/nexora_test",
      dataDirectory: resolve(flag("data-dir", process.env.PGDATA ?? "")),
      workRoot,
      siteIds: [primary.id, vault.id],
      method: (flag("method", process.env.NEXORA_BACKUP_METHOD ?? "online") as "online" | "controlled-stop"),
      pgCtl: flag("pg-ctl", process.env.PG_CTL ?? ""),
      cold: process.argv.includes("--cold")
    });
    // From here on, every WAL segment belongs to this restore set.
    await publishRunId(workRoot, result.backupId);
    writeManifest(keys, policy, manifest, [primary.id, vault.id]);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    return 0;
  }

  if (command === "objects") {
    const primary = siteById(policy, policy.primarySiteId);
    const vault = siteById(policy, policy.vaultSiteId);
    const { result, manifest } = await replicateObjects({
      keys,
      policy,
      sourceRoot: resolve(flag("source", process.env.EVIDENCE_STORAGE_ROOT ?? join(process.cwd(), "evidence"))),
      workRoot,
      siteIds: [primary.id, vault.id]
    });
    writeManifest(keys, policy, manifest, [primary.id, vault.id]);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    return 0;
  }

  if (command === "archive") {
    // Invoked by PostgreSQL's archive_command as: archive <%p> <%f>
    // Every completed WAL segment is encrypted, placed at the primary archive
    // site, copied to the isolated protected vault, and recorded (RULE 20.4.1).
    const segmentPath = process.argv[3] ?? "";
    const segment = process.argv[4] ?? "";
    if (!segmentPath || !segment) {
      process.stderr.write("archive requires the segment path and name\n");
      return 2;
    }
    const primary = siteById(policy, policy.primarySiteId);
    const vault = siteById(policy, policy.vaultSiteId);
    const result = await archiveWalSegment({
      keys,
      policy,
      segmentPath,
      workRoot,
      siteIds: [primary.id, vault.id],
      backupId: flag("backup-id", activeRunId(workRoot))
    });
    await recordArchiveInManifest(keys, policy, result.backupId, result);
    return 0;
  }

  if (command === "ship") {
    // The continuous WAL backup service (RULE 20.4.1). Runs until stopped;
    // --once performs a single pass, which is what a test drives.
    const primary = siteById(policy, policy.primarySiteId);
    const vault = siteById(policy, policy.vaultSiteId);
    const { runShipper, shipOnce } = await import("../src/modules/backup/shipper.ts");
    const options = {
      keys,
      policy,
      databaseUrl: flag("db", process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:nexora-dev@localhost:5432/nexora_test"),
      walDirectory: resolve(flag("wal-dir", join(process.cwd(), "pg_wal"))),
      workRoot,
      stateRoot: resolve(flag("state-root", policy.primarySiteId ? siteById(policy, policy.primarySiteId).root : workRoot)),
      siteIds: [primary.id, vault.id],
      once: process.argv.includes("--once"),
      pollMs: Number(flag("poll-ms", "1000"))
    };
    if (options.once) {
      const result = await shipOnce(options);
      process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
      return 0;
    }
    await runShipper(options);
    return 0;
  }

  if (command === "restore-wal") {
    // Invoked by PostgreSQL during recovery. Two arguments are supplied: %f is
    // the segment name and %p the path PostgreSQL wants it written to. A
    // non-zero exit means "not archived", which is how recovery stops exactly
    // at the requested target instead of running past it.
    const segment = process.argv[3] ?? "";
    const destination = process.argv[4] ?? "";
    if (!segment || !destination) return 1;
    const siteRoot = flag("site-root");
    const backupId = flag("backup-id");
    if (!siteRoot || !backupId) return 1;
    const restored = await restoreWalSegment(keys, siteRoot, backupId, segment, resolve(destination));
    return restored ? 0 : 1;
  }

  if (command === "plan-retention" || command === "apply-retention") {
    const inventory: Array<{ siteId: string; backupId: string; role: "base_backup" | "object_set"; createdAt: string }> = [];
    for (const site of policy.sites) {
      for (const backupId of await listBackups(policy, site.id)) {
        let createdAt = new Date(0).toISOString();
        let role: "base_backup" | "object_set" = "base_backup";
        try {
          const manifest = readManifest(keys, manifestPath(site.root, backupId), backupId);
          createdAt = manifest.createdAt;
          role = manifest.entries.some((e) => e.role === "object_set") ? "object_set" : "base_backup";
        } catch {
          try {
            createdAt = (await stat(join(site.root, backupId))).birthtime.toISOString();
          } catch {
            continue;
          }
        }
        inventory.push({ siteId: site.id, backupId, role, createdAt });
      }
    }
    const plans = await planRetention(policy, inventory);
    const applied = command === "apply-retention" ? await applyRetention(plans, policy) : [];
    process.stdout.write(`${JSON.stringify({ ok: true, plans, applied })}\n`);
    return 0;
  }

  if (command === "verify-manifest") {
    const backupId = process.argv[3] ?? "";
    if (!backupId) return 2;
    const report: Record<string, unknown> = { backupId, sites: [] };
    let ok = true;
    for (const site of policy.sites) {
      const path = manifestPath(site.root, backupId);
      if (!existsSync(path)) {
        (report.sites as unknown[]).push({ site: site.id, present: false });
        continue;
      }
      const manifest = readManifest(keys, path, backupId);
      const problems: string[] = [];
      let prev = "0".repeat(64);
      for (const entry of manifest.entries) {
        if (entry.prevHash !== prev) problems.push(`${entry.artefact}: chain broken`);
        if (entry.siteId !== site.id && entry.siteId !== "all") {
          // Entries for other sites are still listed but not verified here.
          prev = entry.sha256;
          continue;
        }
        const artefact = join(site.root, backupId, entry.role === "base_backup" ? "base.tar" : entry.role === "object_set" ? "objects.tar" : `wal/${entry.artefact}.nxbk`);
        if (!existsSync(artefact)) {
          problems.push(`${entry.artefact}: missing at this site`);
        } else {
          const digest = await sha256File(artefact);
          if (digest !== entry.sha256) problems.push(`${entry.artefact}: digest mismatch`);
        }
        prev = entry.sha256;
      }
      if (problems.length) ok = false;
      (report.sites as unknown[]).push({ site: site.id, present: true, entries: manifest.entries.length, problems });
    }
    (report as Record<string, unknown>).ok = ok;
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return ok ? 0 : 1;
  }

  if (command === "drill") {
    const backupId = process.argv[3] ?? "";
    const target = flag("target") ?? new Date().toISOString();
    if (!backupId) return 2;
    const result = await runRestoreDrill({
      keys,
      policy,
      baseBackupId: backupId,
      recoveryTargetTime: target,
      referenceUrl: process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:nexora-dev@localhost:5432/nexora_test",
      pgBin: resolve(flag("pg-bin", process.env.PG_BIN ?? "")),
      workRoot,
      port: Number(flag("port", "54329"))
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    const allReconciled = result.recordTypes.every((r) => r.reconciled);
    const evidenceClean = result.evidence.mismatched === 0 && result.evidence.missing === 0;
    return allReconciled && evidenceClean && result.metRto && result.cleanShutdown ? 0 : 1;
  }

  if (command === "status") {
    const sites = [];
    for (const site of policy.sites) {
      const backups = await listBackups(policy, site.id);
      sites.push({
        id: site.id,
        region: site.region,
        vault: site.vault,
        root: site.root,
        artefacts: backups.length,
        backups
      });
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          policy: {
            rpoMinutes: policy.rpoMinutes,
            rtoMinutes: policy.rtoMinutes,
            fullBackupRetentionDays: policy.fullBackupRetentionDays,
            minimumFullBackups: policy.minimumFullBackups,
            walRetentionDays: policy.walRetentionDays,
            objectRetentionDays: policy.objectRetentionDays,
            fullBackupIntervalHours: policy.fullBackupIntervalHours,
            residency: policy.allowedResidencyRegions
          },
          sites
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

export { cp, readdir, rm };
