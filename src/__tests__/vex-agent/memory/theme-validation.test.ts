import { describe, it, expect } from "vitest";
import {
  validateTheme,
  buildFallbackTheme,
} from "../../../vex-agent/memory/theme-validation.js";

describe("validateTheme — accepts well-formed themes", () => {
  it("accepts 3-token slug with entity + verb", () => {
    const r = validateTheme("kyber_quote_timeout");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.theme).toBe("kyber_quote_timeout");
  });

  it("accepts up to 8 tokens", () => {
    const r = validateTheme("solana_wif_position_unwind_user_signal_observed_pattern");
    expect(r.ok).toBe(true);
  });

  it("accepts compound theme containing a stoplist token", () => {
    // `debug` alone is bad, but `kyber_quote_debug` is fine because non-trivial
    // tokens include `kyber` and `quote` which are not in the stoplist.
    const r = validateTheme("kyber_quote_debug");
    expect(r.ok).toBe(true);
  });

  it("accepts alphanumeric tokens (model version suffixes)", () => {
    const r = validateTheme("memecoin_strategy_v2_solana");
    expect(r.ok).toBe(true);
  });
});

describe("validateTheme — rejects degenerate themes", () => {
  it("rejects empty string", () => {
    const r = validateTheme("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });

  it("rejects non-string input", () => {
    const r = validateTheme(42 as unknown);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_string");
  });

  it("rejects single-token theme", () => {
    const r = validateTheme("debug");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_short");
  });

  it("rejects two-token theme", () => {
    const r = validateTheme("debug_session");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_short");
  });

  it("rejects all-stoplist theme even with 3+ tokens", () => {
    const r = validateTheme("debug_session_mission");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("standalone_stopword");
  });

  it("rejects leading-digit token", () => {
    const r = validateTheme("1solana_strategy_v1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("shape_invalid");
  });

  it("rejects kebab-case (splits to one token under _ delimiter)", () => {
    const r = validateTheme("kyber-quote-timeout");
    expect(r.ok).toBe(false);
    // Split by underscore yields one token — caught by length check before shape.
    if (!r.ok) expect(r.reason).toBe("too_short");
  });

  it("rejects 3-token kebab-case-with-underscores hybrid via shape regex", () => {
    // 3 tokens by underscore but each contains a dash, which the shape regex rejects.
    const r = validateTheme("kyber-x_quote-y_timeout-z");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("shape_invalid");
  });

  it("rejects uppercase letters", () => {
    const r = validateTheme("Kyber_Quote_Timeout");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("shape_invalid");
  });
});

describe("buildFallbackTheme", () => {
  it("composes entity + task when both present", () => {
    const theme = buildFallbackTheme({
      entities: ["WIF"],
      protocols: [],
      errorClasses: [],
      chains: ["solana"],
      tasks: ["sell_50_pct"],
      generation: 3,
    });
    expect(theme).toMatch(/^wif_/);
    expect(validateTheme(theme).ok).toBe(true);
  });

  it("uses chain when task absent", () => {
    const theme = buildFallbackTheme({
      entities: ["BONK"],
      protocols: [],
      errorClasses: [],
      chains: ["solana"],
      tasks: [],
      generation: 5,
    });
    expect(theme).toContain("solana");
    expect(validateTheme(theme).ok).toBe(true);
  });

  it("falls back to unclassified when everything empty", () => {
    const theme = buildFallbackTheme({
      entities: [],
      protocols: [],
      errorClasses: [],
      chains: [],
      tasks: [],
      generation: 7,
    });
    expect(theme).toContain("unclassified");
    expect(validateTheme(theme).ok).toBe(true);
  });

  it("skips entities matching stoplist", () => {
    const theme = buildFallbackTheme({
      entities: ["session", "mission", "actually_useful"],
      protocols: [],
      errorClasses: [],
      chains: [],
      tasks: ["analysis"],
      generation: 1,
    });
    expect(theme).toMatch(/actually_useful/);
  });
});
