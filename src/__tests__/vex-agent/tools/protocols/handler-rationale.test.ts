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
