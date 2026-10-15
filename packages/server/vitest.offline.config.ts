import { defineConfig } from "vitest/config";

/**
 * The database-free slice of the server suite.
 *
 * `npm test` in this package is the real gate: it provisions an isolated
 * database, applies all 87 migrations and exercises the full isolation,
 * concurrency and acceptance matrix. It needs a PostgreSQL server and is NOT
 * green without one.
 *
 * This config exists so the checks that genuinely do not touch a database —
 * the source-scan laws: the theme law and the prohibition sweep — still run on
 * a machine with no database at all. They assert facts about the repository,
 * not about a running system, so running them here is honest rather than a
 * weakened substitute.
 *
 * It deliberately has no globalSetup, because creating and migrating the
 * database is the one step that needs a server.
 */
export default defineConfig({
  test: {
    environment: "node",
    // Only suites that import no fixture, no helper and no Express app.
    // stage13-isolation-attack is deliberately NOT here: it builds the app and
    // drives real requests, so it needs the database like the rest.
    include: ["tests/stage10-theme-law.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30_000
  }
});