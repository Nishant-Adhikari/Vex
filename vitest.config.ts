import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@tools": resolve(__dirname, "src/tools"),
      "@commands": resolve(__dirname, "src/commands"),
      "@utils": resolve(__dirname, "src/utils"),
      "@config": resolve(__dirname, "src/config"),
      "@echo-agent": resolve(__dirname, "src/echo-agent"),
    },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    globals: false,
    environment: "node",
    setupFiles: ["src/__tests__/setup.ts"],
    testTimeout: 10000,
  },
});
