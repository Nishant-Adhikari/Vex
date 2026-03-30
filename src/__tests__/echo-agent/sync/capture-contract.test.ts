/**
 * Frozen coverage matrix — every mutating protocol tool classified by
 * PortfolioRole × CaptureSupport. Canonical source-of-truth for capture
 * requirements. Detects handler drift automatically.
 */

import { describe, it, expect } from "vitest";
import { PROTOCOL_TOOLS } from "../../../echo-agent/tools/protocols/catalog.js";
import type { PortfolioRole, CaptureSupport } from "../../../echo-agent/tools/protocols/types.js";

interface MatrixRow {
  toolId: string;
  role: PortfolioRole;
  capture: CaptureSupport;
}

// ── Frozen per-tool matrix ──────────────────────────────────────

const MATRIX: MatrixRow[] = [
  // ── pnl_spot ──────────────────────────────────────────────
  { toolId: "solana.swap.execute", role: "pnl_spot", capture: "full" },
  { toolId: "jaine.swap.sell", role: "pnl_spot", capture: "full" },
  { toolId: "jaine.swap.buy", role: "pnl_spot", capture: "full" },
  { toolId: "kyberswap.swap.sell", role: "pnl_spot", capture: "full" },
  { toolId: "kyberswap.swap.buy", role: "pnl_spot", capture: "full" },
  { toolId: "slop.trade.buy", role: "pnl_spot", capture: "full" },
  { toolId: "slop.trade.sell", role: "pnl_spot", capture: "full" },

  // ── pnl_prediction ────────────────────────────────────────
  { toolId: "solana.predict.buy", role: "pnl_prediction", capture: "full" },
  { toolId: "solana.predict.sell", role: "pnl_prediction", capture: "full" },
  { toolId: "solana.predict.claim", role: "pnl_prediction", capture: "full" },
  { toolId: "solana.predict.closeAll", role: "pnl_prediction", capture: "full" },
  { toolId: "polymarket.clob.buy", role: "pnl_prediction", capture: "full" },
  { toolId: "polymarket.clob.sell", role: "pnl_prediction", capture: "full" },
  { toolId: "polymarket.clob.cancel", role: "pnl_prediction", capture: "full" },
  { toolId: "polymarket.clob.cancelOrders", role: "pnl_prediction", capture: "full" },
  { toolId: "polymarket.clob.cancelAll", role: "pnl_prediction", capture: "full" },
  { toolId: "polymarket.clob.cancelMarket", role: "pnl_prediction", capture: "full" },

  // ── projection (orders, LP) ───────────────────────────────
  { toolId: "kyberswap.limitOrder.create", role: "projection", capture: "full" },
  { toolId: "kyberswap.limitOrder.cancel", role: "projection", capture: "full" },
  { toolId: "kyberswap.limitOrder.hardCancel", role: "projection", capture: "full" },
  { toolId: "kyberswap.limitOrder.fill", role: "projection", capture: "full" },
  { toolId: "kyberswap.limitOrder.batchFill", role: "projection", capture: "full" },
  { toolId: "kyberswap.limitOrder.cancelAll", role: "projection", capture: "full" },
  { toolId: "kyberswap.zap.in", role: "projection", capture: "full" },
  { toolId: "kyberswap.zap.out", role: "projection", capture: "full" },
  { toolId: "kyberswap.zap.migrate", role: "projection", capture: "full" },

  // ── audit (capture: full) ─────────────────────────────────
  { toolId: "khalani.bridge", role: "audit", capture: "full" },
  { toolId: "solana.lend.deposit", role: "audit", capture: "full" },
  { toolId: "solana.lend.withdraw", role: "audit", capture: "full" },
  { toolId: "slop.fees.claimCreator", role: "audit", capture: "full" },
  { toolId: "slop.fees.lpCollect", role: "audit", capture: "full" },
  { toolId: "slop.reward.claim", role: "audit", capture: "full" },
  { toolId: "jaine.w0g.wrap", role: "audit", capture: "full" },
  { toolId: "jaine.w0g.unwrap", role: "audit", capture: "full" },
  { toolId: "jaine.allowance.approve", role: "audit", capture: "full" },
  { toolId: "jaine.allowance.revoke", role: "audit", capture: "full" },
  { toolId: "slop.token.create", role: "audit", capture: "full" },

  // ── audit (capture: none — address creation, no direct tx) ─
  { toolId: "polymarket.bridge.deposit", role: "audit", capture: "none" },
  { toolId: "polymarket.bridge.withdraw", role: "audit", capture: "none" },

  // ── utility (no portfolio impact) ─────────────────────────
  { toolId: "echobook.post.create", role: "utility", capture: "none" },
  { toolId: "echobook.post.delete", role: "utility", capture: "none" },
  { toolId: "echobook.comment.create", role: "utility", capture: "none" },
  { toolId: "echobook.comment.delete", role: "utility", capture: "none" },
  { toolId: "echobook.follow.toggle", role: "utility", capture: "none" },
  { toolId: "echobook.vote.post", role: "utility", capture: "none" },
  { toolId: "echobook.vote.comment", role: "utility", capture: "none" },
  { toolId: "echobook.repost", role: "utility", capture: "none" },
  { toolId: "echobook.profile.update", role: "utility", capture: "none" },
  { toolId: "echobook.submolt.join", role: "utility", capture: "none" },
  { toolId: "echobook.submolt.leave", role: "utility", capture: "none" },
  { toolId: "echobook.tradeProof.submit", role: "utility", capture: "none" },
  { toolId: "echobook.notifications.markRead", role: "utility", capture: "none" },
  { toolId: "slop-app.profile.register", role: "utility", capture: "none" },
  { toolId: "slop-app.image.upload", role: "utility", capture: "none" },
  { toolId: "slop-app.image.generate", role: "utility", capture: "none" },
  { toolId: "slop-app.chat.post", role: "utility", capture: "none" },
  { toolId: "polymarket.clob.heartbeat", role: "utility", capture: "none" },
];

