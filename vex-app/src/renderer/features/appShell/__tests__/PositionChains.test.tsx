/**
 * PositionChains — pins the token-symbol trust boundary for the POSITION
 * chain switcher's per-chain top holdings (WP-H: the same protection
 * MovesBlock applies to captured symbols, applied here to the portfolio's
 * provider-supplied `token.symbol`, which carries NO mitigation upstream).
 *
 * `token.symbol` is UNTRUSTED: any on-chain token can self-declare arbitrary
 * metadata, including a symbol that impersonates a well-known ticker or
 * embeds deceptive Unicode (confusables, bidi controls, zero-width
 * characters). Every symbol must pass through the shared
 * `sanitizeTokenSymbol` allowlist before it becomes display text or reaches
 * `TokenIcon`'s symbol-keyed brand-mark lookup — a rejected symbol renders
 * the existing "—" placeholder and the neutral monogram, never a brand name
 * or logo.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PositionChainDto } from "@shared/schemas/portfolio.js";
import { PositionChains } from "../book/PositionChains.js";

const ETHEREUM_CHAIN_ID = 1;

function chain(
  chainId: number,
  family: "evm" | "solana",
  totalUsd: number,
  tokens: PositionChainDto["tokens"],
): PositionChainDto {
  return { chainId, family, totalUsd, tokens };
}

describe("PositionChains token-symbol trust boundary", () => {
  it("renders a legitimate ASCII symbol as display text and brand icon input", () => {
    render(
      <PositionChains
        chains={[
          chain(ETHEREUM_CHAIN_ID, "evm", 100, [
            { symbol: "USDC", balanceUsd: 100, amount: 100 },
          ]),
        ]}
        hasEvmWallet
        hasSolanaWallet={false}
      />,
    );
    expect(screen.getByText("USDC")).not.toBeNull();
  });

  it("drops a Unicode-confusable symbol impersonating a brand ticker (fullwidth/Cyrillic lookalikes)", () => {
    render(
      <PositionChains
        chains={[
          chain(ETHEREUM_CHAIN_ID, "evm", 100, [
            // Cyrillic Es (U+0405) standing in for Latin S in "SOL".
            { symbol: "\u0405OL", balanceUsd: 100, amount: 1 },
          ]),
        ]}
        hasEvmWallet
        hasSolanaWallet={false}
      />,
    );
    // Never renders the spoofed label...
    expect(screen.queryByText("\u0405OL")).toBeNull();
    expect(screen.queryByText("SOL")).toBeNull();
    // ...and falls back to the existing unresolved-symbol placeholder.
    expect(screen.getByText("—")).not.toBeNull();
  });

  it("drops a symbol carrying zero-width/bidi-control spoofing characters", () => {
    render(
      <PositionChains
        chains={[
          chain(ETHEREUM_CHAIN_ID, "evm", 50, [
            // Zero-width space spliced into "ETH".
            { symbol: "E\u200bTH", balanceUsd: 50, amount: 1 },
          ]),
        ]}
        hasEvmWallet
        hasSolanaWallet={false}
      />,
    );
    expect(screen.queryByText("ETH")).toBeNull();
    expect(screen.getByText("—")).not.toBeNull();
  });

  it("drops a symbol containing control characters", () => {
    render(
      <PositionChains
        chains={[
          chain(ETHEREUM_CHAIN_ID, "evm", 50, [
            { symbol: "BAD\nSYMBOL", balanceUsd: 50, amount: 1 },
          ]),
        ]}
        hasEvmWallet
        hasSolanaWallet={false}
      />,
    );
    expect(screen.queryByText(/SYMBOL/)).toBeNull();
    expect(screen.getByText("—")).not.toBeNull();
  });

  it("never renders duplicate/unsanitized rows for a null symbol", () => {
    const { container } = render(
      <PositionChains
        chains={[
          chain(ETHEREUM_CHAIN_ID, "evm", 10, [
            { symbol: null, balanceUsd: 10, amount: 1 },
          ]),
        ]}
        hasEvmWallet
        hasSolanaWallet={false}
      />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByText("—")).not.toBeNull();
  });
});
