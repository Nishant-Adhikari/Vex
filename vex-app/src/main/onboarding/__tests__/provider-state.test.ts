/**
 * provider-state tests (M10 codex turn 5 RED #2 fix).
 *
 * Real fs against tmpdir; verifies `probeProvider` matches engine
 * `registry.ts:41-108` precedence + handles edge cases:
 *  - Explicit AGENT_PROVIDER=openrouter + key+model → configured.
 *  - Explicit AGENT_PROVIDER=openrouter + key only → not configured.
 *  - Explicit AGENT_PROVIDER=0g-compute + valid compute-state.json → configured.
 *  - Explicit AGENT_PROVIDER=bogus → not configured (engine returns null).
 *  - AGENT_PROVIDER absent + key+model → fallback to openrouter.
 *  - AGENT_PROVIDER absent + no key + compute-state.json → 0g-compute.
 *  - Empty quoted key `OPENROUTER_API_KEY=""` → treated as not configured.
 *  - Nothing configured → null.
 *  - Malformed compute-state.json → graceful, never throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock CONFIG_DIR so the 0g-compute/compute-state.json path resolves
// inside our tmp dir.
let tmpDir = "";
let envFile = "";
let zgDir = "";
let zgStateFile = "";

vi.mock("../../paths/config-dir.ts", () => ({
  get CONFIG_DIR() {
    return tmpDir;
  },
  get ENV_FILE() {
    return envFile;
  },
}));

const { probeProvider, computeStateFile } = await import(
  "../provider-state.js"
);

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-provider-state-"));
  envFile = path.join(tmpDir, ".env");
  zgDir = path.join(tmpDir, "0g-compute");
  zgStateFile = path.join(zgDir, "compute-state.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function writeEnv(content: string): void {
  writeFileSync(envFile, content, { mode: 0o600 });
}

function writeComputeState(state: unknown): void {
  if (!existsSync(zgDir)) mkdirSync(zgDir, { recursive: true });
  writeFileSync(zgStateFile, JSON.stringify(state, null, 2), "utf-8");
}

describe("probeProvider", () => {
  it("returns name:null when env file is missing", async () => {
    const r = await probeProvider(envFile);
    expect(r).toEqual({ configured: false, name: null, modelLabel: null });
  });

  it("explicit AGENT_PROVIDER=openrouter + key + model → configured", async () => {
    writeEnv(
      [
        'OPENROUTER_API_KEY="sk-or-test"',
        'AGENT_MODEL="anthropic/claude-sonnet-4.5"',
        'AGENT_PROVIDER="openrouter"',
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(true);
    expect(r.name).toBe("openrouter");
    expect(r.modelLabel).toBe("anthropic/claude-sonnet-4.5");
  });

  it("explicit AGENT_PROVIDER=openrouter + key only (no model) → NOT configured", async () => {
    writeEnv(
      [
        'OPENROUTER_API_KEY="sk-or-test"',
        'AGENT_PROVIDER="openrouter"',
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(false);
    expect(r.name).toBe("openrouter");
    expect(r.modelLabel).toBe(null);
  });

  it("explicit AGENT_PROVIDER=0g-compute + valid compute-state → configured", async () => {
    writeEnv('AGENT_PROVIDER="0g-compute"\n');
    writeComputeState({
      activeProvider: "0xabc",
      model: "llama-3.3-70b",
      configuredAt: 0,
    });
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(true);
    expect(r.name).toBe("0g-compute");
    expect(r.modelLabel).toBe("llama-3.3-70b");
  });

  it("explicit AGENT_PROVIDER=bogus → NOT configured (engine fails closed)", async () => {
    writeEnv(
      [
        'OPENROUTER_API_KEY="sk-or-test"',
        'AGENT_MODEL="anthropic/claude-sonnet-4.5"',
        'AGENT_PROVIDER="bogus-provider"',
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    // MUST fail closed — would mislead the wizard otherwise.
    expect(r.configured).toBe(false);
    expect(r.name).toBe(null);
    expect(r.modelLabel).toBe(null);
  });

  it("AGENT_PROVIDER absent + key + model → fallback to openrouter", async () => {
    writeEnv(
      [
        'OPENROUTER_API_KEY="sk-or-test"',
        'AGENT_MODEL="anthropic/claude-sonnet-4.5"',
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(true);
    expect(r.name).toBe("openrouter");
    expect(r.modelLabel).toBe("anthropic/claude-sonnet-4.5");
  });

  it("AGENT_PROVIDER absent + no key + compute-state → fallback to 0g-compute", async () => {
    writeComputeState({
      activeProvider: "0xabc",
      model: "llama-3.3-70b",
      configuredAt: 0,
    });
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(true);
    expect(r.name).toBe("0g-compute");
    expect(r.modelLabel).toBe("llama-3.3-70b");
  });

  it("empty quoted OPENROUTER_API_KEY=\"\" → treated as not configured", async () => {
    writeEnv(
      [
        'OPENROUTER_API_KEY=""',
        'AGENT_MODEL="anthropic/claude-sonnet-4.5"',
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(false);
    expect(r.name).toBe(null);
  });

  it("malformed compute-state.json → never throws; treated as not present", async () => {
    if (!existsSync(zgDir)) mkdirSync(zgDir, { recursive: true });
    writeFileSync(zgStateFile, "{ broken json }", "utf-8");
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(false);
    expect(r.name).toBe(null);
  });

  it("compute-state.json with missing model field → not configured", async () => {
    writeComputeState({ activeProvider: "0xabc" });
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(false);
  });

  it("modelLabel > 200 chars truncated", async () => {
    const longModel = "x".repeat(300);
    writeEnv(
      [
        'OPENROUTER_API_KEY="sk-or-test"',
        `AGENT_MODEL="${longModel}"`,
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(true);
    expect(r.modelLabel?.length).toBe(200);
  });

  it("computeStateFile() resolves CONFIG_DIR/0g-compute/compute-state.json (engine path)", () => {
    expect(computeStateFile()).toBe(
      path.join(tmpDir, "0g-compute", "compute-state.json"),
    );
  });
});
