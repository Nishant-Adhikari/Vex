/**
 * `rationale()` — the write-side normaliser that threads the agent's stated
 * trade reason (a typed swap-tool param) into the trade-capture record. Agent-
 * authored, but still defended: C0 control chars + DEL → spaces, whitespace
 * collapsed, bounded to `TRADE_RATIONALE_MAX`, empty/absent → undefined so the
 * capture record omits the field rather than storing a fabricated one.
 */

import { describe, it, expect } from "vitest";
import {
  rationale,
  TRADE_RATIONALE_MAX,
} from "@vex-agent/tools/protocols/handler-helpers.js";
import { validateProtocolParams } from "@vex-agent/tools/protocols/runtime/params.js";
import { KYBERSWAP_TOOLS } from "@vex-agent/tools/protocols/kyberswap/manifest.js";
import { UNISWAP_SWAP_TOOLS } from "@vex-agent/tools/protocols/uniswap/manifests/swap.js";
import type { ProtocolToolManifest } from "@vex-agent/tools/protocols/types.js";

describe("rationale (write-side capture param)", () => {
  it("returns a trimmed, whitespace-collapsed reason", () => {
    expect(rationale({ rationale: "  Buying VENA   on strong momentum  " })).toBe(
      "Buying VENA on strong momentum",
    );
  });

  it("neutralises control characters (a newline-injected value cannot keep structure)", () => {
    expect(rationale({ rationale: "line one\nline two\ttabbed" })).toBe(
      "line one line two tabbed",
    );
  });

  it("returns undefined for a missing, non-string, or empty value", () => {
    expect(rationale({})).toBeUndefined();
    expect(rationale({ rationale: 42 })).toBeUndefined();
    expect(rationale({ rationale: "" })).toBeUndefined();
    expect(rationale({ rationale: "   " })).toBeUndefined();
  });

  it("bounds an oversized rationale to TRADE_RATIONALE_MAX", () => {
    const out = rationale({ rationale: "x".repeat(TRADE_RATIONALE_MAX + 200) });
    expect(out).toHaveLength(TRADE_RATIONALE_MAX);
  });
});

/**
 * `rationale` requiredness at the `execute_tool` param boundary. Making the
 * manifest param `required: true` means a swap.buy/swap.sell call the agent
 * submits WITHOUT a rationale is REJECTED by `validateProtocolParams` before the
 * handler runs — the agent sees a "Missing required parameter" error and retries
 * WITH a rationale (so trades can never land silently). A call WITH one passes.
 */
describe("rationale is a REQUIRED swap param (elicitation gate)", () => {
  const find = (tools: readonly ProtocolToolManifest[], id: string): ProtocolToolManifest => {
    const tool = tools.find((t) => t.toolId === id);
    if (!tool) throw new Error(`manifest not found: ${id}`);
    return tool;
  };

  const SWAP_TOOLS: readonly ProtocolToolManifest[] = [
    find(KYBERSWAP_TOOLS, "kyberswap.swap.buy"),
    find(KYBERSWAP_TOOLS, "kyberswap.swap.sell"),
    find(UNISWAP_SWAP_TOOLS, "uniswap.swap.buy"),
    find(UNISWAP_SWAP_TOOLS, "uniswap.swap.sell"),
  ];

  // A complete, valid param set for each swap tool EXCEPT the rationale — added
  // (or omitted) per-assertion. Chain/token/amount are placeholders; the param
  // boundary only type/required-checks them, it does not resolve them.
  const baseParams = (): Record<string, unknown> => ({
    chain: "base",
    tokenIn: "0x1111111111111111111111111111111111111111",
    tokenOut: "0x2222222222222222222222222222222222222222",
    amountIn: "10",
    slippageBps: 50,
  });

  for (const tool of SWAP_TOOLS) {
    it(`${tool.toolId} declares rationale required`, () => {
      const param = tool.params.find((p) => p.key === "rationale");
      expect(param).toBeDefined();
      expect(param?.required).toBe(true);
    });

    it(`${tool.toolId} REJECTS a swap with no rationale`, () => {
      const result = validateProtocolParams(tool, baseParams());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("rationale");
        expect(result.reason).toContain(tool.toolId);
      }
    });

    it(`${tool.toolId} REJECTS a swap with an empty-string rationale`, () => {
      const result = validateProtocolParams(tool, { ...baseParams(), rationale: "" });
      expect(result.ok).toBe(false);
    });

    it(`${tool.toolId} ACCEPTS a swap WITH a rationale`, () => {
      const result = validateProtocolParams(tool, {
        ...baseParams(),
        rationale: "Momentum breakout on rising volume — entering now.",
      });
      expect(result.ok).toBe(true);
    });
  }
});
