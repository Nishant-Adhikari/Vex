/**
 * LIFECYCLE GUARD — stored `<enum>: <description>` stop conditions authorize.
 *
 * missions.stop_conditions_json stores conditions in the shape
 * `"<enum>: <human description>"`, e.g.
 * "no_viable_opportunity: nothing clears the sellability gate".
 *
 * The stop contract must recover the canonical enum from that shape, or the
 * model's `mission_stop(no_viable_opportunity)` is rejected as "not in the
 * accepted mission stop conditions" and the agent loops retrying the stop,
 * burning the run. no_viable_opportunity is the critical case: it has no
 * system-side enforcer, so `mission_stop` is its ONLY termination path.
 *
 * This guards the full contract → authorization path against a regression in
 * `normalizeStopConditionReason`'s enum parsing.
 */

import { describe, expect, it } from "vitest";

import {
  acceptedStopReasonsForMission,
  authorizeMissionStopReason,
} from "@vex-agent/engine/mission/stop-contract.js";
import type { Mission } from "@vex-agent/db/repos/missions.js";

const ACCEPTED_HASH = "0".repeat(64);

// The exact stored shape observed on the live app.
const STORED_STOP_CONDITIONS = [
  "deadline_reached: the 60-minute hard time-box has elapsed",
  "capital_depleted: the full $20 budget is spent",
  "max_loss_hit: the 8% stop-loss triggers",
  "no_viable_opportunity: nothing clears the sellability gate",
];

function acceptedMission(): Pick<Mission, "acceptedContractHash" | "stopConditionsJson"> {
  return {
    acceptedContractHash: ACCEPTED_HASH,
    stopConditionsJson: STORED_STOP_CONDITIONS,
  };
}

describe("lifecycle guard — enum:description stop conditions authorize mission_stop", () => {
  it("recovers every canonical enum from the stored `<enum>: <desc>` contract", () => {
    expect(acceptedStopReasonsForMission(acceptedMission())).toEqual([
      "deadline_reached",
      "capital_depleted",
      "max_loss_hit",
      "no_viable_opportunity",
    ]);
  });

  it("authorizes each stored reason (no_viable_opportunity must not loop)", () => {
    const mission = acceptedMission();
    for (const reason of [
      "deadline_reached",
      "capital_depleted",
      "max_loss_hit",
      "no_viable_opportunity",
    ] as const) {
      const authorization = authorizeMissionStopReason(mission, reason);
      expect(authorization.allowed, `expected ${reason} to be authorized`).toBe(true);
    }
  });
});
