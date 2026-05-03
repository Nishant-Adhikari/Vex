import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// `local/` is a private, gitignored harness (see .gitignore). When it is
// absent (CI, fresh clones), exclude tests that import from it so the suite
// does not fail with ERR_MODULE_NOT_FOUND at module-resolution time.
const hasLocalShell = existsSync(resolve(__dirname, "local/vex-shell"));

export default defineConfig({
  resolve: {
    alias: {
      "@tools": resolve(__dirname, "src/tools"),
      "@utils": resolve(__dirname, "src/utils"),
      "@config": resolve(__dirname, "src/config"),
      "@vex-agent": resolve(__dirname, "src/vex-agent"),
    },
  },
  test: {
    include: [
      "src/__tests__/**/*.test.ts",
      "src/tools/solana-ecosystem/jupiter/__tests__/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/__tests__/integration/**",
      ...(hasLocalShell ? [] : ["src/__tests__/vex-agent/local-shell/**"]),
    ],
    globals: false,
    environment: "node",
    setupFiles: ["src/__tests__/setup.ts"],
    testTimeout: 10000,
  },
});
