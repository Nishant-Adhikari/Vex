/**
 * POSITION per-chain holdings — the chain switcher for a session's portfolio
 * (owner request: chain marks from the brand icon set, Ethereum as the
 * standing EVM default, robinhood/base/arbitrum as quick switches, a "more"
 * dialog for every other network holding a balance, top-3 tokens per chain,
 * and the Solana group headed by the Solana mark instead of a "SOL" label).
 *
 * Data: `PortfolioDto.chains` — the purpose-built per-chain breakdown
 * (non-negative totals; top-3 tokens each, positive-USD or UNPRICED). An
 * unpriced holding (`balanceUsd: null` — no price source) shows its
 * `amount + symbol` with a muted em dash, and a chain total that would print
 * $0.00 renders as the same muted dash (owner decision: show funds, never a
 * fabricated $0.00). Selection is local UI state; the parent remounts this
 * component per session (React `key`), so a session switch always lands back
 * on Ethereum.
 *
 * Grammar: landing .ws-stat rows (hairline separations, mono figures,
 * tabular-nums), accent rationed to the selected-chain ring. Icon-only chain
 * buttons carry explicit `aria-label`s; the marks themselves are decorative.
 */

import { useState, type JSX } from "react";
import type { PositionChainDto } from "@shared/schemas/portfolio.js";
import {
  DEFAULT_EVM_CHAIN_ID,
  EVM_QUICK_CHAIN_IDS,
  SOLANA_CHAIN_ID,
  chainDisplay,
  familyForChainId,
} from "@shared/chains/display.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { sanitizeTokenSymbol } from "@shared/token-symbol-sanitizer.js";
import { ChainIcon } from "../../../components/common/ChainIcon.js";
import { BRAND_ICON_SYMBOLS, TokenIcon } from "../../../components/common/TokenIcon.js";
import { formatTokenQuantity, formatUsd } from "../../../lib/format.js";
import { cn } from "../../../lib/utils.js";

/**
 * Smallest |USD| `formatUsd` renders as non-zero (same rounding threshold as
 * PositionBlock's legacy rows) — a top-3 line below it would print "$0.00".
 */
const MIN_DISPLAY_USD = 0.005;

/**
 * Solana mint → ticker — the EXACT SAME three verified constants
 * `MovesBlock`'s `KNOWN_MINTS` already trusts. Base58 is case-SENSITIVE (no
 * `.toLowerCase()` anywhere near this map — unlike EVM hex, a differently
 * cased Solana address is a DIFFERENT address).
 */
const KNOWN_SOLANA_MINTS: ReadonlyMap<string, string> = new Map([
  ["So11111111111111111111111111111111111111112", "SOL"],
  ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC"],
  ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "USDT"],
]);

/**
 * The EVM native-gas placeholder (`NATIVE_TOKEN_ADDRESS` in
 * `src/tools/kyberswap/constants.ts`) — not a deployable contract address, so
 * no token can spoof it; used across every EVM chain to mean "this wallet's
 * native balance". Lower-cased for comparison: EVM checksum casing is
 * cosmetic, unlike Solana base58.
 */
const NATIVE_EVM_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/**
 * The ONLY thing that authorizes `TokenIcon`'s brand mark for a holding
 * whose sanitized symbol claims a brand ticker (mirrors the Moves feed's
 * `KNOWN_MINTS` invariant — an address, never a self-declared symbol, proves
 * identity). Solana holdings are verified against the same three canonical
 * mints Moves already trusts; the EVM native sentinel is independently
 * verifiable and always denotes "ETH" — a same-address BNB/MATIC/other
 * native holding fails this exact-ticker match (no per-chain native registry
 * exists here) and correctly falls back to a non-brand render rather than
 * borrowing the wrong mark. Any other address, or no address at all, yields
 * `null` — no icon, even if the symbol would otherwise match a brand key.
 */
function verifiedBrandTicker(
  family: "evm" | "solana",
  tokenAddress: string | null,
  symbol: string,
): string | null {
  if (tokenAddress === null) return null;
  const known =
    family === "solana"
      ? (KNOWN_SOLANA_MINTS.get(tokenAddress) ?? null)
      : tokenAddress.toLowerCase() === NATIVE_EVM_SENTINEL
        ? "ETH"
        : null;
  return known !== null && known.toLowerCase() === symbol.toLowerCase()
    ? known
    : null;
}

