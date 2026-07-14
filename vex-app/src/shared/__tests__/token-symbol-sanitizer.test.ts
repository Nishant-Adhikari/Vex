/**
 * token-symbol-sanitizer — the ASCII-allowlist trust boundary shared by
 * moves-db.ts (main) and MovesBlock.tsx / PositionChains.tsx (renderer) for
 * every provider/capture-supplied token display symbol.
 *
 * Spoofing fixtures use explicit `\uXXXX` escapes (never raw invisible
 * bytes) so the exact character under test stays reviewable in a diff.
 */

import { describe, it, expect } from "vitest";
import {
  TOKEN_SYMBOL_MAX_LENGTH,
  sanitizeTokenSymbol,
} from "../token-symbol-sanitizer.js";

describe("sanitizeTokenSymbol", () => {
  it("trims surrounding whitespace on an otherwise valid symbol", () => {
    expect(sanitizeTokenSymbol("  SOL  ")).toBe("SOL");
  });

  it("accepts real-world tickers with allowlisted punctuation", () => {
    expect(sanitizeTokenSymbol("USDC")).toBe("USDC");
    expect(sanitizeTokenSymbol("ansem")).toBe("ansem");
    expect(sanitizeTokenSymbol("WIF-PERP")).toBe("WIF-PERP");
    expect(sanitizeTokenSymbol("W.ETH")).toBe("W.ETH");
    // Must start alphanumeric — "$"-prefixed meme tickers are out of scope
    // for this pass; the allowlist stays as small as the known usages need.
    expect(sanitizeTokenSymbol("$WIF")).toBe(null);
  });

  it("rejects non-string, empty, and over-length values", () => {
    expect(sanitizeTokenSymbol(null)).toBe(null);
    expect(sanitizeTokenSymbol(undefined)).toBe(null);
    expect(sanitizeTokenSymbol(42)).toBe(null);
    expect(sanitizeTokenSymbol("")).toBe(null);
    expect(sanitizeTokenSymbol("   ")).toBe(null);
    expect(sanitizeTokenSymbol("x".repeat(TOKEN_SYMBOL_MAX_LENGTH))).toBe(
      "x".repeat(TOKEN_SYMBOL_MAX_LENGTH),
    );
    expect(sanitizeTokenSymbol("x".repeat(TOKEN_SYMBOL_MAX_LENGTH + 1))).toBe(
      null,
    );
  });

  it("rejects control characters and internal whitespace", () => {
    expect(sanitizeTokenSymbol("BAD\nSYMBOL")).toBe(null); // LF
    expect(sanitizeTokenSymbol("BAD\tSYMBOL")).toBe(null); // TAB
    expect(sanitizeTokenSymbol("BAD SYMBOL")).toBe(null); // internal space
    expect(sanitizeTokenSymbol("BAD\u0000SYMBOL")).toBe(null); // NUL
    expect(sanitizeTokenSymbol("BAD\u007fSYMBOL")).toBe(null); // DEL
    expect(sanitizeTokenSymbol("BADSYMBOL")).toBe("BADSYMBOL"); // control-free, passes
  });

  it("rejects zero-width and bidi-control spoofing characters spliced into a real ticker", () => {
    expect(sanitizeTokenSymbol("S\u200bOL")).toBe(null); // zero-width space
    expect(sanitizeTokenSymbol("S\u200cOL")).toBe(null); // zero-width non-joiner
    expect(sanitizeTokenSymbol("S\u200dOL")).toBe(null); // zero-width joiner
    expect(sanitizeTokenSymbol("\ufeffSOL")).toBe(null); // BOM / zero-width no-break space
    expect(sanitizeTokenSymbol("SOL\u202e")).toBe(null); // right-to-left override
    expect(sanitizeTokenSymbol("\u202aSOL")).toBe(null); // left-to-right embedding
    expect(sanitizeTokenSymbol("\u2066SOL\u2069")).toBe(null); // bidi isolate pair
    expect(sanitizeTokenSymbol("\u061cSOL")).toBe(null); // Arabic letter mark
  });

  it("rejects Unicode confusable homoglyphs of well-known tickers", () => {
    expect(sanitizeTokenSymbol("\u0405OL")).toBe(null); // Cyrillic Es for Latin S ("SOL")
    expect(sanitizeTokenSymbol("US\u0414C")).toBe(null); // Cyrillic De for Latin D ("USDC")
    expect(sanitizeTokenSymbol("\uff33OL")).toBe(null); // fullwidth Latin capital S
  });
});
