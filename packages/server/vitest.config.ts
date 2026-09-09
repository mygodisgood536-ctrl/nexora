import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // All test files share one database (nexora_test) and each file's first
    // seedWorld() call destructively re-canonicalizes the shared alpha/beta
    // companies under an advisory lock that does not span other files' API
    // requests. Running files in parallel lets that reset overlap another
    // file's in-flight assertions (observed as flaky failures in stage6/
    // stage7 suites). Serializing file execution guarantees a file's reset
    // can never race another file's tests; every file already passes in
    // isolation, so semantics are unchanged.
    isolate: true,
    fileParallelism: false
  }
});