export function PositionChains({
  chains,
  hasEvmWallet,
  hasSolanaWallet,
}: {
  readonly chains: readonly PositionChainDto[];
  readonly hasEvmWallet: boolean;
  readonly hasSolanaWallet: boolean;
}): JSX.Element | null {
  const [selectedEvmId, setSelectedEvmId] = useState(DEFAULT_EVM_CHAIN_ID);
  const [moreOpen, setMoreOpen] = useState(false);

  const evmChains = chains.filter((c) => c.family === "evm");
  const solana = chains.find((c) => c.chainId === SOLANA_CHAIN_ID) ?? null;
  const selected =
    evmChains.find((c) => c.chainId === selectedEvmId) ?? null;

  if (!hasEvmWallet && !hasSolanaWallet) return null;

  return (
    <div className="flex flex-col gap-3" data-vex-area="position-chains">
      {hasEvmWallet ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <ChainIcon chainId={selectedEvmId} size={14} />
              <span className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-2)]">
                {chainDisplay(selectedEvmId).name}
              </span>
            </span>
            {selected !== null ? (
              <ChainTotalFigure totalUsd={selected.totalUsd} />
            ) : null}
          </div>
          <div
            role="group"
            aria-label="EVM network"
            className="flex items-center gap-1"
          >
            {EVM_QUICK_CHAIN_IDS.map((id) => (
              <button
                key={id}
                type="button"
                title={chainDisplay(id).name}
                aria-label={`Show ${chainDisplay(id).name} assets`}
                aria-pressed={id === selectedEvmId}
                onClick={() => setSelectedEvmId(id)}
                className={cn(
                  // A faint plinth behind every mark keeps dark-inked brand
                  // icons visible on the ink canvas (owner report: "Base was
                  // invisible"); the native title names the network on hover.
                  "inline-flex h-6 w-6 items-center justify-center rounded-full border bg-white/[0.05] transition-colors",
                  id === selectedEvmId
                    ? "border-[var(--vex-accent-border-strong)]"
                    : "border-transparent hover:border-[var(--vex-line-strong)]",
                )}
              >
                <ChainIcon chainId={id} size={13} />
              </button>
            ))}
            {/* Always offered — the dialog is the network browser (funded
             * chains only); its empty state explains itself. */}
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setMoreOpen(true)}
              className="inline-flex h-6 items-center rounded-full border border-transparent px-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--vex-text-3)] transition-colors hover:border-[var(--vex-line-strong)] hover:text-[var(--vex-text-2)]"
            >
              more
            </button>
          </div>
          <ChainTokenList
            chainId={selectedEvmId}
            tokens={selected?.tokens ?? []}
          />
        </div>
      ) : null}

      {hasSolanaWallet ? (
        <div
          className={cn(
            "flex flex-col gap-1.5",
            hasEvmWallet && "border-t border-[var(--vex-line)] pt-3",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            {/* Mark + name, mirroring the EVM group header — a nameless icon
             * row read as a duplicate of the SOL token line under it (owner
             * report: "podwójna ikona SOL"). */}
            <span className="flex min-w-0 items-center gap-1.5">
              <ChainIcon chainId={SOLANA_CHAIN_ID} size={14} />
              <span className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-2)]">
                Solana
              </span>
            </span>
            {solana !== null ? (
              <ChainTotalFigure totalUsd={solana.totalUsd} />
            ) : null}
          </div>
          <ChainTokenList
            chainId={SOLANA_CHAIN_ID}
            tokens={solana?.tokens ?? []}
          />
        </div>
      ) : null}

      {/* Mounted only while open: a closed native <dialog> still sits in the
       * DOM, and its network list would shadow the visible header text for
       * assistive tech and DOM queries alike. */}
      {moreOpen ? (
        <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader className="gap-1.5 border-[var(--vex-line)] py-4">
              <DialogTitle>Networks</DialogTitle>
              <DialogDescription>
                EVM networks holding a balance in this position.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              {evmChains.length > 0 ? (
                <ul className="flex flex-col">
                  {evmChains.map((c) => (
                    <li key={c.chainId}>
                      <button
                        type="button"
                        aria-pressed={c.chainId === selectedEvmId}
                        onClick={() => {
                          setSelectedEvmId(c.chainId);
                          setMoreOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-3 border-b border-[var(--vex-line)] py-2 text-left transition-colors last:border-b-0 hover:text-[var(--vex-text)]"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <ChainIcon chainId={c.chainId} size={14} />
                          <span className="truncate font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--vex-text-2)]">
                            {chainDisplay(c.chainId).name}
                          </span>
                        </span>
                        <ChainTotalFigure totalUsd={c.totalUsd} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-[var(--vex-text-3)]">
                  No funded EVM networks yet.
                </p>
              )}
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * One chain-total figure on the .ws-stat register. Totals that would print
 * `$0.00` (an unpriced-only chain totals 0 by construction) render as a
 * muted em dash — the funds show on the token rows, never a fabricated $0.00.
 */
function ChainTotalFigure({
  totalUsd,
}: {
  readonly totalUsd: number;
}): JSX.Element {
  const unpriced = Math.abs(totalUsd) < MIN_DISPLAY_USD;
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[11px] tabular-nums",
        unpriced ? "text-[var(--vex-text-3)]" : "text-[var(--vex-text)]",
      )}
    >
      {unpriced ? "—" : formatUsd(totalUsd)}
    </span>
  );
}

/**
 * Top-3 holdings of one chain — token mark + symbol + muted quantity + USD
 * on .ws-stat rows. UNPRICED rows (`balanceUsd: null`) with a positive
 * amount stay visible with a muted em dash for the missing valuation. An
 * empty (or all-sub-cent) list states the fact quietly instead of leaving
 * a gap: Ethereum stays the standing default even with nothing on it.
 *
 * `token.symbol` is provider-supplied and UNTRUSTED — any on-chain token can
 * self-declare arbitrary metadata, including a symbol that impersonates a
 * well-known asset. It is passed through the shared ASCII-allowlist
 * `sanitizeTokenSymbol` (rejects control characters, bidi controls,
 * zero-width characters, and Unicode confusables) BEFORE it reaches display
 * text, so a homoglyph/control-character spoof never renders at all. A
 * PLAIN-ASCII brand impersonation (e.g. a scam token literally named "ETH")
 * survives sanitization as text, so `TokenIcon`'s brand mark additionally
 * requires `verifiedBrandTicker` to confirm the line's `tokenAddress` is one
 * of the few independently-verified addresses above — an unverified address
 * still shows the sanitized symbol as text, just with no borrowed logo (the
 * same trade-off `MovesBlock` makes for captured symbols).
 */
function ChainTokenList({
  chainId,
  tokens,
}: {
  readonly chainId: number;
  readonly tokens: readonly PositionChainDto["tokens"][number][];
}): JSX.Element {
  const family = familyForChainId(chainId);
  const displayable = tokens.filter((t) =>
    t.balanceUsd === null
      ? t.amount !== null && t.amount > 0
      : Math.abs(t.balanceUsd) >= MIN_DISPLAY_USD,
  );
  if (displayable.length === 0) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        No assets on {chainDisplay(chainId).name}
      </p>
    );
  }
  return (
    <ul className="flex flex-col">
      {displayable.map((token, index) => {
        const symbol = sanitizeTokenSymbol(token.symbol);
        const quantity = formatTokenQuantity(token.amount, symbol);
        const tokenAddress = token.tokenAddress ?? null;
        // A brand-colliding symbol needs address verification; a non-brand
        // symbol carries no impersonation risk and passes through as-is
        // (TokenIcon renders its neutral monogram either way).
        const isBrandClaim =
          symbol !== null && BRAND_ICON_SYMBOLS.has(symbol.toLowerCase());
        const iconSymbol = isBrandClaim
          ? verifiedBrandTicker(family, tokenAddress, symbol)
          : symbol;
        return (
          <li
            key={`${chainId}:${tokenAddress ?? "x"}:${symbol ?? "—"}:${index}`}
            className="flex items-center justify-between gap-3 border-b border-[var(--vex-line)] py-1.5 last:border-b-0"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <TokenIcon symbol={iconSymbol} size={13} />
              <span className="truncate font-mono text-[11px] text-[var(--vex-text-2)]">
                {symbol !== null && symbol.length > 0 ? symbol : "—"}
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2 font-mono text-[11px] tabular-nums">
              {quantity !== null ? (
                <span className="text-[var(--vex-text-3)]">{quantity}</span>
              ) : null}
              <span
                className={
                  token.balanceUsd === null
                    ? "text-[var(--vex-text-3)]"
                    : "text-[var(--vex-text)]"
                }
              >
                {formatUsd(token.balanceUsd)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
