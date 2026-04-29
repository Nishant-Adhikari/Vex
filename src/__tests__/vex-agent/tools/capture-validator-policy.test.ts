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
});
