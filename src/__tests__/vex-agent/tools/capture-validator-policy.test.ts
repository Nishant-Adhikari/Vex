/**
 * Capture validator policy — documents the intentional fail-open behaviour
 * for tools without a `MUTATION_MATRIX` entry.
 *
 * The runtime gate `validateCaptureContract(toolId, tradeCapture)` is the
 * last check before sending a capture into the projection pipeline. Its
 * "unknown toolId" path returns `true` (fail-open) — which is correct for
 * non-mutating tools (they have no contract to validate against) but also
 * means a genuinely unregistered mutating tool would slip through.
 *
 * This test PINS that decision in place so a future reviewer sees it is
 * intentional rather than an accident. If we ever flip to fail-closed
 * (stricter — require every captured mutation to have a matrix entry),
 * that is a separate runtime behaviour change with its own PR and has to
 * come with a migration for any tool that legitimately had no matrix row.
 *
 * Pairs with `src/__tests__/vex-agent/sync/capture-contract.test.ts`
 * which asserts the structural side (every mutating tool IS in the
 * matrix) — together they cover both sides of the contract.
 */

import { describe, it, expect } from "vitest";

import { validateCaptureContract } from "@vex-agent/tools/protocols/capture-validator.js";

describe("capture validator — policy decisions", () => {
  describe("unknown toolId (no matrix entry)", () => {
    it("returns true with null capture — non-mutating tools have nothing to validate", () => {
      expect(validateCaptureContract("definitely.not.a.real.tool", null)).toBe(true);
    });

    it("returns true with a capture object — fail-open by intent", () => {
      // A genuinely unregistered mutating tool would also slip through here.
      // That is the price of letting non-mutating tools pass without a
      // matrix row. Structural completeness
      // (sync/capture-contract.test.ts) is the complementary guard that
      // ensures every *known* mutating tool DOES have a matrix row.
      expect(
        validateCaptureContract("definitely.not.a.real.tool", { type: "some_capture_type" }),
      ).toBe(true);
    });
  });

  // Note: the "known toolId with capture:'full'" arm is intentionally NOT
  // tested here. It is covered structurally in
  // `src/__tests__/vex-agent/sync/capture-contract.test.ts`, which walks
  // every mutating tool in PROTOCOL_TOOLS and asserts a matching
  // MUTATION_MATRIX row. Duplicating a wrapper call here would add no
  // observable behaviour, so the policy file stays focused on the
  // fail-open unknown-toolId decision.

  // ── B-006: synthetic captures are fail-CLOSED, distinct from the
  // fail-open non-synthetic unknown-tool path above. ───────────────
  describe("synthetic toolId branch (settlement_sync.*) — fail-closed", () => {
    const validSyntheticCapture = {
      type: "prediction",
      status: "closed",
      walletAddress: "GoVYsnz1111",
      positionKey: "PK1",
      instrumentKey: "solana:predict:POLY-123:yes",
      valuationSource: "none",
    };

    it("passes a valid synthetic capture through its contract", () => {
      expect(validateCaptureContract("settlement_sync.jupiter", validSyntheticCapture)).toBe(true);
    });

    it("returns false when a synthetic capture is missing required fields", () => {
      const { walletAddress: _drop, ...missingWallet } = validSyntheticCapture;
      void _drop;
      expect(validateCaptureContract("settlement_sync.jupiter", missingWallet)).toBe(false);
    });

    it("returns false for an unknown synthetic tool-id even with a full capture", () => {
      // The synthetic family does NOT inherit the fail-open path — an
      // unregistered settlement_sync.* tool is rejected.
      expect(validateCaptureContract("settlement_sync.notreal", validSyntheticCapture)).toBe(false);
    });

    it("returns false when a synthetic capture is null", () => {
      expect(validateCaptureContract("settlement_sync.jupiter", null)).toBe(false);
    });
  });

  // ── REGRESSION GUARD (Codex hard note): the synthetic branch must
  // NOT change the existing non-synthetic unknown-tool fall-through.
  // A non-synthetic tool with no MUTATION_MATRIX row still passes. ──
  describe("regression guard — non-synthetic unknown tool still fail-open", () => {
    it("a non-synthetic unknown tool with a capture still returns true", () => {
      expect(
        validateCaptureContract("some.unregistered.mutating.tool", { type: "swap" }),
      ).toBe(true);
    });

    it("a non-synthetic unknown tool with null capture still returns true", () => {
      expect(validateCaptureContract("some.unregistered.mutating.tool", null)).toBe(true);
    });

    it("'settlement_sync' as a bare prefix is NOT treated as synthetic (exact allowlist match only)", () => {
      // Guard the matcher is an exact allowlist, not a loose `startsWith`:
      // a tool literally named "settlement_sync" (no `.jupiter`/.polymarket)
      // is unknown→non-synthetic→fail-open, not synthetic→fail-closed.
      expect(validateCaptureContract("settlement_sync", { type: "swap" })).toBe(true);
    });
  });
});
