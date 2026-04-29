import { describe, it, expect } from "vitest";

import type {
  SessionKind,
  LoopMode,
  MissionStatus,
  MissionRunStatus,
  BusinessStopReason,
  RuntimeStopReason,
  StopReason,
  MessageSource,
  MessageType,
  MessageVisibility,
  MissionDraft,
  MissionPatch,
  EngineContext,
  TurnResult,
  MessageMetadata,
} from "../../../vex-agent/engine/types.js";

import { MISSION_DRAFT_REQUIRED_FIELDS } from "../../../vex-agent/engine/types.js";

describe("engine types", () => {
  // ── Session axes ────────────────────────────────────────────────

  describe("SessionKind", () => {
    it("accepts valid values", () => {
      const values: SessionKind[] = ["chat", "mission", "full_autonomous"];
      expect(values).toHaveLength(3);
    });
  });

  describe("LoopMode", () => {
    it("accepts valid values", () => {
      const values: LoopMode[] = ["off", "restricted", "full"];
      expect(values).toHaveLength(3);
    });
  });

  // ── Mission lifecycle ───────────────────────────────────────────

  describe("MissionStatus", () => {
    it("covers full lifecycle", () => {
      const values: MissionStatus[] = ["draft", "ready", "running", "completed", "failed", "cancelled"];
      expect(values).toHaveLength(6);
    });
  });

  describe("MissionRunStatus", () => {
    it("covers run states including pause reasons", () => {
      const values: MissionRunStatus[] = ["running", "paused_approval", "completed", "failed", "stopped"];
      expect(values).toHaveLength(5);
    });
  });

  // ── Stop conditions ─────────────────────────────────────────────

  describe("BusinessStopReason", () => {
    it("covers all business stop reasons", () => {
      const values: BusinessStopReason[] = [
        "goal_reached", "deadline_reached", "capital_depleted",
        "max_loss_hit", "no_viable_opportunity", "user_stopped",
      ];
      expect(values).toHaveLength(6);
    });
  });

  describe("RuntimeStopReason", () => {
    it("covers all runtime stop reasons", () => {
      const values: RuntimeStopReason[] = [
        "approval_required", "checkpoint_pause", "iteration_limit",
        "timeout", "waiting_for_parent", "system_error",
      ];
      expect(values).toHaveLength(6);
    });
  });

  describe("StopReason", () => {
    it("is union of business and runtime", () => {
      const business: StopReason = "goal_reached";
      const runtime: StopReason = "approval_required";
      expect(business).toBe("goal_reached");
      expect(runtime).toBe("approval_required");
    });
  });

  // ── Message taxonomy ──────────────────────────────────────────

  describe("MessageSource", () => {
    it("covers all sources", () => {
      const values: MessageSource[] = ["user", "assistant", "engine", "tool", "subagent", "system"];
      expect(values).toHaveLength(6);
    });
  });

  describe("MessageType", () => {
    it("covers all message types", () => {
      const values: MessageType[] = [
        "chat", "mission_setup", "mission_summary", "approval_pause",
        "continue", "checkpoint", "subagent_relay", "tool_result",
      ];
      expect(values).toHaveLength(8);
    });
  });

  describe("MessageVisibility", () => {
    it("covers user and internal", () => {
      const values: MessageVisibility[] = ["user", "internal"];
      expect(values).toHaveLength(2);
    });
  });

  // ── MissionDraft ──────────────────────────────────────────────

  describe("MissionDraft", () => {
    it("has all expected fields", () => {
      const draft: MissionDraft = {
        title: null,
        goal: null,
        capitalSource: null,
        startingCapital: null,
        allowedWallets: null,
        allowedChains: null,
        allowedProtocols: null,
        riskProfile: null,
        successCriteria: null,
        stopConditions: null,
        deadline: null,
      };
      expect(Object.keys(draft)).toHaveLength(11);
    });

    it("accepts populated values", () => {
      const draft: MissionDraft = {
        title: "SOL DCA Strategy",
        goal: "Accumulate 10 SOL over 7 days",
        capitalSource: "wallet",
        startingCapital: "500 USDC",
        allowedWallets: ["solana"],
        allowedChains: ["solana"],
        allowedProtocols: ["solana"],
        riskProfile: "conservative",
        successCriteria: ["Accumulated 10 SOL"],
        stopConditions: ["capital_depleted", "deadline_reached"],
        deadline: "2026-04-04",
      };
      expect(draft.title).toBe("SOL DCA Strategy");
      expect(draft.allowedChains).toEqual(["solana"]);
    });
  });

  describe("MISSION_DRAFT_REQUIRED_FIELDS", () => {
    it("contains exactly 10 required fields", () => {
      expect(MISSION_DRAFT_REQUIRED_FIELDS).toHaveLength(10);
    });

    it("does not include deadline (optional)", () => {
      expect(MISSION_DRAFT_REQUIRED_FIELDS).not.toContain("deadline");
    });

    it("includes all business-critical fields", () => {
      const expected = [
        "title", "goal", "capitalSource", "startingCapital",
        "allowedWallets", "allowedChains", "allowedProtocols",
        "riskProfile", "successCriteria", "stopConditions",
      ];
      for (const field of expected) {
        expect(MISSION_DRAFT_REQUIRED_FIELDS).toContain(field);
      }
    });
  });

  // ── EngineContext ─────────────────────────────────────────────

  describe("EngineContext", () => {
    it("has all expected fields", () => {
      const ctx: EngineContext = {
        sessionId: "session-1",
        sessionKind: "chat",
        loopMode: "off",
        missionId: null,
        missionRunId: null,
        isSubagent: false,
        loadedDocuments: new Map(),
        memoryScopeKey: "session-1",
      };
      expect(ctx.sessionId).toBe("session-1");
      expect(ctx.isSubagent).toBe(false);
      expect(ctx.memoryScopeKey).toBe("session-1");
    });

    it("supports mission context", () => {
      const ctx: EngineContext = {
        sessionId: "session-2",
        sessionKind: "mission",
        loopMode: "restricted",
        missionId: "mission-1",
        missionRunId: "run-1",
        isSubagent: false,
        loadedDocuments: new Map([["doc/strategy", "# Strategy"]]),
        memoryScopeKey: "session-2",
      };
      expect(ctx.missionId).toBe("mission-1");
      expect(ctx.loadedDocuments.size).toBe(1);
    });

    it("supports subagent context", () => {
      const ctx: EngineContext = {
        sessionId: "session-3",
        sessionKind: "mission",
        loopMode: "restricted",
        missionId: "mission-1",
        missionRunId: "run-1",
        isSubagent: true,
        loadedDocuments: new Map(),
        memoryScopeKey: "parent-session",
      };
      expect(ctx.isSubagent).toBe(true);
      expect(ctx.memoryScopeKey).toBe("parent-session");
    });
  });

  // ── TurnResult ────────────────────────────────────────────────

  describe("TurnResult", () => {
    it("represents a text-only chat response", () => {
      const result: TurnResult = {
        text: "Here is your balance.",
        toolCallsMade: 1,
        pendingApprovals: [],
        stopReason: null,
        missionStatus: null,
      };
      expect(result.text).toBeTruthy();
      expect(result.pendingApprovals).toHaveLength(0);
    });

    it("represents an approval pause", () => {
      const result: TurnResult = {
        text: null,
        toolCallsMade: 3,
        pendingApprovals: ["approval-1", "approval-2"],
        stopReason: "approval_required",
        missionStatus: "running",
      };
      expect(result.pendingApprovals).toHaveLength(2);
      expect(result.stopReason).toBe("approval_required");
    });

    it("represents a completed mission", () => {
      const result: TurnResult = {
        text: "Mission complete — accumulated 10 SOL.",
        toolCallsMade: 15,
        pendingApprovals: [],
        stopReason: "goal_reached",
        missionStatus: "completed",
      };
      expect(result.stopReason).toBe("goal_reached");
      expect(result.missionStatus).toBe("completed");
    });
  });

  // ── MessageMetadata ───────────────────────────────────────────

  describe("MessageMetadata", () => {
    it("all fields are optional", () => {
      const empty: MessageMetadata = {};
      expect(Object.keys(empty)).toHaveLength(0);
    });

    it("accepts full metadata", () => {
      const meta: MessageMetadata = {
        source: "engine",
        messageType: "continue",
        visibility: "internal",
        originSessionId: "session-parent",
        subagentId: "subagent-1",
      };
      expect(meta.source).toBe("engine");
      expect(meta.visibility).toBe("internal");
    });
  });
});
