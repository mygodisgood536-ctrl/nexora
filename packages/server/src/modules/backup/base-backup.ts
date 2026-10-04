import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { AppError } from "../../lib/errors";
import { encryptFile, sha256File, type BackupKeys } from "./crypto";
import { addEntry, newManifest, type BackupManifest } from "./manifest";
import { siteById, type BackupPolicy } from "./policy";

/**
 * RULE 20.4.2 - scheduled, encrypted, separate full database backups.
 *
 * The backup is a real physical base backup taken ONLINE through
 * `pg_backup_start()` / `pg_backup_stop()`: the server writes a backup label and
 * the WAL needed to make the copy internally consistent, the data directory is
 * copied, and the server is told to wait for that WAL to be archived. The
 * result is a base backup that can be replayed forward to any later moment,
 * which is what makes point-in-time recovery real rather than nominal.
 */

/**
 * Only genuinely transient files are excluded. A stopped cluster's data
 * directory is copied wholesale otherwise: the directories PostgreSQL expects
 * to exist at startup (pg_notify, pg_serial, pg_snapshots, pg_subtrans,
 * pg_multixact, pg_replslot, pg_tblspc, pg_twophase and the rest) must be
 * present in the copy, or the restored cluster cannot start.
 */
const EXCLUDED = new Set(["postmaster.pid", "postmaster.opts"]);

export interface BaseBackupResult {
  backupId: string;
  root: string;
  bytes: number;
  entries: number;
  startedAt: string;
  finishedAt: string;
  label: string;
  /** Which mechanism guarantees the WAL this backup needs can be replayed. */
  walContinuity: "postgres-archive-command" | "wal-shipper";
  method: BaseBackupMethod;
  /** The cluster's insert location when the copy was taken. */
  endLsn: string | null;
  downtimeSeconds: number;
}

export type BaseBackupMethod = "online" | "controlled-stop";

export interface BaseBackupOptions {
  keys: BackupKeys;
  policy: BackupPolicy;
  adminUrl: string;
  /** Directory holding the running cluster's data files. */
  dataDirectory: string;
  /** Where the unencrypted working copy is assembled, on the same volume. */
  workRoot: string;
  siteIds: string[];
  /**
   * "online" uses PostgreSQL's own backup protocol and needs no downtime.
   * "controlled-stop" stops the cluster cleanly, copies the data directory and
   * starts it again, which is also a valid physical base backup and is the only
   * route available where the server cannot run the background process the
   * online protocol requires.
   */
  method?: BaseBackupMethod;
  /** pg_ctl location, needed by the controlled-stop method. */
  pgCtl?: string;
  /**
   * Cold mode: the cluster is already stopped and this process must not start
   * or stop anything. A cleanly stopped cluster is a valid base backup.
   */
  cold?: boolean;
  now?: () => Date;
}

