import { describe, it, expect } from "vitest";

import {
  isBusinessStop,
  isRuntimePause,
  isResumablePause,
  shouldTerminateRun,
  evaluateRuntimeStopConditions,
} from "../../../../vex-agent/engine/core/stop-conditions.js";

import type { StopReason } from "../../../../vex-agent/engine/types.js";

describe("stop-conditions", () => {
  // ── Classification ──────────────────────────────────────────

  describe("isBusinessStop", () => {
    const businessReasons: StopReason[] = [
      "goal_reached", "deadline_reached", "capital_depleted",
      "max_loss_hit", "no_viable_opportunity", "user_stopped",
    ];

    for (const reason of businessReasons) {
      it(`classifies "${reason}" as business stop`, () => {
        expect(isBusinessStop(reason)).toBe(true);
      });
    }

    it("rejects runtime reasons", () => {
      expect(isBusinessStop("approval_required")).toBe(false);
      expect(isBusinessStop("checkpoint_pause")).toBe(false);
      expect(isBusinessStop("iteration_limit")).toBe(false);
    });
  });

  describe("isRuntimePause", () => {
    const runtimeReasons: StopReason[] = [
      "approval_required", "checkpoint_pause", "iteration_limit",
      "timeout", "waiting_for_parent", "waiting_for_wake", "system_error",
    ];

    for (const reason of runtimeReasons) {
      it(`classifies "${reason}" as runtime pause`, () => {
        expect(isRuntimePause(reason)).toBe(true);
      });
    }

    it("rejects business reasons", () => {
      expect(isRuntimePause("goal_reached")).toBe(false);
      expect(isRuntimePause("user_stopped")).toBe(false);
    });
  });

  describe("isResumablePause (PR-6)", () => {
    it("classifies the three resumable pauses as resumable", () => {
      expect(isResumablePause("approval_required")).toBe(true);
      expect(isResumablePause("waiting_for_wake")).toBe(true);
      expect(isResumablePause("checkpoint_pause")).toBe(true);
    });

    it("rejects runtime pauses that require a fresh kick (not a resume)", () => {
      expect(isResumablePause("iteration_limit")).toBe(false);
      expect(isResumablePause("timeout")).toBe(false);
      expect(isResumablePause("system_error")).toBe(false);
      expect(isResumablePause("waiting_for_parent")).toBe(false);
    });

    it("rejects business stops (terminal, not resumable)", () => {
      expect(isResumablePause("goal_reached")).toBe(false);
      expect(isResumablePause("user_stopped")).toBe(false);
    });
  });

  describe("shouldTerminateRun", () => {
    it("terminates on business stops", () => {
      expect(shouldTerminateRun("goal_reached")).toBe(true);
      expect(shouldTerminateRun("capital_depleted")).toBe(true);
      expect(shouldTerminateRun("user_stopped")).toBe(true);
    });

    it("does not terminate on runtime pauses", () => {
      expect(shouldTerminateRun("approval_required")).toBe(false);
      expect(shouldTerminateRun("checkpoint_pause")).toBe(false);
      expect(shouldTerminateRun("iteration_limit")).toBe(false);
      expect(shouldTerminateRun("timeout")).toBe(false);
    });
  });

  // ── Evaluation ──────────────────────────────────────────────

  describe("evaluateRuntimeStopConditions", () => {
    it("returns null when no conditions met", () => {
      const result = evaluateRuntimeStopConditions({
        iterationCount: 5,
        maxIterations: 100,
        elapsedMs: 10000,
        timeoutMs: 300000,
      });
      expect(result).toBeNull();
    });

    it("returns iteration_limit at max", () => {
      const result = evaluateRuntimeStopConditions({
        iterationCount: 100,
        maxIterations: 100,
        elapsedMs: 10000,
        timeoutMs: 300000,
      });
      expect(result).toBe("iteration_limit");
    });

    it("returns iteration_limit when exceeded", () => {
      const result = evaluateRuntimeStopConditions({
        iterationCount: 150,
        maxIterations: 100,
        elapsedMs: 10000,
        timeoutMs: 300000,
      });
      expect(result).toBe("iteration_limit");
    });

    it("returns timeout when elapsed exceeds limit", () => {
      const result = evaluateRuntimeStopConditions({
        iterationCount: 5,
        maxIterations: 100,
        elapsedMs: 300000,
        timeoutMs: 300000,
      });
      expect(result).toBe("timeout");
    });

    it("prefers iteration_limit over timeout", () => {
      const result = evaluateRuntimeStopConditions({
        iterationCount: 100,
        maxIterations: 100,
        elapsedMs: 300000,
        timeoutMs: 300000,
      });
      expect(result).toBe("iteration_limit");
    });

    it("handles zero-value edge cases", () => {
      const result = evaluateRuntimeStopConditions({
        iterationCount: 0,
        maxIterations: 0,
        elapsedMs: 0,
        timeoutMs: 0,
      });
      expect(result).toBe("iteration_limit");
    });
  });
});
