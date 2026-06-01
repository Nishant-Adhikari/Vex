import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(0);
const mockExecuteWith = vi.fn().mockResolvedValue(0);
const mockQueryOne = vi.fn().mockResolvedValue(null);
const mockQuery = vi.fn().mockResolvedValue([]);

vi.mock("@vex-agent/db/client.js", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  executeWith: (...args: unknown[]) => mockExecuteWith(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: (...args: unknown[]) => mockQuery(...args),
}));

const {
  createDraft, updateDraft, mergeConstraintAutoRetry, setStatus, setApprovedAt,
  getMission, getMissionBySession, getActiveMission,
} = await import("../../../../vex-agent/db/repos/missions.js");

describe("missions repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createDraft ─────────────────────────────────────────────

  describe("createDraft", () => {
    it("inserts with status draft", async () => {
      await createDraft("mission-1", "session-1");
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO missions");
      expect(sql).toContain("'draft'");
      expect(params).toEqual(["mission-1", "session-1"]);
    });
  });

  // ── updateDraft ─────────────────────────────────────────────

  describe("updateDraft", () => {
    it("updates specified fields", async () => {
      await updateDraft("mission-1", { title: "SOL DCA", goal: "Accumulate SOL" });
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE missions SET");
      expect(sql).toContain("title");
      expect(sql).toContain("goal");
      expect(params).toContain("SOL DCA");
      expect(params).toContain("Accumulate SOL");
    });

    it("skips undefined fields", async () => {
      await updateDraft("mission-1", { title: "Only title" });
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).not.toContain("goal");
    });

    it("does nothing for empty fields", async () => {
      await updateDraft("mission-1", {});
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("serializes JSONB fields", async () => {
      await updateDraft("mission-1", {
        constraints_json: { maxLoss: "10%" },
        capital_source_json: { type: "wallet", amount: "500 USDC" },
        success_criteria_json: ["Goal met"],
        stop_conditions_json: ["capital_depleted"],
      });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("constraints_json = $1::jsonb");
      expect(sql).toContain("capital_source_json = $2::jsonb");
      expect(sql).toContain("success_criteria_json = $3::jsonb");
      expect(sql).toContain("stop_conditions_json = $4::jsonb");
      expect(params).toContainEqual('{"maxLoss":"10%"}');
      expect(params).toContainEqual('{"type":"wallet","amount":"500 USDC"}');
      expect(params).toContainEqual('["Goal met"]');
      expect(params).toContainEqual('["capital_depleted"]');
    });

    it("handles text array fields directly", async () => {
      await updateDraft("mission-1", {
        allowed_chains: ["solana", "ethereum"],
        allowed_protocols: ["solana"],
      });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("allowed_chains = $1");
      expect(sql).toContain("allowed_protocols = $2");
      expect(sql).not.toContain("allowed_chains = $1::jsonb");
      expect(sql).not.toContain("allowed_protocols = $2::jsonb");
      expect(params).toContainEqual(["solana", "ethereum"]);
      expect(params).toContainEqual(["solana"]);
    });

    it("sets updated_at on every update", async () => {
      await updateDraft("mission-1", { title: "Test" });
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain("updated_at = NOW()");
    });

    it("runs on the tx client when one is supplied", async () => {
      const client = {} as never;
      await updateDraft("mission-1", { title: "Test" }, client);
      // Routed through executeWith (the locked applyMissionPatch path),
      // never the pool-level execute.
      expect(mockExecuteWith).toHaveBeenCalledTimes(1);
      expect(mockExecute).not.toHaveBeenCalled();
      const [c] = mockExecuteWith.mock.calls[0]!;
      expect(c).toBe(client);
    });
  });

  // ── mergeConstraintAutoRetry (phase 4d-5) ──────────────────────

  describe("mergeConstraintAutoRetry", () => {
    it("merges the flag with `||` (never overwrites the column)", async () => {
      const client = {} as never;
      await mergeConstraintAutoRetry(client, "mission-1", true);
      expect(mockExecuteWith).toHaveBeenCalledTimes(1);
      const [c, sql, params] = mockExecuteWith.mock.calls[0]!;
      expect(c).toBe(client);
      expect(sql).toContain("||");
      expect(sql).toContain(
        "jsonb_build_object('autoRetryEnabled', $2::boolean)",
      );
      expect(sql).toContain("updated_at = NOW()");
      expect(params).toEqual(["mission-1", true]);
      // Guard against a regression to overwrite semantics.
      expect(sql).not.toMatch(/constraints_json\s*=\s*\$\d+::jsonb/);
    });

    it("passes enabled=false through unchanged", async () => {
      await mergeConstraintAutoRetry({} as never, "mission-1", false);
      const [, , params] = mockExecuteWith.mock.calls[0]!;
      expect(params).toEqual(["mission-1", false]);
    });
  });

  // ── setStatus ───────────────────────────────────────────────

  describe("setStatus", () => {
    it("updates status and updated_at", async () => {
      await setStatus("mission-1", "ready");
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("status = $1");
      expect(sql).toContain("updated_at = NOW()");
      expect(params).toEqual(["ready", "mission-1"]);
    });
  });

  // ── setApprovedAt ───────────────────────────────────────────

  describe("setApprovedAt", () => {
    it("sets approved_at and updated_at", async () => {
      await setApprovedAt("mission-1");
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("approved_at = NOW()");
      expect(sql).toContain("updated_at = NOW()");
      expect(params).toEqual(["mission-1"]);
    });
  });

  // ── getMission ──────────────────────────────────────────────

  describe("getMission", () => {
    it("returns null when not found", async () => {
      const result = await getMission("nonexistent");
      expect(result).toBeNull();
    });

    it("maps row to Mission", async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: "mission-1",
        root_session_id: "session-1",
        status: "draft",
        title: "Test Mission",
        goal: "Test goal",
        constraints_json: { maxLoss: "10%" },
        success_criteria_json: ["Goal met"],
        stop_conditions_json: ["capital_depleted"],
        risk_profile: "conservative",
        capital_source_json: { type: "wallet" },
        allowed_protocols: ["solana"],
        allowed_chains: ["solana"],
        allowed_wallets: ["solana"],
        created_at: new Date("2026-03-28"),
        updated_at: new Date("2026-03-28"),
        approved_at: null,
      });

      const mission = await getMission("mission-1");
      expect(mission).not.toBeNull();
      expect(mission!.id).toBe("mission-1");
      expect(mission!.rootSessionId).toBe("session-1");
      expect(mission!.status).toBe("draft");
      expect(mission!.title).toBe("Test Mission");
      expect(mission!.constraintsJson).toEqual({ maxLoss: "10%" });
      expect(mission!.successCriteriaJson).toEqual(["Goal met"]);
      expect(mission!.allowedProtocols).toEqual(["solana"]);
      expect(mission!.approvedAt).toBeNull();
    });
  });

  // ── getMissionBySession ─────────────────────────────────────

  describe("getMissionBySession", () => {
    it("queries by root_session_id", async () => {
      await getMissionBySession("session-1");
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("root_session_id = $1");
      expect(params).toEqual(["session-1"]);
    });
  });

  // ── getActiveMission ────────────────────────────────────────

  describe("getActiveMission", () => {
    it("excludes terminal statuses", async () => {
      await getActiveMission("session-1");
      const [sql] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("NOT IN ('completed', 'failed', 'cancelled')");
    });
  });
});