function backupId(prefix = "base"): string {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${createHash("sha1")
    .update(String(process.pid) + String(Date.now()) + Math.random())
    .digest("hex")
    .slice(0, 8)}`;
}

export async function takeBaseBackup(options: BaseBackupOptions): Promise<{
  result: BaseBackupResult;
  manifest: BackupManifest;
}> {
  const { keys, policy, adminUrl, dataDirectory, workRoot, siteIds } = options;
  const now = options.now ?? (() => new Date());
  const method = options.method ?? "online";
  const id = backupId();
  const label = `nexora_base_${id}`;
  const startedAt = now().toISOString();
  const staging = join(workRoot, id);

  const server =
    method === "controlled-stop" && options.cold
      ? { dataDirectory, archiveMode: "off", lsn: null }
      : await inspectServer(adminUrl, dataDirectory);
  let endLsn: string | null = server.lsn;
  let archiveMode = server.archiveMode;
  let downtimeSeconds = 0;

  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  if (method === "online") {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      // RULE 20.3.3 - taken through PostgreSQL's own backup protocol, so no
      // history is rewritten to produce it.
      await client.query(`SELECT pg_backup_start($1, true)`, [label]);
      try {
        await copyDataDirectory(server.dataDirectory, staging);
      } finally {
        await client.query(`SELECT pg_backup_stop($1)`, [archiveMode === "on"]);
      }
    } finally {
      await client.end().catch(() => undefined);
    }
  } else {
    const pgCtl = options.pgCtl;
    if (!options.cold) {
      if (!pgCtl) {
        throw AppError.internal("The controlled-stop method needs pg_ctl to stop and start the cluster");
      }
      const stoppedAt = Date.now();
      await run(pgCtl, ["-D", server.dataDirectory, "-m", "fast", "-w", "-t", "300", "stop"], {
        timeoutMs: 400_000,
        label: "stop the cluster for the base backup"
      });
      try {
        await copyDataDirectory(server.dataDirectory, staging);
      } finally {
        await run(pgCtl, ["-D", server.dataDirectory, "-w", "-t", "300", "start"], {
          timeoutMs: 400_000,
          label: "restart the cluster after the base backup"
        });
      }
      downtimeSeconds = Math.round((Date.now() - stoppedAt) / 1000);
    } else {
      // Cold mode: the cluster has already been stopped by the operator or the
      // scheduler. A cleanly stopped cluster's data directory is itself a valid
      // physical base backup, and this process must not itself start or stop
      // anything - which also keeps the backup out of the server's way entirely.
      if (existsSync(join(server.dataDirectory, "postmaster.pid"))) {
        throw AppError.internal(
          "A cold base backup requires the cluster to be stopped cleanly first"
        );
      }
      const stoppedAt = Date.now();
      await copyDataDirectory(server.dataDirectory, staging);
      downtimeSeconds = Math.round((Date.now() - stoppedAt) / 1000);
    }
    const after = await inspectServer(adminUrl, dataDirectory).catch(() => null);
    endLsn = after?.lsn ?? null;
  }

  const finishedAt = now().toISOString();
  let manifest = newManifest(id, policy);
  let bytes = 0;
  let count = 0;
  for await (const file of walk(staging)) {
    count += 1;
    bytes += (await stat(file.path)).size;
  }

  for (const siteId of siteIds) {
    const site = siteById(policy, siteId);
    const destination = join(site.root, id, "base.tar");
    const tarPath = await packDirectory(staging, join(workRoot, `${id}.tar`), workRoot);
    await encryptFile(keys, tarPath, destination, aadFor(id, "base_backup"));
    const digest = await sha256File(destination);
    const size = (await stat(destination)).size;
    manifest = addEntry(manifest, {
      sequence: manifest.entries.length + 1,
      role: "base_backup",
      backupId: id,
      artefact: "base.tar",
      siteId,
      region: site.region,
      bytes: size,
      sha256: digest,
      createdAt: finishedAt,
      encryptedAs: "aes-256-ctr+hmac-sha256"
    });
    await rm(tarPath, { force: true });
  }

  return {
    result: {
      backupId: id,
      root: server.dataDirectory,
      bytes,
      entries: count,
      startedAt,
      finishedAt,
      label,
      walContinuity: archiveMode === "on" ? "postgres-archive-command" : "wal-shipper",
      method,
      endLsn,
      downtimeSeconds
    },
    manifest
  };
}

interface ServerInfo {
  dataDirectory: string;
  archiveMode: string;
  lsn: string | null;
}

async function inspectServer(adminUrl: string, expectedDataDirectory: string): Promise<ServerInfo> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const settings = await client.query<{ data_directory: string; archive_mode: string }>(
      `SELECT current_setting('data_directory') AS data_directory,
              current_setting('archive_mode') AS archive_mode`
    );
    const dataDirectory = settings.rows[0]!.data_directory;
    if (dataDirectory.replace(/\\/g, "/").toLowerCase() !== expectedDataDirectory.replace(/\\/g, "/").toLowerCase()) {
      throw AppError.internal(
        `Refusing to back up a different directory: the server reports ${dataDirectory}, not ${expectedDataDirectory}`
      );
    }
    let lsn: string | null = null;
    try {
      const result = await client.query<{ lsn: string }>(`SELECT pg_current_wal_lsn()::text AS lsn`);
      lsn = result.rows[0]?.lsn ?? null;
    } catch {
      lsn = null;
    }
    return { dataDirectory, archiveMode: settings.rows[0]!.archive_mode, lsn };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function run(
  command: string,
  args: string[],
  opts: { timeoutMs: number; label: string; allowEmptyLogArgument?: boolean }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const filtered = opts.allowEmptyLogArgument
    ? args.filter((a, i) => !(a === "" && i > 0 && args[i - 1] === "-l"))
    : args;
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, filtered, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  }).then((result) => {
    if (result.code !== 0) {
      throw AppError.internal(
        `Failed to ${opts.label} (exit ${result.code}): ${(result.stderr || result.stdout).slice(-300)}`
      );
    }
    return result;
  });
}

function aadFor(backupId: string, role: string, sequence?: string): Buffer {
  return Buffer.from(`nexora-backup:v1|${role}|${backupId}|${sequence ?? ""}`, "utf8");
}

async function* walk(root: string, prefix = ""): AsyncGenerator<{ path: string; rel: string }> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      yield* walk(root, rel);
    } else {
      yield { path: join(root, rel), rel };
    }
  }
}

async function copyDataDirectory(source: string, destination: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      await cp(from, to, { recursive: true, force: true, errorOnExist: false });
    } else {
      await cp(from, to, { force: true, errorOnExist: false });
    }
  }
}

/**
 * A minimal, standards-correct ustar writer. Node has no tar implementation in
 * core, and pulling one in would add a dependency to the backup path; a base
 * backup is a flat set of files and long paths, so the writer emits GNU long
 * names, which any tar implementation can read.
 */
async function packDirectory(root: string, target: string, workRoot: string): Promise<string> {
  const { createWriteStream } = await import("node:fs");
  const out = createWriteStream(target);
  const write = async (buf: Buffer) => {
    if (!out.write(buf)) {
      await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
  };
  const pad = (size: number) => (size % 512 === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - (size % 512)));

  for await (const { path, rel } of walk(root)) {
    const data = await import("node:fs/promises").then((fs) => fs.readFile(path));
    const name = rel.replace(/\\/g, "/");
    const needsLong = Buffer.byteLength(name) > 100;
    const headerName = needsLong ? name.slice(0, 100) : name;
    const header = buildHeader(headerName, data.length, "0");
    await write(header);
    if (needsLong) {
      const longName = `././@LongLink/${name}`;
      const longHeader = buildHeader(longName, name.length + 1, "L");
      await write(longHeader);
      await write(Buffer.from(`${name}\0`, "utf8"));
      await write(pad(Buffer.byteLength(name) + 1));
    }
    await write(data);
    await write(pad(data.length));
  }
  await write(Buffer.alloc(1024));
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", reject);
  });
  void workRoot;
  return target;
}

function buildHeader(name: string, size: number, type: string): Buffer {
  const header = Buffer.alloc(512);
  const writeField = (value: string, offset: number, length: number) => {
    header.write(value.slice(0, length - 1), offset, length - 1, "utf8");
  };
  writeField(name, 0, 100);
  writeField("0000644\0", 100, 8);
  writeField("0000000\0", 108, 8);
  writeField("0000000\0", 116, 8);
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf8");
  header.write("00000000000\0", 136, 12, "utf8");
  header.write("        ", 148, 8, "utf8");
  header.write(type, 156, 1, "utf8");
  writeField("ustar\0" + "00", 257, 8);
  header.write("root\0", 265, 32, "utf8");
  header.write("root\0", 297, 32, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return header;
}

export async function writeMarker(path: string, content: Record<string, unknown>): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(content, null, 2), "utf8");
}
