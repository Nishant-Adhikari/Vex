/**
 * parseWakeRuntimeConfig — engine-side wake env read (M11 D1).
 *
 * Validates the helper used by `src/mcp/index.ts` to skip
 * `startWakeExecutor` when AGENT_WAKE_ENABLED=false and to forward
 * AGENT_WAKE_INTERVAL_MS / AGENT_WAKE_BATCH_SIZE when valid.
 *
 * Invalid AGENT_WAKE_ENABLED values fall back to `true` (preserves
 * pre-M11 MCP behaviour where wake always started). Invalid integer
 * values fall back to executor compile-time defaults.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { parseWakeRuntimeConfig } = await import("../wake-config.js");

describe("parseWakeRuntimeConfig", () => {
  beforeEach(() => {
    // no state to reset
  });

  it("absent AGENT_WAKE_ENABLED → enabled=true (backwards compat)", () => {
    const result = parseWakeRuntimeConfig({});
    expect(result.enabled).toBe(true);
    expect(result.opts).toEqual({});
  });

  it("'true' → enabled=true", () => {
    const result = parseWakeRuntimeConfig({ AGENT_WAKE_ENABLED: "true" });
    expect(result.enabled).toBe(true);
  });

  it("'false' → enabled=false, opts={}", () => {
    const result = parseWakeRuntimeConfig({ AGENT_WAKE_ENABLED: "false" });
    expect(result.enabled).toBe(false);
    expect(result.opts).toEqual({});
  });

  it("invalid value → enabled=true (warn logged)", () => {
    const result = parseWakeRuntimeConfig({ AGENT_WAKE_ENABLED: "maybe" });
    expect(result.enabled).toBe(true);
  });

  it("forwards valid intervalMs + batchSize", () => {
    const result = parseWakeRuntimeConfig({
      AGENT_WAKE_ENABLED: "true",
      AGENT_WAKE_INTERVAL_MS: "1500",
      AGENT_WAKE_BATCH_SIZE: "7",
    });
    expect(result.enabled).toBe(true);
    expect(result.opts.intervalMs).toBe(1500);
    expect(result.opts.batchSize).toBe(7);
  });

  it("out-of-range intervalMs → falls back to undefined", () => {
    const result = parseWakeRuntimeConfig({
      AGENT_WAKE_ENABLED: "true",
      AGENT_WAKE_INTERVAL_MS: "99999999",
    });
    expect(result.opts.intervalMs).toBeUndefined();
  });

  it("out-of-range batchSize → falls back to undefined", () => {
    const result = parseWakeRuntimeConfig({
      AGENT_WAKE_ENABLED: "true",
      AGENT_WAKE_BATCH_SIZE: "0",
    });
    expect(result.opts.batchSize).toBeUndefined();
  });

  it("disabled wake: interval/batch values in env are IGNORED", () => {
    const result = parseWakeRuntimeConfig({
      AGENT_WAKE_ENABLED: "false",
      AGENT_WAKE_INTERVAL_MS: "1500",
      AGENT_WAKE_BATCH_SIZE: "7",
    });
    expect(result.enabled).toBe(false);
    expect(result.opts).toEqual({});
  });
});
