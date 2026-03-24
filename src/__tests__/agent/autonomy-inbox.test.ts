import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock DB layer
const mockQuery = vi.fn(async () => []);
const mockExecute = vi.fn(async () => {});

vi.mock("../../agent/db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  execute: (...args: unknown[]) => mockExecute(...args),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { publish, consumeAll, peek, formatEventsForContext } from "../../agent/autonomy-inbox.js";
import type { AutonomyInboxEvent } from "../../agent/types.js";

describe("autonomy-inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("publish", () => {
    it("inserts event into DB", async () => {
      await publish("compute_balance_low", { threshold: 0.5 });
      expect(mockExecute).toHaveBeenCalledOnce();
      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO autonomy_inbox");
      expect(params[0]).toBe("compute_balance_low");
      expect(JSON.parse(params[1] as string)).toEqual({ threshold: 0.5 });
    });

    it("does not throw on DB failure", async () => {
      mockExecute.mockRejectedValueOnce(new Error("DB down"));
      await expect(publish("external_alert", {})).resolves.toBeUndefined();
    });
  });

  describe("consumeAll", () => {
    it("returns empty array when no events", async () => {
      mockQuery.mockResolvedValueOnce([]);
      const events = await consumeAll();
      expect(events).toEqual([]);
    });

    it("uses CTE with FOR UPDATE SKIP LOCKED", async () => {
      mockQuery.mockResolvedValueOnce([]);
      await consumeAll();
      const sql = mockQuery.mock.calls[0]?.[0] as string;
      expect(sql).toContain("FOR UPDATE SKIP LOCKED");
      expect(sql).toContain("LIMIT");
    });

    it("sorts results by createdAt in app code", async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 2, event_type: "subagent_completed", payload: "{}", consumed: true, created_at: new Date("2026-03-24T10:01:00Z") },
        { id: 1, event_type: "compute_balance_low", payload: "{}", consumed: true, created_at: new Date("2026-03-24T10:00:00Z") },
      ]);
      const events = await consumeAll();
      expect(events[0].id).toBe(1);
      expect(events[1].id).toBe(2);
    });

    it("returns empty on DB error", async () => {
      mockQuery.mockRejectedValueOnce(new Error("DB down"));
      const events = await consumeAll();
      expect(events).toEqual([]);
    });
  });

  describe("formatEventsForContext", () => {
    it("returns empty string for no events", () => {
      expect(formatEventsForContext([])).toBe("");
    });

    it("formats compute_balance_low event", () => {
      const events: AutonomyInboxEvent[] = [{
        id: 1, eventType: "compute_balance_low",
        payload: { message: "Balance critically low" },
        consumed: true, createdAt: "2026-03-24T10:00:00Z",
      }];
      const result = formatEventsForContext(events);
      expect(result).toContain("[COMPUTE BALANCE ALERT]");
      expect(result).toContain("Balance critically low");
    });

    it("formats subagent_completed event", () => {
      const events: AutonomyInboxEvent[] = [{
        id: 2, eventType: "subagent_completed",
        payload: { name: "EchoSpark", summary: "Found 3 opportunities" },
        consumed: true, createdAt: "2026-03-24T10:00:00Z",
      }];
      const result = formatEventsForContext(events);
      expect(result).toContain("[SUBAGENT COMPLETED]");
      expect(result).toContain("EchoSpark");
    });

    it("wraps events in markers", () => {
      const events: AutonomyInboxEvent[] = [{
        id: 1, eventType: "external_alert",
        payload: { message: "Test" },
        consumed: true, createdAt: "2026-03-24T10:00:00Z",
      }];
      const result = formatEventsForContext(events);
      expect(result).toContain("--- Autonomy Events ---");
      expect(result).toContain("--- End Events ---");
    });
  });
});
