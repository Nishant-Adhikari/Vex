import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnvConfig, loadSubagentConfig } from "../../../echo-agent/inference/config.js";

describe("loadSubagentConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SUBAGENT_") || key.startsWith("AGENT_") || key.startsWith("OPENROUTER_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function getAgentConfig() {
    return loadEnvConfig();
  }

  // ── Defaults ────────────────────────────────────────────────────

  it("returns defaults when no SUBAGENT_* env vars set", () => {
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.maxConcurrent).toBe(5);
    expect(config.contextLimit).toBe(16_384);
    expect(config.maxIterations).toBe(25);
    expect(config.timeoutMs).toBe(300_000);
  });

  it("inherits maxOutputTokens from agent config", () => {
    process.env.AGENT_MAX_OUTPUT_TOKENS = "8192";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.maxOutputTokens).toBe(8192);
  });

  it("inherits temperature from agent config", () => {
    process.env.AGENT_TEMPERATURE = "0.5";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.temperature).toBe(0.5);
  });

  it("inherits null temperature when agent has none", () => {
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.temperature).toBeNull();
  });

  // ── Overrides ───────────────────────────────────────────────────

  it("SUBAGENT_MAX_CONCURRENT overrides default", () => {
    process.env.SUBAGENT_MAX_CONCURRENT = "3";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.maxConcurrent).toBe(3);
  });

  it("SUBAGENT_CONTEXT_LIMIT overrides default", () => {
    process.env.SUBAGENT_CONTEXT_LIMIT = "32768";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.contextLimit).toBe(32_768);
  });

  it("SUBAGENT_MAX_OUTPUT_TOKENS overrides agent inheritance", () => {
    process.env.AGENT_MAX_OUTPUT_TOKENS = "16384";
    process.env.SUBAGENT_MAX_OUTPUT_TOKENS = "4096";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.maxOutputTokens).toBe(4096);
  });

  it("SUBAGENT_TEMPERATURE overrides agent inheritance", () => {
    process.env.AGENT_TEMPERATURE = "0.7";
    process.env.SUBAGENT_TEMPERATURE = "0.3";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.temperature).toBe(0.3);
  });

  it("SUBAGENT_MAX_ITERATIONS overrides default", () => {
    process.env.SUBAGENT_MAX_ITERATIONS = "50";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.maxIterations).toBe(50);
  });

  it("SUBAGENT_TIMEOUT_MS overrides default", () => {
    process.env.SUBAGENT_TIMEOUT_MS = "600000";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.timeoutMs).toBe(600_000);
  });

  // ── Invalid values fall back to defaults ────────────────────────

  it("invalid SUBAGENT_MAX_CONCURRENT falls back to default", () => {
    process.env.SUBAGENT_MAX_CONCURRENT = "abc";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.maxConcurrent).toBe(5);
  });

  it("out-of-range SUBAGENT_MAX_CONCURRENT falls back to default", () => {
    process.env.SUBAGENT_MAX_CONCURRENT = "100";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.maxConcurrent).toBe(5);
  });

  it("zero SUBAGENT_MAX_CONCURRENT falls back to default", () => {
    process.env.SUBAGENT_MAX_CONCURRENT = "0";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.maxConcurrent).toBe(5);
  });

  it("invalid SUBAGENT_TEMPERATURE falls back to agent value", () => {
    process.env.AGENT_TEMPERATURE = "0.7";
    process.env.SUBAGENT_TEMPERATURE = "5.0";
    const config = loadSubagentConfig(getAgentConfig());
    expect(config.temperature).toBe(0.7);
  });
});
