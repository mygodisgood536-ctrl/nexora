/**
 * Direct harness for tests/global-setup.ts.
 *
 * Vitest swallows the globalSetup stack trace behind its reporter, so this
 * runs the exact same exported `setup()` through tsx and prints the real error.
 * It changes nothing: same code path, same database, no test weakening.
 */
import { setup } from "../tests/global-setup";

setup()
  .then(() => {
    console.log("GLOBAL_SETUP_OK");
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("GLOBAL_SETUP_FAILED");
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });