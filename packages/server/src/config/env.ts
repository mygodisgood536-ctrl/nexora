import { z } from "zod";
import { tmpdir } from "node:os";
import { join } from "node:path";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .default("postgres://nexora:nexora@localhost:5432/nexora_dev"),
  JWT_SECRET: z.string().min(16).default("nexora-dev-secret-change-me"),
  CORS_ORIGIN: z.string().default("http://localhost:5173,http://localhost:5174"),
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
