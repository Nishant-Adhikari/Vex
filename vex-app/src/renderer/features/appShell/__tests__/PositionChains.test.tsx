/**
 * PositionChains — pins the token-symbol trust boundary for the POSITION
 * chain switcher's per-chain top holdings (WP-H: the same protection
 * MovesBlock applies to captured symbols, applied here to the portfolio's
 * provider-supplied `token.symbol`, which carries NO mitigation upstream) AND
 * the address-correct branding gate (position branding stream): a brand icon
 * requires `verifiedBrandTicker` to confirm the line's `tokenAddress`, never
 * the self-declared symbol alone.
 *
 * `token.symbol` is UNTRUSTED: any on-chain token can self-declare arbitrary
 * metadata, including a symbol that impersonates a well-known ticker or
 * embeds deceptive Unicode (confusables, bidi controls, zero-width
 * characters). Every symbol must pass through the shared
 * `sanitizeTokenSymbol` allowlist before it becomes display text or reaches
 * `TokenIcon`'s symbol-keyed brand-mark lookup — a rejected symbol renders
 * the existing "—" placeholder and the neutral monogram, never a brand name
 * or logo. A plain-ASCII brand impersonation (e.g. literally "ETH") survives
 * sanitization as TEXT but is denied the brand `<svg>` mark unless its
 * `tokenAddress` is one of the handful of independently-verified addresses.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PositionChainDto } from "@shared/schemas/portfolio.js";
import { PositionChains } from "../book/PositionChains.js";

const ETHEREUM_CHAIN_ID = 1;
const SOLANA_CHAIN_ID = 20011000000;
const NATIVE_EVM_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const SOL_MINT = "So11111111111111111111111111111111111111112";

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

describe("PositionChains address-correct branding gate", () => {
  it("withholds the brand icon for a spoofed 'ETH' symbol at an unverified address", () => {
    const { container } = render(
      <PositionChains
        chains={[
          chain(ETHEREUM_CHAIN_ID, "evm", 100, [
            {
              symbol: "ETH",
              tokenAddress: "0x0000000000000000000000000000000000ffff",
              balanceUsd: 100,
              amount: 1,
            },
          ]),
        ]}
        hasEvmWallet
        hasSolanaWallet={false}
      />,
    );
    // The sanitized text still renders (no deception in the label itself)...
    expect(screen.getByText("ETH")).not.toBeNull();
    // ...but the row's icon is the neutral fallback, never the brand `<svg>`.
    const row = container.querySelector("li");
    expect(row?.querySelector("svg")).toBeNull();
  });

  it("grants the brand icon for a native ETH holding at the verified EVM sentinel address", () => {
    const { container } = render(
      <PositionChains
        chains={[
          chain(ETHEREUM_CHAIN_ID, "evm", 100, [
            {
              symbol: "ETH",
              tokenAddress: NATIVE_EVM_SENTINEL,
              balanceUsd: 100,
              amount: 1,
            },
          ]),
        ]}
        hasEvmWallet
        hasSolanaWallet={false}
      />,
    );
    const row = container.querySelector("li");
    expect(row?.querySelector("svg")).not.toBeNull();
  });

  it("withholds the brand icon when a symbol has no tokenAddress at all", () => {
    const { container } = render(
      <PositionChains
        chains={[
          chain(ETHEREUM_CHAIN_ID, "evm", 100, [
            { symbol: "ETH", balanceUsd: 100, amount: 1 },
          ]),
        ]}
        hasEvmWallet
        hasSolanaWallet={false}
      />,
    );
    const row = container.querySelector("li");
    expect(row?.querySelector("svg")).toBeNull();
  });

  it("withholds the brand icon for a spoofed 'SOL' symbol at an unverified Solana address", () => {
    const { container } = render(
      <PositionChains
        chains={[
          chain(SOLANA_CHAIN_ID, "solana", 100, [
            {
              symbol: "SOL",
              tokenAddress: "9jk8UbH339rCgnohpBvqiss4a7bXWmicMPCUCFmDrmYK",
              balanceUsd: 100,
              amount: 1,
            },
          ]),
        ]}
        hasEvmWallet={false}
        hasSolanaWallet
      />,
    );
    expect(screen.getByText("SOL")).not.toBeNull();
    const row = container.querySelector("li");
    expect(row?.querySelector("svg")).toBeNull();
  });

  it("grants the brand icon for the verified Solana native mint", () => {
    const { container } = render(
      <PositionChains
        chains={[
          chain(SOLANA_CHAIN_ID, "solana", 100, [
            { symbol: "SOL", tokenAddress: SOL_MINT, balanceUsd: 100, amount: 1 },
          ]),
        ]}
        hasEvmWallet={false}
        hasSolanaWallet
      />,
    );
    const row = container.querySelector("li");
    expect(row?.querySelector("svg")).not.toBeNull();
  });

  it("never gates a non-brand symbol on an address (no impersonation risk to guard)", () => {
    const { container } = render(
      <PositionChains
        chains={[
          chain(ETHEREUM_CHAIN_ID, "evm", 100, [
            {
              symbol: "PEPE",
              tokenAddress: "0x0000000000000000000000000000000000ffff",
              balanceUsd: 100,
              amount: 1,
            },
          ]),
        ]}
        hasEvmWallet
        hasSolanaWallet={false}
      />,
    );
    // Non-brand symbols were never gated — TokenIcon just renders its own
    // neutral monogram (no svg either way), and the text is unaffected.
    expect(screen.getByText("PEPE")).not.toBeNull();
    const row = container.querySelector("li");
    expect(row?.querySelector("svg")).toBeNull();
  });
});
