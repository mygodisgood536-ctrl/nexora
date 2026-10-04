import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each test file runs in its own isolated environment.
    //
    // NOTE: fileParallelism is deliberately left at its default (true).
    //
    // A previous version set `fileParallelism: false` here. That is equivalent
    // to passing --no-file-parallelism on the command line, and it was measured
    // to deadlock: every worker sat below 4s of CPU for 45 minutes while still
    // "running". The justification recorded in that comment was that all files
    // share one database and that each file's seedWorld() destructively
    // re-canonicalizes the shared companies under an advisory lock.
    //
    // That justification went stale when ISS-007 was fixed: application tests
    // now run against the isolated nexora_unittest database, while journeys own
    // nexora_test. Serializing every file into one process was therefore both
    // unnecessary and the direct cause of the hang. Parallel execution is the
    // configuration under which the 38-file / 298-test baseline was green.
    isolate: true
  }
});
