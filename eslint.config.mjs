import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", ".pg/**"] },
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }]
    }
  },
  {
    // Verification harnesses and build scripts print their results to the
    // terminal — that output IS the deliverable, so `no-console` does not apply.
    files: ["**/scripts/**/*.mjs", "**/scripts/**/*.ts"],
    rules: {
      "no-console": "off"
    }
  }
);
