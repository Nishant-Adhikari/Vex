/**
 * Overnight self-heal — pure policy primitives (kill switch, backoff ladder,
 * failover threshold, durable-classification reader, snapshot duration).
 */
import { describe, it, expect } from "vitest";
import {
  SELF_HEAL_BACKOFF_LADDER_MS,
  SELF_HEAL_FAILOVER_THRESHOLD,
  selfHealEnabled,
  resolveFallbackModel,
  selfHealBackoffMs,
  shouldFailover,
  evidenceIsTransient,
  snapshotDurationMinutes,
} from "@vex-agent/engine/self-heal/policy.js";

describe("selfHealEnabled (kill switch, default-on)", () => {
  it("defaults ON when unset", () => {
    expect(selfHealEnabled({})).toBe(true);
  });
  it("stays ON for any unrecognized / truthy value", () => {
    for (const v of ["true", "1", "on", "yes", "whatever", " "]) {
      expect(selfHealEnabled({ AGENT_SELF_HEAL_ENABLED: v })).toBe(true);
    }
  });
  it("only an explicit false-y value disables it", () => {
    for (const v of ["false", "0", "off", "no", "FALSE", " Off "]) {
      expect(selfHealEnabled({ AGENT_SELF_HEAL_ENABLED: v })).toBe(false);
    }
  });
});

describe("resolveFallbackModel", () => {
  it("null when unset or blank", () => {
    expect(resolveFallbackModel({})).toBeNull();
    expect(resolveFallbackModel({ AGENT_MODEL_FALLBACK: "   " })).toBeNull();
  });
  it("trims a configured backup", () => {
    expect(resolveFallbackModel({ AGENT_MODEL_FALLBACK: " gemini-2.5-flash " })).toBe(
      "gemini-2.5-flash",
    );
  });
});

describe("selfHealBackoffMs (1m→2m→5m→10m→15m, capped)", () => {
  it("walks the ladder then caps at the last rung", () => {
    expect(selfHealBackoffMs(0)).toBe(60_000);
    expect(selfHealBackoffMs(1)).toBe(120_000);
    expect(selfHealBackoffMs(2)).toBe(300_000);
    expect(selfHealBackoffMs(3)).toBe(600_000);
    expect(selfHealBackoffMs(4)).toBe(900_000);
    // capped
    expect(selfHealBackoffMs(5)).toBe(900_000);
    expect(selfHealBackoffMs(99)).toBe(900_000);
    expect(selfHealBackoffMs(SELF_HEAL_BACKOFF_LADDER_MS.length + 3)).toBe(900_000);
  });
  it("clamps garbage to the first rung", () => {
    expect(selfHealBackoffMs(-5)).toBe(60_000);
    expect(selfHealBackoffMs(Number.NaN)).toBe(60_000);
  });
});

describe("shouldFailover", () => {
  it("only fails over past the threshold AND with a configured backup", () => {
    expect(shouldFailover(SELF_HEAL_FAILOVER_THRESHOLD - 1, true)).toBe(false);
    expect(shouldFailover(SELF_HEAL_FAILOVER_THRESHOLD, true)).toBe(true);
    expect(shouldFailover(SELF_HEAL_FAILOVER_THRESHOLD + 5, true)).toBe(true);
  });
  it("never fails over without a backup, however many failures", () => {
    expect(shouldFailover(99, false)).toBe(false);
  });
});

describe("evidenceIsTransient (fail-closed)", () => {
  it("true only for the exact 'transient' stamp", () => {
    expect(evidenceIsTransient({ classified: "transient" })).toBe(true);
  });
  it("false for permanent / missing / malformed", () => {
    expect(evidenceIsTransient({ classified: "permanent" })).toBe(false);
    expect(evidenceIsTransient({})).toBe(false);
    expect(evidenceIsTransient(null)).toBe(false);
    expect(evidenceIsTransient(undefined)).toBe(false);
    expect(evidenceIsTransient({ classified: true } as never)).toBe(false);
  });
});

describe("snapshotDurationMinutes", () => {
  it("reads a valid structured duration", () => {
    expect(
      snapshotDurationMinutes({
        frozenMission: { constraintsJson: { durationMinutes: 45 } },
      }),
    ).toBe(45);
  });
  it("null on any missing / invalid level", () => {
    expect(snapshotDurationMinutes(null)).toBeNull();
    expect(snapshotDurationMinutes({})).toBeNull();
    expect(snapshotDurationMinutes({ frozenMission: {} })).toBeNull();
    expect(
      snapshotDurationMinutes({ frozenMission: { constraintsJson: { durationMinutes: 0 } } }),
    ).toBeNull();
    expect(
      snapshotDurationMinutes({ frozenMission: { constraintsJson: { durationMinutes: -3 } } }),
    ).toBeNull();
  });
});
