import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError } from "../../lib/errors";

/**
 * RULE 20.4.2, 20.4.4, 20.4.5 - where backups live, for how long, and what
 * may be kept where.
 *
 * A backup policy is a real, declared document: the sites, the residency each
 * site satisfies, how long each class of artefact is kept, and which schedule
 * runs what. The subsystem refuses to place an artefact at a site whose region
 * is not permitted, and refuses to delete anything until the policy's retention
 * window says it is due. Nothing is hard-coded.
 */

export interface BackupSite {
  id: string;
  /** Filesystem root for this site. Must be outside the primary data directory. */
  root: string;
  /** ISO country/region code used for residency decisions. */
  region: string;
  /** Human label, e.g. "primary datacentre" or "off-site vault". */
  description: string;
  /** A vault site is isolated and append-only (RULE 20.4.4). */
  vault: boolean;
}

export interface BackupPolicy {
  sites: BackupSite[];
  /** Regions in which company data may lawfully be stored (RULE 20.4.5). */
  allowedResidencyRegions: string[];
  /** Full base backups: how long to keep, and how many at minimum. */
  fullBackupRetentionDays: number;
  minimumFullBackups: number;
  /** Continuous WAL archive retention (RULE 20.4.1). */
  walRetentionDays: number;
  /** Object/evidence replication retention (RULE 20.4.3). */
  objectRetentionDays: number;
  /** Hours between scheduled full backups. */
  fullBackupIntervalHours: number;
  /** The site a full backup is written to first. */
  primarySiteId: string;
  /** The isolated protected copy (RULE 20.4.4). */
  vaultSiteId: string;
  /** Declared RPO/RTO, which the drill measures against. */
  rpoMinutes: number;
  rtoMinutes: number;
}

const POLICY_ENV = "BACKUP_POLICY_PATH";
const DEFAULT_POLICY_PATH = "config/backup-policy.json";

export function policyPath(): string {
  return resolve(process.cwd(), process.env[POLICY_ENV] ?? DEFAULT_POLICY_PATH);
}

export function loadPolicy(): BackupPolicy {
  const path = policyPath();
  if (!existsSync(path)) {
    throw AppError.internal(
      `No backup policy is declared at ${path}; RULE 20.4.5 requires configurable placement and retention`
    );
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BackupPolicy;
  if (!Array.isArray(parsed.sites) || parsed.sites.length < 2) {
    throw AppError.internal("RULE 20.4.4 requires at least a primary site and an isolated protected copy");
  }
  if (!parsed.allowedResidencyRegions?.length) {
    throw AppError.internal("RULE 20.4.5 requires the permitted data-residency regions to be declared");
  }
  for (const site of parsed.sites) {
    if (!parsed.allowedResidencyRegions.includes(site.region)) {
      throw AppError.internal(
        `Backup site '${site.id}' is in ${site.region}, which the declared residency policy does not permit`
      );
    }
  }
  const primary = parsed.sites.find((s) => s.id === parsed.primarySiteId);
  const vault = parsed.sites.find((s) => s.id === parsed.vaultSiteId);
  if (!primary) throw AppError.internal(`Primary backup site '${parsed.primarySiteId}' is not declared`);
  if (!vault) throw AppError.internal(`Vault site '${parsed.vaultSiteId}' is not declared`);
  if (!vault.vault) {
    throw AppError.internal(`Site '${vault.id}' must be declared as a vault to satisfy RULE 20.4.4`);
  }
  if (primary.root === vault.root) {
    throw AppError.internal("RULE 20.4.4 requires the protected copy to be isolated from the primary site");
  }
  return parsed;
}

export function siteById(policy: BackupPolicy, siteId: string): BackupSite {
  const site = policy.sites.find((s) => s.id === siteId);
  if (!site) throw AppError.internal(`Backup site '${siteId}' is not declared in the policy`);
  if (!policy.allowedResidencyRegions.includes(site.region)) {
    throw AppError.internal(
      `RULE 20.4.5: site '${siteId}' (${site.region}) is outside the permitted residency regions`
    );
  }
  return site;
}
