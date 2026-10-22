import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: a pathname keeps the percent-encoding, so a
// checkout path containing a space resolves to a file that does not exist and
// dotenv fails silently. See the same fix in global-setup.ts.
config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

process.env.NODE_ENV ??= "test";
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("nexora_dev")) {
  process.env.DATABASE_URL = "postgres://nexora:nexora@localhost:5432/nexora_test";
}
