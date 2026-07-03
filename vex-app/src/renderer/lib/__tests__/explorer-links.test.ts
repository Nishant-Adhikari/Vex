/**
 * `moveExplorerUrl` — pins the chain → block-explorer mapping that powers the
 * MOVES click-through:
 *
 *   - every mapped chain (plus its CAIP-2 `eip155:<id>` alias for EVM) resolves
 *     to the canonical explorer `/tx/` URL,
 *   - normalization is lowercase + trim over the tolerant chain string,
 *   - `null`/blank refs and unknown chains resolve to `null` (row renders
 *     non-interactive) — the helper never throws,
 *   - the ref is `encodeURIComponent`-encoded so a hostile ref cannot smuggle
 *     path/query segments into the URL.
 *
 * Main's external-link allowlist (`src/main/windows/main-window.ts`) remains
 * the enforcement point on open; this suite owns only the pure mapping.
 */

import { describe, expect, it } from "vitest";
import { moveExplorerUrl } from "../explorer-links.js";

const SIG = "5VERYrealSolanaSignature111111111111111111";
const HASH = "0xabc123def456";

describe("moveExplorerUrl", () => {
  it("maps solana signatures to explorer.solana.com", () => {
    expect(moveExplorerUrl("solana", SIG)).toBe(
      `https://explorer.solana.com/tx/${SIG}`,
    );
  });

  it("maps ethereum / mainnet / eip155:1 to etherscan", () => {
    const expected = `https://etherscan.io/tx/${HASH}`;
    expect(moveExplorerUrl("ethereum", HASH)).toBe(expected);
    expect(moveExplorerUrl("mainnet", HASH)).toBe(expected);
    expect(moveExplorerUrl("eip155:1", HASH)).toBe(expected);
  });

  it("maps each remaining EVM chain (and its eip155 alias) to its explorer", () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ["base", "eip155:8453", "https://basescan.org/tx/"],
      ["arbitrum", "eip155:42161", "https://arbiscan.io/tx/"],
      ["bsc", "eip155:56", "https://bscscan.com/tx/"],
      ["bnb", "eip155:56", "https://bscscan.com/tx/"],
      ["polygon", "eip155:137", "https://polygonscan.com/tx/"],
      ["optimism", "eip155:10", "https://optimistic.etherscan.io/tx/"],
    ];
    for (const [chain, caip2, base] of cases) {
      expect(moveExplorerUrl(chain, HASH)).toBe(`${base}${HASH}`);
      expect(moveExplorerUrl(caip2, HASH)).toBe(`${base}${HASH}`);
    }
  });

  it("normalizes chain case and surrounding whitespace", () => {
    expect(moveExplorerUrl(" Solana ", SIG)).toBe(
      `https://explorer.solana.com/tx/${SIG}`,
    );
    expect(moveExplorerUrl("ETHEREUM", HASH)).toBe(
      `https://etherscan.io/tx/${HASH}`,
    );
  });

  it("returns null for a null, empty, or whitespace-only ref", () => {
    expect(moveExplorerUrl("solana", null)).toBeNull();
    expect(moveExplorerUrl("solana", "")).toBeNull();
    expect(moveExplorerUrl("ethereum", "   ")).toBeNull();
  });

  it("returns null for unknown chains", () => {
    expect(moveExplorerUrl("dogecoin", HASH)).toBeNull();
    expect(moveExplorerUrl("", HASH)).toBeNull();
    expect(moveExplorerUrl("eip155:999999", HASH)).toBeNull();
  });

  it("URL-encodes the ref so it cannot smuggle path or query segments", () => {
    expect(moveExplorerUrl("ethereum", "abc/../evil?x=1#f")).toBe(
      "https://etherscan.io/tx/abc%2F..%2Fevil%3Fx%3D1%23f",
    );
    // Surrounding whitespace on a real ref is trimmed, not percent-encoded.
    expect(moveExplorerUrl("solana", `  ${SIG}  `)).toBe(
      `https://explorer.solana.com/tx/${SIG}`,
    );
  });
});
