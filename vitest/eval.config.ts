import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

/**
 * Live-LLM eval harness config (Phase 0). SEPARATE from integration.config.ts.
 *
 * Drives the REAL memory pipeline (real Gemma embeddings + real DeepSeek judge
 * via OpenRouter) against an ephemeral testcontainers Postgres, and writes a
 * graded report card to `memory-system/eval-report-latest.md`.
 *
 * Gating: the eval globalSetup (`eval-setup.ts`) maps the OpenRouter "vault" key
 * out of `memory-system/.env`, and NO-OPS the whole run (no testcontainers, no
 * embeddings probe) when the key is absent. Each suite ALSO carries a
 * `describe.skipIf(!process.env.OPENROUTER_API_KEY)` because a globalSetup
 * early-return does not skip test bodies.
 *
 * Serialized: live judge + one DB → one file / one worker at a time, with
 * generous timeouts (a live judge round-trip can take tens of seconds).
 */
export default defineConfig({
  root,
  resolve: {
    alias: {
      "@tools": resolve(root, "src/tools"),
      "@utils": resolve(root, "src/utils"),
      "@config": resolve(root, "src/config"),
      "@vex-agent": resolve(root, "src/vex-agent"),
    },
  },
  test: {
    include: ["src/__tests__/integration/eval/**/*.int.test.ts"],
    globals: false,
    environment: "node",
    globalSetup: ["vitest/eval-setup.ts"],
    testTimeout: 240_000,
    hookTimeout: 120_000,
    // Serialize EVERYTHING — live judge + one Postgres + one report-card sink.
    fileParallelism: false,
    pool: "threads",
    maxWorkers: 1,
    minWorkers: 1,
  },
});
