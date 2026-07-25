/**
 * Hard per-mission COST CAP (US dollars) — the PRIMARY spend-box.
 *
 * The mission budget is enforced on real, cache-discounted inference COST
 * (summed `usage_log.cost`) rather than gross tokens, so prompt-cache savings
 * extend runway. This file pins the resolver seams that live OUTSIDE the turn
 * loop (the loop-stop / banner behaviour is covered by turn-loop tests and
 * `budget-pressure.test.ts`):
 *
 *   1. Env parse — `AGENT_MISSION_COST_CAP_USD`, default $1.00 when
 *      unset/invalid (fail-soft, matching the token-budget + deadline stance).
 *   2. Disable sentinels — `0`/`off`/`none`/`unlimited`/`disabled` turn the cap
 *      off (`null` = no box), the ONLY way to remove the backstop.
 *   3. Per-mission override — a positive frozen `costCapUsd` wins over the env
 *      default (mirrors how `durationMinutes` overrides the env deadline), and
 *      `frozenCostCapUsd` reads it fail-open from the frozen contract snapshot.
 */

import { describe, it, expect } from "vitest";
import { resolveMissionCostCap } from "../../../../../lib/agent-config.js";
import { frozenCostCapUsd } from "../../../../../vex-agent/engine/mission/mission-deadline.js";

// ── 1. Env parse (default + explicit + fail-soft) ───────────────

describe("resolveMissionCostCap — AGENT_MISSION_COST_CAP_USD", () => {
  it("defaults to $1.00 when unset", () => {
    expect(resolveMissionCostCap({})).toBe(1.0);
  });

  it("defaults to $1.00 when blank/whitespace", () => {
    expect(resolveMissionCostCap({ AGENT_MISSION_COST_CAP_USD: "   " })).toBe(1.0);
  });

  it("honors an explicit, well-formed dollar value", () => {
    expect(resolveMissionCostCap({ AGENT_MISSION_COST_CAP_USD: "2.5" })).toBe(2.5);
    expect(resolveMissionCostCap({ AGENT_MISSION_COST_CAP_USD: "0.42" })).toBe(0.42);
  });

  it("fails soft to $1.00 on a non-numeric or out-of-range value", () => {
    expect(resolveMissionCostCap({ AGENT_MISSION_COST_CAP_USD: "lots" })).toBe(1.0);
    expect(resolveMissionCostCap({ AGENT_MISSION_COST_CAP_USD: "-5" })).toBe(1.0);
    expect(resolveMissionCostCap({ AGENT_MISSION_COST_CAP_USD: "9999999999" })).toBe(1.0);
  });
});

// ── 2. Disable sentinels ────────────────────────────────────────

describe("resolveMissionCostCap — disable sentinels", () => {
  it.each(["0", "off", "none", "unlimited", "disable", "disabled", "OFF", " None "])(
    "resolves %s to null (cap disabled)",
    (raw) => {
      expect(resolveMissionCostCap({ AGENT_MISSION_COST_CAP_USD: raw })).toBeNull();
    },
  );

  it("a disable sentinel wins over a per-mission override (global kill switch)", () => {
    expect(
      resolveMissionCostCap({ AGENT_MISSION_COST_CAP_USD: "off" }, 5),
    ).toBeNull();
  });
});

// ── 3. Per-mission override ─────────────────────────────────────

describe("resolveMissionCostCap — per-mission override", () => {
  it("a positive per-mission cap wins over the env default", () => {
    expect(resolveMissionCostCap({}, 0.5)).toBe(0.5);
  });

  it("a positive per-mission cap wins over an explicit env value", () => {
    expect(
      resolveMissionCostCap({ AGENT_MISSION_COST_CAP_USD: "3" }, 0.75),
    ).toBe(0.75);
  });

  it("ignores a non-positive / non-finite override and falls back to env/default", () => {
    expect(resolveMissionCostCap({}, 0)).toBe(1.0);
    expect(resolveMissionCostCap({}, -2)).toBe(1.0);
    expect(resolveMissionCostCap({}, Number.NaN)).toBe(1.0);
    expect(resolveMissionCostCap({ AGENT_MISSION_COST_CAP_USD: "2" }, null)).toBe(2);
  });
});

describe("frozenCostCapUsd — frozen contract reader", () => {
  it("reads a positive costCapUsd from the frozen draft", () => {
    expect(
      frozenCostCapUsd({ frozenMission: { draft: { costCapUsd: 0.5 } } }),
    ).toBe(0.5);
  });

  it("fails open to null on missing/malformed/non-positive values", () => {
    expect(frozenCostCapUsd(null)).toBeNull();
    expect(frozenCostCapUsd({})).toBeNull();
    expect(frozenCostCapUsd({ frozenMission: {} })).toBeNull();
    expect(frozenCostCapUsd({ frozenMission: { draft: {} } })).toBeNull();
    expect(
      frozenCostCapUsd({ frozenMission: { draft: { costCapUsd: 0 } } }),
    ).toBeNull();
    expect(
      frozenCostCapUsd({ frozenMission: { draft: { costCapUsd: "1.5" } } }),
    ).toBeNull();
  });
});
