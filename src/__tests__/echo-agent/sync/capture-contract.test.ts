/**
 * Frozen coverage matrix — canonical source-of-truth from mutation-matrix.ts.
 *
 * Tests structural invariants (every mutating tool classified exactly once)
 * and contract invariants (expectedType, previewSupport, requiredFields).
 * Detects handler drift automatically.
 */

import { describe, it, expect, vi } from "vitest";
import { PROTOCOL_TOOLS } from "../../../echo-agent/tools/protocols/catalog.js";
import { MUTATION_MATRIX, getMatrixToolIds, getToolsByRole, isExpectedType } from "../../../echo-agent/tools/protocols/mutation-matrix.js";
import { validateCaptureContract, isPreviewExecution } from "../../../echo-agent/tools/protocols/capture-validator.js";
import type { PortfolioRole } from "../../../echo-agent/tools/protocols/types.js";

// ── Structural coverage ────────────────────────────────────────

describe("capture contract — structural coverage", () => {
  it("every mutating tool in PROTOCOL_TOOLS is in MUTATION_MATRIX exactly once", () => {
    const mutatingTools = PROTOCOL_TOOLS.filter(t => t.mutating).map(t => t.toolId).sort();
    const matrixTools = getMatrixToolIds().sort();

    for (const toolId of mutatingTools) {
      expect(MUTATION_MATRIX.has(toolId), `Missing from matrix: ${toolId}`).toBe(true);
    }

    const seen = new Set<string>();
    for (const toolId of matrixTools) {
      expect(seen.has(toolId), `Duplicate in matrix: ${toolId}`).toBe(false);
      seen.add(toolId);
    }
  });

  it("non-mutating tools are NOT in MUTATION_MATRIX", () => {
    const nonMutating = PROTOCOL_TOOLS.filter(t => !t.mutating).map(t => t.toolId);
    for (const toolId of nonMutating) {
      expect(MUTATION_MATRIX.has(toolId), `Non-mutating tool in matrix: ${toolId}`).toBe(false);
    }
  });

  it("no phantom entries (in matrix but not in PROTOCOL_TOOLS)", () => {
    const protocolToolIds = new Set(PROTOCOL_TOOLS.map(t => t.toolId));
    for (const toolId of getMatrixToolIds()) {
      expect(protocolToolIds.has(toolId), `Phantom in matrix (not in PROTOCOL_TOOLS): ${toolId}`).toBe(true);
    }
  });

  it("pnl_spot tools all have capture:full", () => {
    const spot = getToolsByRole("pnl_spot");
    expect(spot.length).toBe(7);
    for (const [toolId, c] of spot) {
      expect(c.capture, `${toolId} should have capture:full`).toBe("full");
    }
  });

  it("utility tools all have capture:none", () => {
    const utility = getToolsByRole("utility");
    for (const [toolId, c] of utility) {
      expect(c.capture, `${toolId} should have capture:none`).toBe("none");
    }
  });

  it("audit capture:none has exactly 2 entries (polymarket bridge)", () => {
    const auditNone = getToolsByRole("audit").filter(([, c]) => c.capture === "none");
    expect(auditNone.map(([id]) => id).sort()).toEqual([
      "polymarket.bridge.deposit",
      "polymarket.bridge.withdraw",
    ]);
  });
});

// ── Contract invariants ────────────────────────────────────────

describe("capture contract — contract invariants", () => {
  it("every capture:full tool has at least 1 requiredField", () => {
    for (const [toolId, c] of MUTATION_MATRIX) {
      if (c.capture === "full") {
        expect(c.requiredFields.length, `${toolId} capture:full but no requiredFields`).toBeGreaterThan(0);
      }
    }
  });

  it("every capture:none tool has empty requiredFields", () => {
    for (const [toolId, c] of MUTATION_MATRIX) {
      if (c.capture === "none") {
        expect(c.requiredFields.length, `${toolId} capture:none but has requiredFields`).toBe(0);
      }
    }
  });

  it("KyberSwap limitOrder tools all have expectedType 'order' (not 'swap')", () => {
    const loTools = getMatrixToolIds().filter(id => id.startsWith("kyberswap.limitOrder."));
    expect(loTools.length).toBeGreaterThanOrEqual(6);
    for (const toolId of loTools) {
      const c = MUTATION_MATRIX.get(toolId)!;
      expect(c.expectedType, `${toolId} should be "order"`).toBe("order");
    }
  });

  it("Polymarket buy/sell are dual-type (order|prediction)", () => {
    for (const toolId of ["polymarket.clob.buy", "polymarket.clob.sell"]) {
      const c = MUTATION_MATRIX.get(toolId)!;
      expect(Array.isArray(c.expectedType), `${toolId} should have dual expectedType`).toBe(true);
      expect(c.expectedType).toContain("prediction");
      expect(c.expectedType).toContain("order");
    }
  });

  it("Polymarket cancel* are type 'order' with role 'projection'", () => {
    const cancelTools = [
      "polymarket.clob.cancel", "polymarket.clob.cancelOrders",
      "polymarket.clob.cancelAll", "polymarket.clob.cancelMarket",
    ];
    for (const toolId of cancelTools) {
      const c = MUTATION_MATRIX.get(toolId)!;
      expect(c.expectedType, `${toolId} should be "order"`).toBe("order");
      expect(c.role, `${toolId} should be "projection"`).toBe("projection");
    }
  });

  it("bulk operations have fanOut: 'items'", () => {
    const bulkTools = [
      "solana.predict.closeAll",
      "kyberswap.limitOrder.batchFill",
      "kyberswap.limitOrder.cancelAll",
      "polymarket.clob.cancelOrders",
      "polymarket.clob.cancelAll",
      "polymarket.clob.cancelMarket",
    ];
    for (const toolId of bulkTools) {
      const c = MUTATION_MATRIX.get(toolId)!;
      expect(c.fanOut, `${toolId} should be fanOut:"items"`).toBe("items");
    }
  });

  it("solana.predict.claim has exception for instrumentKey", () => {
    const c = MUTATION_MATRIX.get("solana.predict.claim")!;
    expect(c.exceptions).toBeDefined();
    expect(c.exceptions!.some(e => e.includes("instrumentKey"))).toBe(true);
  });
});

