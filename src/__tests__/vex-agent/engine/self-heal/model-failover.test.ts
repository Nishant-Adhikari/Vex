/**
 * Overnight self-heal — model failover (apply/restore, idempotent, fail-soft).
 * The provider registry reset is mocked to a spy so we assert the model swap
 * without touching the real provider cache.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

const resetProvider = vi.fn();
vi.mock("@vex-agent/inference/registry.js", () => ({
  resetProvider: () => resetProvider(),
}));

const {
  applyModelFailover,
  restorePrimaryModel,
  isFailedOver,
  __resetFailoverStateForTests,
} = await import("@vex-agent/engine/self-heal/model-failover.js");

afterEach(() => {
  __resetFailoverStateForTests();
  resetProvider.mockClear();
});

describe("applyModelFailover", () => {
  it("swaps AGENT_MODEL to the backup and resets the provider", () => {
    const env = { AGENT_MODEL: "primary-model", AGENT_MODEL_FALLBACK: "gemini-2.5-flash" };
    expect(applyModelFailover(env)).toBe(true);
    expect(env.AGENT_MODEL).toBe("gemini-2.5-flash");
    expect(isFailedOver()).toBe(true);
    expect(resetProvider).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — a second apply is a no-op", () => {
    const env = { AGENT_MODEL: "primary-model", AGENT_MODEL_FALLBACK: "backup" };
    expect(applyModelFailover(env)).toBe(true);
    expect(applyModelFailover(env)).toBe(false);
    expect(resetProvider).toHaveBeenCalledTimes(1);
  });

  it("no-op without a configured backup", () => {
    const env: Record<string, string | undefined> = { AGENT_MODEL: "primary-model" };
    expect(applyModelFailover(env)).toBe(false);
    expect(env.AGENT_MODEL).toBe("primary-model");
    expect(isFailedOver()).toBe(false);
  });

  it("no-op when backup equals the current model", () => {
    const env = { AGENT_MODEL: "same", AGENT_MODEL_FALLBACK: "same" };
    expect(applyModelFailover(env)).toBe(false);
    expect(isFailedOver()).toBe(false);
  });
});

describe("restorePrimaryModel", () => {
  it("restores the captured primary and resets the provider", () => {
    const env = { AGENT_MODEL: "primary-model", AGENT_MODEL_FALLBACK: "backup" };
    applyModelFailover(env);
    resetProvider.mockClear();
    expect(restorePrimaryModel(env)).toBe(true);
    expect(env.AGENT_MODEL).toBe("primary-model");
    expect(isFailedOver()).toBe(false);
    expect(resetProvider).toHaveBeenCalledTimes(1);
  });

  it("no-op when not currently failed over", () => {
    const env = { AGENT_MODEL: "primary-model" };
    expect(restorePrimaryModel(env)).toBe(false);
    expect(resetProvider).not.toHaveBeenCalled();
  });
});
