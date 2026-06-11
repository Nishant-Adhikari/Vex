import { describe, it, expect } from "vitest";
import {
  isValidKind,
  MAX_KIND_LENGTH,
  RECALL_MAX_K,
  KNOWN_KINDS_LIMIT,
} from "@vex-agent/knowledge/policy.js";

describe("policy", () => {
  // ── isValidKind ──────────────────────────────────────────────

  describe("isValidKind", () => {
    it("accepts valid snake_case English kinds", () => {
      expect(isValidKind("memo")).toBe(true);
      expect(isValidKind("strategy_rule")).toBe(true);
      expect(isValidKind("pumpfun_entry_pattern")).toBe(true);
      expect(isValidKind("a")).toBe(true);
      expect(isValidKind("kind_with_3_numbers_42")).toBe(true);
    });

    it("rejects camelCase", () => {
      expect(isValidKind("pumpFun")).toBe(false);
      expect(isValidKind("strategyRule")).toBe(false);
    });

    it("rejects kebab-case", () => {
      expect(isValidKind("pump-fun")).toBe(false);
      expect(isValidKind("strategy-rule")).toBe(false);
    });

    it("rejects PascalCase", () => {
      expect(isValidKind("Pump_Fun")).toBe(false);
      expect(isValidKind("StrategyRule")).toBe(false);
    });

    it("rejects leading digit or underscore", () => {
      expect(isValidKind("1pump")).toBe(false);
      expect(isValidKind("_memo")).toBe(false);
    });

    it("rejects non-ASCII", () => {
      expect(isValidKind("pumpfün")).toBe(false);
      expect(isValidKind("禁忌")).toBe(false);
    });

    it("rejects empty and oversize", () => {
      expect(isValidKind("")).toBe(false);
      expect(isValidKind("a".repeat(MAX_KIND_LENGTH + 1))).toBe(false);
    });

    it("accepts exactly max length", () => {
      expect(isValidKind("a".repeat(MAX_KIND_LENGTH))).toBe(true);
    });

    it("rejects whitespace", () => {
      expect(isValidKind("memo entry")).toBe(false);
      expect(isValidKind(" memo")).toBe(false);
    });
  });

  // ── retrieval / prompt-section constants ─────────────────────

  describe("retrieval constants", () => {
    it("max k is 15", () => {
      expect(RECALL_MAX_K).toBe(15);
    });

    it("known kinds limit is 30", () => {
      expect(KNOWN_KINDS_LIMIT).toBe(30);
    });
  });
});
