/**
 * Tests for the Solana/Jupiter concise token projector — focused on the
 * re-surfaced, bounded `logoUrl` field (Option A2 token logos) and the
 * invariant that the social/url bag and raw sub-objects stay dropped.
 */

import { describe, it, expect } from "vitest";

import {
  projectJupiterToken,
  projectJupiterTokens,
} from "@vex-agent/tools/protocols/solana-jupiter/projectors.js";
import type { JupiterMintInformation } from "@tools/solana-ecosystem/jupiter/jupiter-tokens/types.js";

/** Minimal valid token with the required fields; spread overrides per case. */
function makeToken(
  overrides: Partial<JupiterMintInformation> = {},
): JupiterMintInformation {
  return {
    id: "So11111111111111111111111111111111111111112",
    name: "Wrapped SOL",
    symbol: "SOL",
    decimals: 9,
    ...overrides,
  };
}

describe("projectJupiterToken — logoUrl", () => {
  it("surfaces a bounded logoUrl for a valid https icon", () => {
    const out = projectJupiterToken(
      makeToken({ icon: "https://cdn.jup.ag/tokens/sol.png" }),
    );
    expect(out.logoUrl).toBe("https://cdn.jup.ag/tokens/sol.png");
  });

  it("returns null logoUrl for a non-https icon", () => {
    expect(
      projectJupiterToken(makeToken({ icon: "http://cdn.jup.ag/sol.png" }))
        .logoUrl,
    ).toBeNull();
    expect(
      projectJupiterToken(makeToken({ icon: "ftp://cdn.jup.ag/sol.png" }))
        .logoUrl,
    ).toBeNull();
  });

  it("returns null logoUrl for a malformed / control-char / oversized icon", () => {
    expect(projectJupiterToken(makeToken({ icon: "not a url" })).logoUrl).toBeNull();
    expect(
      projectJupiterToken(makeToken({ icon: `https://a${String.fromCharCode(0)}.com/x.png` }))
        .logoUrl,
    ).toBeNull();
    const tooLong = `https://cdn.jup.ag/${"a".repeat(600)}.png`;
    expect(projectJupiterToken(makeToken({ icon: tooLong })).logoUrl).toBeNull();
  });

  it("returns null logoUrl when icon is absent or null", () => {
    expect(projectJupiterToken(makeToken()).logoUrl).toBeNull();
    expect(projectJupiterToken(makeToken({ icon: null })).logoUrl).toBeNull();
  });
});

describe("projectJupiterToken — dropped-field invariants stay intact", () => {
  it("drops social/url bag and raw sub-objects, keeps no `icon` key", () => {
    const out = projectJupiterToken(
      makeToken({
        icon: "https://cdn.jup.ag/sol.png",
        twitter: "https://x.com/sol",
        telegram: "https://t.me/sol",
        website: "https://solana.com",
        dev: "DevPubkey",
        mintAuthority: "MintPubkey",
        freezeAuthority: "FreezePubkey",
        firstPool: { id: "pool1", createdAt: "2024-01-01" },
        updatedAt: "2024-01-02",
      }),
    );
    // The concise row exposes logoUrl but NOT the raw icon nor the social bag.
    expect("icon" in out).toBe(false);
    expect("twitter" in out).toBe(false);
    expect("telegram" in out).toBe(false);
    expect("website" in out).toBe(false);
    expect("dev" in out).toBe(false);
    expect("mintAuthority" in out).toBe(false);
    expect("freezeAuthority" in out).toBe(false);
    expect("firstPool" in out).toBe(false);
    expect("updatedAt" in out).toBe(false);
    expect(out.logoUrl).toBe("https://cdn.jup.ag/sol.png");
  });
});

describe("projectJupiterTokens", () => {
  it("maps each token and tolerates a non-array input", () => {
    const rows = projectJupiterTokens([
      makeToken({ icon: "https://cdn.jup.ag/a.png" }),
      makeToken({ id: "Mint2", icon: "javascript:alert(1)" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.logoUrl).toBe("https://cdn.jup.ag/a.png");
    expect(rows[1]?.logoUrl).toBeNull();
    expect(projectJupiterTokens(null)).toEqual([]);
    expect(projectJupiterTokens(undefined)).toEqual([]);
  });
});
