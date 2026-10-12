import { z } from "zod";
import { tmpdir } from "node:os";
import { join } from "node:path";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .default("postgres://nexora:nexora@localhost:5432/nexora_dev"),
  /**
   * Serverless connection budget. On Vercel each concurrent invocation can own
   * its own pool, so this multiplies by concurrency. Keep it small and put a
   * pooler (Neon pooler / PgBouncer / Supabase pooler) in front of Postgres.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  /** Bounded so an unreachable database fails fast instead of hanging. */
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).default(10_000),
  /**
   * TLS handling for Postgres.
   *  - `url`        (default) no override; node-postgres honours `sslmode=` and
   *                  `sslrootcert=` in DATABASE_URL, which is how managed
   *                  providers (Neon, RDS, Supabase) document connection.
   *  - `verify-full` enforce TLS AND certificate verification.
   *  - `disable`    plain TCP. Only for a local socket or a proxy that already
   *                  terminates TLS in front of the database.
   * There is deliberately no "encrypt without verifying" option, because that
   * is the setting people reach for by accident and it defeats the purpose.
   */
  DATABASE_SSL: z.enum(["url", "verify-full", "disable"]).default("url"),
  JWT_SECRET: z.string().min(16).default("nexora-dev-secret-change-me"),
  CORS_ORIGIN: z.string().default("http://localhost:5173,http://localhost:5174"),

  // ---- Platform address configuration (Vision Part 1 §2.3) ------------------
  /**
   * The apex a generated company URL is built from. RULE 2.3.1 fixes the SLUG
   * (stable, unique platform-wide, derived from the company name); the apex is
   * a deployment fact, not an identity fact.
   */
  PLATFORM_APEX: z.string().default("nexora.app"),
  /**
   * The origin the platform is actually served from, e.g. https://nexora.vercel.app.
   * Used to build the path-form company address when the apex is not a wildcard
   * domain this deployment controls.
   */
  PLATFORM_BASE_URL: z.string().default("http://localhost:5173"),
  /**
   * Which address form to advertise when a company is created.
   *  - `subdomain` — advertise {slug}.{PLATFORM_APEX} (the Vision default; needs a
   *    wildcard domain pointed at this deployment)
   *  - `path`      — advertise {PLATFORM_BASE_URL}/{slug} (works on any host)
   * Both forms RESOLVE at runtime regardless of this setting; it only decides
   * which one the one-time credential panel shows.
   */
  COMPANY_URL_MODE: z.enum(["subdomain", "path"]).default("path"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  EVIDENCE_STORAGE_ROOT: z.string().default(join(tmpdir(), "nexora-evidence")),
  EVIDENCE_ENCRYPTION_KEY: z.string().min(32).default("nexora-dev-evidence-key-change-me"),
  FACE_CAPTURE_PROOF_SECRET: z.string().min(32).default("nexora-dev-face-capture-proof-change"),
  LIVE_CAPTURE_PROOF_SECRET: z.string().min(32).default("nexora-dev-live-capture-proof-change"),
  // RULE 20.4.1 - the backup key is held apart from every application key, so
  // application compromise does not yield the ability to read backups and
  // backup compromise does not yield application secrets.
  BACKUP_ENCRYPTION_KEY: z.string().min(32).optional(),
  BACKUP_WORK_ROOT: z.string().optional(),
  BACKUP_POLICY_PATH: z.string().optional()
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration -> ${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

if (env.NODE_ENV === "production") {
  const prodSchema = envSchema.safeParse({ ...process.env, JWT_SECRET: process.env.JWT_SECRET });
  if (prodSchema.success && prodSchema.data.JWT_SECRET.startsWith("nexora-dev")) {
    throw new Error("JWT_SECRET must be replaced before running in production");
  }
  if (prodSchema.success && prodSchema.data.EVIDENCE_ENCRYPTION_KEY.startsWith("nexora-dev")) {
    throw new Error("EVIDENCE_ENCRYPTION_KEY must be replaced before running in production");
  }
  if (prodSchema.success && prodSchema.data.FACE_CAPTURE_PROOF_SECRET.startsWith("nexora-dev")) {
    throw new Error("FACE_CAPTURE_PROOF_SECRET must be replaced before running in production");
  }
  if (prodSchema.success && prodSchema.data.LIVE_CAPTURE_PROOF_SECRET.startsWith("nexora-dev")) {
    throw new Error("LIVE_CAPTURE_PROOF_SECRET must be replaced before running in production");
  }
  // RULE 20.4.1 - production cannot run without an encrypted backup capability,
  // and the backup key must be a separate secret from the application's own.
  if (env.NODE_ENV === "production") {
    if (!env.BACKUP_ENCRYPTION_KEY) {
      throw new Error("BACKUP_ENCRYPTION_KEY must be set before running in production");
    }
    if (env.BACKUP_ENCRYPTION_KEY === env.EVIDENCE_ENCRYPTION_KEY) {
      throw new Error("BACKUP_ENCRYPTION_KEY must differ from EVIDENCE_ENCRYPTION_KEY in production");
    }
  }
}
