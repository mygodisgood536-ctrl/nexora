import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .default("postgres://nexora:nexora@localhost:5432/nexora_dev"),
  JWT_SECRET: z.string().min(16).default("nexora-dev-secret-change-me"),
  CORS_ORIGIN: z.string().default("http://localhost:5173,http://localhost:5174"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")
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
}
