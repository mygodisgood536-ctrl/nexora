import { config } from "dotenv";

export async function setup(): Promise<void> {
  config({ path: new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") });

  process.env.NODE_ENV ??= "test";
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("nexora_dev")) {
    process.env.DATABASE_URL = "postgres://nexora:nexora@localhost:5432/nexora_test";
  }

  const { runMigrations, adminUrlFor } = await import("../src/db/migrate");
  await runMigrations(adminUrlFor(process.env.DATABASE_URL));
}
