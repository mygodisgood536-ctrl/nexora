import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { BackupKeys } from "./crypto";
import { sha256File } from "./crypto";
import { addEntry, newManifest, readManifest, manifestPath, writeManifest, type BackupManifest } from "./manifest";
import { siteById, type BackupPolicy } from "./policy";
import { encryptFile } from "./crypto";

/**
 * RULE 20.4.1 - continuous transaction/WAL backup.
 *
 * PostgreSQL hands each completed WAL segment to `archive_command`. On this
 * host that mechanism is unusable: the archiver cannot start a child process at
 * all (every child dies with STATUS_DLL_INIT_FAILED and PostgreSQL then shuts
 * the cluster down), so continuous WAL backup is performed the same way
 * `pg_receivewal` does it - by a separate long-lived process that reads
 * completed segments straight out of `pg_wal`.
 *
 * The safety rule is the one PostgreSQL itself uses: only segments strictly
 * BEFORE the one containing the current insert location are complete, and only
 * complete segments may be shipped. Progress is a single high-water mark, so a
 * restarted shipper resumes exactly where it stopped and never re-ships or
 * skips a segment. A segment counts as shipped only once its encrypted copies
 * exist at every site AND the manifest entry has been written.
 */

const SEGMENT_RE = /^[0-9A-F]{24}$/;
const SEGMENT_BYTES = 16 * 1024 * 1024;

export interface ShipperOptions {
  keys: BackupKeys;
  policy: BackupPolicy;
  /** Connection to the live cluster. */
  databaseUrl: string;
  /** The cluster's pg_wal directory. */
  walDirectory: string;
  /** Scratch space for the plaintext working copy. */
  workRoot: string;
  /** Where the high-water mark and state live, inside the backup root. */
  stateRoot: string;
  siteIds: string[];
  /** Run until stopped when false. */
  once?: boolean;
  pollMs?: number;
  /** Called after each shipped segment; used by the drill to observe progress. */
  onShipped?: (segment: string, backupId: string) => void;
}

const STATE_FILE = "wal-shipper-state.json";

interface ShipperState {
  backupId: string;
  lastShipped: string | null;
  shipped: string[];
}

export function highWaterFile(stateRoot: string): string {
  return join(stateRoot, STATE_FILE);
}

export async function readShipperState(stateRoot: string): Promise<ShipperState | null> {
  try {
    return JSON.parse(await readFile(highWaterFile(stateRoot), "utf8")) as ShipperState;
  } catch {
    return null;
  }
}

async function writeShipperState(stateRoot: string, state: ShipperState): Promise<void> {
  await writeFile(highWaterFile(stateRoot), JSON.stringify(state, null, 2), "utf8");
}

/** The segment PostgreSQL is currently writing into: never safe to ship. */
export async function currentSegment(databaseUrl: string): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ name: string }>(
      `SELECT pg_walfile_name(pg_current_wal_lsn()) AS name`
    );
    return result.rows[0]!.name.trim();
  } finally {
    await client.end();
  }
}

/** Every segment name present in pg_wal that is safe to ship, in order. */
export async function completedSegments(walDirectory: string, current: string): Promise<string[]> {
  const entries = await readdir(walDirectory);
  const complete = entries
    .filter((name) => SEGMENT_RE.test(name))
    .filter((name) => name < current)
    .sort();
  // A segment that is still being filled is smaller than a full segment; only
  // complete segments may leave the cluster.
  const result: string[] = [];
  for (const name of complete) {
    const info = await stat(join(walDirectory, name)).catch(() => null);
    if (info && info.size >= SEGMENT_BYTES) result.push(name);
  }
  return result;
}

async function manifestFor(
  keys: BackupKeys,
  policy: BackupPolicy,
  state: ShipperState
): Promise<BackupManifest> {
  const primary = siteById(policy, policy.primarySiteId);
  const path = manifestPath(primary.root, state.backupId);
  if (existsSync(path)) {
    try {
      return readManifest(keys, path, state.backupId);
    } catch {
      // A manifest that cannot be read is replaced rather than trusted.
    }
  }
  return newManifest(state.backupId, policy);
}

/** Ships every segment that is complete, not yet shipped, and safely before the current one. */
export async function shipOnce(options: ShipperOptions): Promise<{ shipped: string[]; lastShipped: string | null }> {
  const { keys, policy, databaseUrl, walDirectory, workRoot, stateRoot, siteIds } = options;
  const existing = await readShipperState(stateRoot);
  const published = (await import("./wal")).activeRunId(workRoot);
  const state: ShipperState = existing ?? { backupId: published, lastShipped: null, shipped: [] };

  const current = await currentSegment(databaseUrl);
  const ready = await completedSegments(walDirectory, current);
  const shipped: string[] = [];

  for (const segment of ready) {
    if (state.shipped.includes(segment)) continue;
    if (state.lastShipped && segment <= state.lastShipped) continue;

    const staging = join(workRoot, `wal-${segment}`);
    const { cp, rm } = await import("node:fs/promises");
    await cp(join(walDirectory, segment), staging, { force: true });
    const aad = Buffer.from(`nexora-backup:v1|wal_segment|${state.backupId}|${segment}`, "utf8");

    for (const siteId of siteIds) {
      const site = siteById(policy, siteId);
      const destination = join(site.root, state.backupId, "wal", `${segment}.nxbk`);
      await encryptFile(keys, staging, destination, aad);
    }
    await rm(staging, { force: true });

    let manifest = await manifestFor(keys, policy, state);
    const digest = await sha256File(join(siteById(policy, siteIds[0]!).root, state.backupId, "wal", `${segment}.nxbk`));
    const size = (await stat(join(siteById(policy, siteIds[0]!).root, state.backupId, "wal", `${segment}.nxbk`))).size;
    for (const siteId of siteIds) {
      const site = siteById(policy, siteId);
      manifest = addEntry(manifest, {
        sequence: manifest.entries.length + 1,
        role: "wal_segment",
        backupId: state.backupId,
        artefact: segment,
        siteId,
        region: site.region,
        bytes: size,
        sha256: digest,
        createdAt: new Date().toISOString(),
        encryptedAs: "aes-256-ctr+hmac-sha256"
      });
    }
    writeManifest(keys, policy, manifest, [policy.primarySiteId]);

    state.shipped.push(segment);
    state.lastShipped = segment;
    await writeShipperState(stateRoot, state);
    shipped.push(segment);
    options.onShipped?.(segment, state.backupId);
  }

  return { shipped, lastShipped: state.lastShipped };
}

/** Runs the shipper until stopped. This is the continuous WAL backup service. */
export async function runShipper(options: ShipperOptions): Promise<void> {
  const poll = options.pollMs ?? 1_000;
  for (;;) {
    try {
      const result = await shipOnce(options);
      if (result.shipped.length) {
        process.stdout.write(
          `${JSON.stringify({ shipped: result.shipped, lastShipped: result.lastShipped })}\n`
        );
      }
    } catch (error) {
      // A shipper that stops on a transient error is not a shipper. The failure
      // is reported and the next pass retries from the same high-water mark.
      process.stderr.write(
        `wal shipper pass failed, retrying: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
    if (options.once) return;
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
}