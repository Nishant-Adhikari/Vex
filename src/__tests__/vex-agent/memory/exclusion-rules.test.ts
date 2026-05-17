import { describe, it, expect } from "vitest";
import {
  scanLiveState,
  shouldRejectChunk,
} from "../../../vex-agent/memory/exclusion-rules.js";

describe("scanLiveState — rejects live-state chunks", () => {
  it("rejects chunk that is mostly balances and prices", () => {
    const text = "Wallet has 1.2 SOL, balance is 5000 USDC, current price $0.0042. Gas 5 gwei. Block 18293821.";
    const r = scanLiveState(text);
    expect(r.rejected).toBe(true);
    expect(r.liveStateMatches).toBeGreaterThanOrEqual(4);
    expect(r.categories.balance_amount).toBeGreaterThanOrEqual(1);
    expect(r.categories.fiat_price).toBeGreaterThanOrEqual(1);
    expect(r.categories.gas_amount).toBeGreaterThanOrEqual(1);
  });

  it("rejects chunk loaded with explicit literal state phrases", () => {
    const text = "Balance is 5 USDC. Current price = $1.05. Holdings is 100 SOL.";
    const r = scanLiveState(text);
    expect(r.rejected).toBe(true);
    expect(r.categories.literal_state).toBeGreaterThanOrEqual(1);
  });

  it("rejects chunk with gas + slippage + intent id density", () => {
    const text = "gas 5 gwei impact 0.15% slippage tx 0xabcd…1234 pending balance 1.2 SOL";
    const r = scanLiveState(text);
    expect(r.rejected).toBe(true);
  });
});

describe("scanLiveState — accepts durable narrative", () => {
  it("accepts a chunk about patterns / decisions / rationale", () => {
    const text =
      "User detected WIF momentum reversal pattern and signaled sell on 4-hour drop. " +
      "Decision rationale: momentum reversal plus user explicit signal, not full unwind because " +
      "user is keeping a moonbag position. Pattern observed: user prefers manual approval on large sells.";
    const r = scanLiveState(text);
    expect(r.rejected).toBe(false);
    expect(r.liveFraction).toBeLessThan(0.30);
  });

  it("accepts a chunk about lessons learned without numeric snapshots", () => {
    const text =
      "Lesson: Raydium pool failed with insufficient liquidity error, switched to Jupiter direct route which succeeded. " +
      "For SOL pairs above moderate size, prefer Jupiter direct over Raydium first hop.";
    const r = scanLiveState(text);
    expect(r.rejected).toBe(false);
  });

  it("accepts narrative that incidentally mentions one balance phrase", () => {
    const text =
      "Long narrative about the mission strategy and what we tried in the last hour of debugging. " +
      "User shared their wallet has 1.2 SOL but the key takeaway was their preference for conservative " +
      "position sizing, manual approvals, and skipping fresh launches. We aligned the strategy accordingly. " +
      "Documented multiple decisions about risk profile, trading hours, and slippage tolerance ceilings.";
    const r = scanLiveState(text);
    expect(r.rejected).toBe(false);
  });
});

describe("scanLiveState — edge cases", () => {
  it("handles empty string", () => {
    const r = scanLiveState("");
    expect(r.rejected).toBe(false);
    expect(r.liveStateMatches).toBe(0);
    expect(r.totalWords).toBe(0);
  });

  it("handles whitespace-only string", () => {
    const r = scanLiveState("   \n\t  ");
    expect(r.rejected).toBe(false);
  });
});

describe("shouldRejectChunk convenience", () => {
  it("returns true for live-state heavy chunk", () => {
    expect(
      shouldRejectChunk("balance 1.2 SOL $0.0042 5 gwei block 1829382"),
    ).toBe(true);
  });

  it("returns false for narrative chunk", () => {
    expect(
      shouldRejectChunk("User decided to hold based on momentum reversal pattern."),
    ).toBe(false);
  });
});