// ── Capture validator tests ────────────────────────────────────

describe("capture contract — runtime validator", () => {
  it("validates pnl_spot with all required fields", () => {
    const valid = validateCaptureContract("solana.swap.execute", {
      type: "swap", walletAddress: "0x", tradeSide: "buy",
      instrumentKey: "solana:BONK", inputTokenAddress: "0xA", outputTokenAddress: "0xB",
      inputAmount: "100", outputAmount: "200",
    });
    expect(valid).toBe(true);
  });

  it("rejects pnl_spot missing tradeSide", () => {
    const valid = validateCaptureContract("solana.swap.execute", {
      type: "swap", walletAddress: "0x",
      instrumentKey: "solana:BONK", inputTokenAddress: "0xA", outputTokenAddress: "0xB",
      inputAmount: "100", outputAmount: "200",
    });
    expect(valid).toBe(false);
  });

  it("rejects capture:full with null tradeCapture", () => {
    expect(validateCaptureContract("solana.swap.execute", null)).toBe(false);
  });

  it("passes capture:none regardless of tradeCapture", () => {
    expect(validateCaptureContract("echobook.post.create", null)).toBe(true);
    expect(validateCaptureContract("echobook.post.create", { type: "social" })).toBe(true);
  });

  it("passes unknown toolId (not in matrix)", () => {
    expect(validateCaptureContract("unknown.tool", null)).toBe(true);
  });

  it("solana.predict.claim passes without instrumentKey (exception)", () => {
    const valid = validateCaptureContract("solana.predict.claim", {
      type: "prediction", walletAddress: "0x", status: "claimed", positionKey: "PK1",
    });
    expect(valid).toBe(true);
  });

  it("rejects unexpected type", () => {
    const valid = validateCaptureContract("solana.swap.execute", {
      type: "prediction", walletAddress: "0x", tradeSide: "buy",
      instrumentKey: "solana:BONK", inputTokenAddress: "0xA", outputTokenAddress: "0xB",
      inputAmount: "100", outputAmount: "200",
    });
    expect(valid).toBe(false);
  });

  it("accepts dual-type tool with either valid type", () => {
    const base = { walletAddress: "0x", status: "executed", positionKey: "pk", instrumentKey: "ik" };
    expect(validateCaptureContract("polymarket.clob.buy", { ...base, type: "prediction" })).toBe(true);
    expect(validateCaptureContract("polymarket.clob.buy", { ...base, type: "order" })).toBe(true);
    expect(validateCaptureContract("polymarket.clob.buy", { ...base, type: "swap" })).toBe(false);
  });

  it("rejects capture without type field (F4: type is required for all capture:full)", () => {
    const valid = validateCaptureContract("solana.swap.execute", {
      walletAddress: "0x", tradeSide: "buy",
      instrumentKey: "solana:BONK", inputTokenAddress: "0xA", outputTokenAddress: "0xB",
      inputAmount: "100", outputAmount: "200",
      // no type field
    });
    expect(valid).toBe(false);
  });
});

// ── Preview detection tests ────────────────────────────────────

describe("capture contract — preview detection", () => {
  it("detects preview for tools with previewSupport", () => {
    expect(isPreviewExecution("jaine.swap.sell", { dryRun: true })).toBe(true);
    expect(isPreviewExecution("kyberswap.limitOrder.batchFill", { dryRun: true })).toBe(true);
    expect(isPreviewExecution("khalani.bridge", { dryRun: true })).toBe(true);
    expect(isPreviewExecution("polymarket.clob.buy", { dryRun: true })).toBe(true);
  });

  it("does not detect preview when dryRun is false or absent", () => {
    expect(isPreviewExecution("jaine.swap.sell", { dryRun: false })).toBe(false);
    expect(isPreviewExecution("jaine.swap.sell", {})).toBe(false);
  });

  it("does not detect preview for tools without previewSupport", () => {
    expect(isPreviewExecution("solana.swap.execute", { dryRun: true })).toBe(false);
    expect(isPreviewExecution("solana.predict.buy", { dryRun: true })).toBe(false);
    expect(isPreviewExecution("polymarket.clob.cancel", { dryRun: true })).toBe(false);
  });
});