// ── Tests ────────────────────────────────────────────────────────

describe("capture contract coverage matrix", () => {
  const matrixMap = new Map(MATRIX.map(r => [r.toolId, r]));

  it("every mutating tool in PROTOCOL_TOOLS is in the matrix exactly once", () => {
    const mutatingTools = PROTOCOL_TOOLS.filter(t => t.mutating).map(t => t.toolId).sort();
    const matrixTools = MATRIX.map(r => r.toolId).sort();

    // Check completeness: every mutating tool is in matrix
    for (const toolId of mutatingTools) {
      expect(matrixMap.has(toolId), `Missing from matrix: ${toolId}`).toBe(true);
    }

    // Check no duplicates in matrix
    const seen = new Set<string>();
    for (const row of MATRIX) {
      expect(seen.has(row.toolId), `Duplicate in matrix: ${row.toolId}`).toBe(false);
      seen.add(row.toolId);
    }

    // Check no phantom entries (in matrix but not in PROTOCOL_TOOLS)
    const protocolToolIds = new Set(PROTOCOL_TOOLS.map(t => t.toolId));
    for (const row of MATRIX) {
      expect(protocolToolIds.has(row.toolId), `Phantom in matrix (not in PROTOCOL_TOOLS): ${row.toolId}`).toBe(true);
    }
  });

  it("non-mutating tools are NOT in the matrix", () => {
    const nonMutating = PROTOCOL_TOOLS.filter(t => !t.mutating).map(t => t.toolId);
    for (const toolId of nonMutating) {
      expect(matrixMap.has(toolId), `Non-mutating tool in matrix: ${toolId}`).toBe(false);
    }
  });

  it("audit capture:none has exactly 2 entries (polymarket bridge)", () => {
    const auditNone = MATRIX.filter(r => r.role === "audit" && r.capture === "none");
    expect(auditNone.map(r => r.toolId).sort()).toEqual([
      "polymarket.bridge.deposit",
      "polymarket.bridge.withdraw",
    ]);
  });

  it("utility tools all have capture:none", () => {
    const utility = MATRIX.filter(r => r.role === "utility");
    for (const row of utility) {
      expect(row.capture, `${row.toolId} should have capture:none`).toBe("none");
    }
  });

  it("pnl_spot tools all have capture:full", () => {
    const spot = MATRIX.filter(r => r.role === "pnl_spot");
    expect(spot.length).toBe(7);
    for (const row of spot) {
      expect(row.capture).toBe("full");
    }
  });
});
