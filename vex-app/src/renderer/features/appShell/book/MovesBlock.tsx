/**
 * MOVES — the per-session feed of what the agent DID on-chain: executed trades
 * (swaps / fills) from the `proj_activity` projection, newest first.
 *
 * Reads the agent's REAL executed activity via `useMoves` (→ `portfolio.listMoves`),
 * NOT the approval history. Approval rows only exist for `restricted`-permission
 * sessions, so a `full`-permission mission that executed swaps has zero approval
 * rows but real `proj_activity` rows — this block surfaces those.
 *
 * Rows are activity rows / fills (NOT executions): a batch capture legitimately
 * produces multiple fills per execution, so they are shown individually.
 *
 * LEDGER GRAMMAR (landing .ws-stat): one hairline-separated row per fill —
 * status dot · stamp (mono 9px chip: BUY success-tone / SELL paper-tone /
 * SWAP muted; `productType` takes priority — `bridge` → BRIDGE·VENUE,
 * `send`/`transfer` → TRANSFER, both muted) · `IN → OUT` legs · HH:MM. Raw
 * mint addresses never print in full: address-like token strings truncate to
 * `So1111…1112` (full mint on the tooltip) and a deliberately tiny
 * well-known-mint map resolves the unmissable tickers. Short token strings
 * render as uppercase symbols. A leg carries its amount (`0.0017 ETH`) ONLY
 * when it is a base/native/quote UNIT (ETH/SOL/stable) AND the recorded amount
 * is a dotted decimal — the TRADED token's raw quantity is deliberately
 * dropped (`BUY 0.01 ETH → VENA`, not `→ 31100.1 VENA`; owner: "we don't care
 * about qty — ETH is fine"); raw base-unit integers (wei/lamports) and nulls
 * also render nothing.
 *
 * A SUMMARY header tops the ledger — `SEED 0.10 ETH · DEPLOYED 0.04 ETH (40%)`.
 * Deployed sums the ETH leg of every fetched BUY (gross, ETH-denominated from
 * the moves themselves — the portfolio DTO is USD-only); seed is the session's
 * `bankrollStartEth` from its latest finalized mission result, dropping out
 * (with its `%`) when no such ETH seed is available.
 *
 * The ledger shows the 10 newest fills (`MOVES_DISPLAY_CAP`); the header badge
 * still counts the FULL fetched result (server-capped at `MOVES_MAX`). A row
 * whose `chain`+`txRef` resolve through `moveExplorerUrl` renders as an
 * external link (target=_blank → main's `shell.openExternal` allowlist) with a
 * hover-revealed ↗ affordance; unresolvable rows stay non-interactive.
 *
 * Dot colour is a PURE client-side derivation over the tolerant `captureStatus`
 * string (executed/filled/closed/claimed → done; open/pending → pending;
 * cancelled/rejected → muted; failed → destructive; null/unknown → neutral).
 * Unknown statuses fall back gracefully — the derivation never throws.
 */

import type { JSX } from "react";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import type { MoveItem } from "@shared/schemas/portfolio-moves.js";
import type { PortfolioDto } from "@shared/schemas/portfolio.js";
import { useMoves, usePortfolioScoped } from "../../../lib/api/portfolio.js";
import { useMissionSessionResult } from "../../../lib/api/mission.js";
import { moveExplorerUrl } from "../../../lib/explorer-links.js";
import { formatClock, truncateAddress } from "../../../lib/format.js";
import { formatEth } from "../missionHistoryModel.js";
import { cn } from "../../../lib/utils.js";
import { BookBlock } from "./BookBlock.js";

/** Rendered window: the 10 newest fills. The badge counts the fetched total. */
const MOVES_DISPLAY_CAP = 10;

/**
 * Amount-unit the ledger renders in. USD is the default (the figure a trader
 * reasons about); ETH keeps the raw on-chain base-leg amount. Persisted per
 * user so the choice survives reloads.
 */
type DisplayMode = "usd" | "eth";

/** localStorage key for the MOVES display-mode preference. */
const DISPLAY_MODE_KEY = "vex.moves.displayMode";

/**
 * Read the persisted display mode, defaulting to `"usd"`. Electron renderer —
 * `window`/`localStorage` always exist; tampered/absent values coerce to the
 * default rather than throwing.
 */
function readDisplayMode(): DisplayMode {
  return window.localStorage.getItem(DISPLAY_MODE_KEY) === "eth" ? "eth" : "usd";
}

type MoveState = "pending" | "done" | "failed" | "cancelled" | "neutral";

/**
 * Pure derivation over the tolerant `captureStatus`. The engine emits values
 * like `executed`, `open`, `closed`, `cancelled`, `claimed`, `pending`,
 * `filled`. Unrecognised or `null` statuses fall back to `neutral` — never
 * throw.
 */
function moveState(captureStatus: string | null): MoveState {
  switch (captureStatus?.toLowerCase()) {
    case "executed":
    case "filled":
    case "closed":
    case "claimed":
      return "done";
    case "open":
    case "pending":
      return "pending";
    case "cancelled":
    case "canceled":
    case "rejected":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "neutral";
  }
}

const DOT: Record<MoveState, string> = {
  pending: "bg-[var(--vex-accent)]",
  done: "bg-[var(--color-success)]",
  failed: "bg-[var(--color-destructive)]",
  cancelled: "bg-[var(--vex-text-3)]",
  neutral: "bg-[var(--vex-text-2)]",
};

/**
 * Well-known mint → ticker. Deliberately tiny (the Solana constants a trader
 * recognises on sight); everything else goes through the address heuristic.
 * Do NOT grow this into a token registry — that belongs server-side.
 */
const KNOWN_MINTS: ReadonlyMap<string, string> = new Map([
  ["So11111111111111111111111111111111111111112", "SOL"],
  ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC"],
  ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "USDT"],
]);

/**
 * Wrapped-native EVM addresses → the native ticker. The base leg of every EVM
 * spot trade routes as wrapped-native, and (unlike the traded token) it is not
 * an ERC-20 balance row, so the server symbol-resolution can't catch it. Keyed
 * LOWERCASE. Deliberately tiny — the chain base assets only, not a registry.
 */
const KNOWN_EVM_TOKENS: ReadonlyMap<string, string> = new Map([
  ["0x0bd7d308f8e1639fab988df18a8011f41eacad73", "ETH"], // Robinhood WETH
  ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "ETH"], // Ethereum WETH
  ["0x4200000000000000000000000000000000000006", "ETH"], // Base / Optimism WETH
  ["0x82af49447d8a07e3bd95bd0d56f35241523fbab1", "ETH"], // Arbitrum WETH
]);

/** Reads as a raw mint/address: one long unbroken alnum (base58/hex) run. */
const ADDRESS_LIKE = /^[0-9a-zA-Z]{13,}$/;

/**
 * Resolved tickers that are a base / native / quote UNIT — the leg whose ETH
 * (or SOL / stable) amount is the meaningful figure. Everything else is the
 * TRADED token, whose raw quantity the ledger drops (owner: "we don't care
 * about qty — ETH is fine"). Keyed on the RESOLVED ticker so both a bare
 * symbol string (`ETH`) and a wrapped-native address (→ `ETH`) qualify.
 * Deliberately tiny — base assets only, not a registry.
 */
const UNIT_SYMBOLS: ReadonlySet<string> = new Set([
  "ETH",
  "WETH",
  "SOL",
  "USDC",
  "USDT",
]);

interface TokenDisplay {
  /** What the ledger prints. */
  readonly text: string;
  /** Full value for the tooltip when `text` is lossy, else `null`. */
  readonly full: string | null;
  /**
   * True when `text` is a base/native/quote unit (ETH/SOL/stable) — the leg
   * that carries its amount. False for a traded token (its qty is dropped).
   */
  readonly isUnit: boolean;
}

/**
 * Display rule for one swap leg: known mint → ticker, address-like → the
 * canonical `truncateAddress` shortening (`So1111…1112`), short strings →
 * uppercase symbols. Legs are nullable in the tolerant DTO → `?`.
 * Truncated/known forms carry the full mint on the tooltip; symbols are
 * uppercased in JS (not CSS) so base58 case in truncations stays intact.
 * `isUnit` is derived from the RESOLVED ticker so the amount rule (below)
 * is stable across mint / address / symbol inputs.
 */
function tokenDisplay(token: string | null): TokenDisplay {
  const base = resolveToken(token);
  return { ...base, isUnit: UNIT_SYMBOLS.has(base.text) };
}

function resolveToken(token: string | null): Omit<TokenDisplay, "isUnit"> {
  if (token === null || token.length === 0) return { text: "?", full: null };
  const ticker = KNOWN_MINTS.get(token);
  if (ticker !== undefined) return { text: ticker, full: token };
  const evmTicker = KNOWN_EVM_TOKENS.get(token.toLowerCase());
  if (evmTicker !== undefined) return { text: evmTicker, full: token };
  if (ADDRESS_LIKE.test(token)) {
    return { text: truncateAddress(token), full: token };
  }
  return { text: token.toUpperCase(), full: null };
}

/** ≤6 significant digits, no grouping — mono-ledger compact figures. */
const AMOUNT_FORMAT = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 6,
  useGrouping: false,
});

/**
 * Tolerant parse of a recorded leg amount. The engine records HUMAN-readable
 * amounts only for newer captures (relay bridge, uniswap spot); older captures
 * store raw base-unit integers (wei/lamports) that are meaningless. Returns the
 * number ONLY for a dotted-decimal string that parses to a finite positive
 * value (a raw base-unit integer never carries a `.`); everything else — null,
 * integers, non-numeric — returns `null`.
 */
function parseAmount(amount: string | null): number | null {
  if (amount === null || !amount.includes(".")) return null;
  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Compact leg amount for display; `null` (legacy/raw) renders nothing. */
function amountDisplay(amount: string | null): string | null {
  const parsed = parseAmount(amount);
  return parsed === null ? null : AMOUNT_FORMAT.format(parsed);
}

/**
 * Deployed ETH — the sum of the ETH staked into positions across the fetched
 * moves. Sums the ETH-denominated leg of every BUY (a buy spends ETH on the
 * input leg to acquire the traded token); sells and non-ETH-funded buys don't
 * contribute. This is a GROSS figure (it does not net out later sells) and is
 * bounded by the fetched move window (`MOVES_MAX`) — the pragmatic
 * ETH-denominated source the renderer already has, since the portfolio DTO is
 * USD-only. Pure + tolerant: unpriced/raw amounts are skipped, never throws.
 */
export function computeDeployedEth(moves: readonly MoveItem[]): number {
  let total = 0;
  for (const m of moves) {
    if (m.tradeSide?.toLowerCase() !== "buy") continue;
    if (tokenDisplay(m.inputToken).text !== "ETH") continue;
    const eth = parseAmount(m.inputAmount);
    if (eth !== null) total += eth;
  }
  return total;
}

/**
 * The ETH-denominated leg amount of a single move, in ETH — the base/native
 * leg whose figure is meaningful. Checks the input leg first (a BUY funds with
 * ETH), then the output leg (a SELL receives ETH). `null` when neither leg is
 * ETH or the amount is legacy/raw (undotted). Pure + tolerant.
 */
function ethLegAmount(move: MoveItem): number | null {
  if (tokenDisplay(move.inputToken).text === "ETH") {
    const eth = parseAmount(move.inputAmount);
    if (eth !== null) return eth;
  }
  if (tokenDisplay(move.outputToken).text === "ETH") {
    const eth = parseAmount(move.outputAmount);
    if (eth !== null) return eth;
  }
  return null;
}

/**
 * Implied ETH→USD price derived from the first move that carries BOTH a priced
 * `valueUsd` and a parseable ETH leg (`valueUsd / ethLeg`). The engine ships no
 * spot ETH price to the renderer, so this reconstructs one from the moves
 * themselves to convert the ETH-denominated SEED into USD. `null` when no move
 * is priced (USD mode then falls SEED back to ETH). Pure + tolerant — skips
 * unpriced / non-finite / non-positive rows, never throws.
 */
export function impliedEthPriceUsd(moves: readonly MoveItem[]): number | null {
  for (const m of moves) {
    if (m.valueUsd === null || !Number.isFinite(m.valueUsd) || m.valueUsd <= 0) {
      continue;
    }
    const eth = ethLegAmount(m);
    if (eth !== null && eth > 0) return m.valueUsd / eth;
  }
  return null;
}

/**
 * ETH→USD spot price derived from the session PORTFOLIO's ETH holding — the
 * AUTHORITATIVE source for chains whose MOVES ship no `valueUsd`. The Robinhood
 * chain records unpriced fills (`valueUsd: null` on every move), so
 * `impliedEthPriceUsd` returns null there and USD mode silently dies — but the
 * ETH balance ITSELF is priced in `proj_balances`, so the portfolio DTO carries
 * a real ETH line. Finds that line (`symbol === "ETH"`) and derives the price as
 * `balanceUsd / amount` (the DTO ships no direct price field). `null` when there
 * is no portfolio, no ETH line, or the line lacks a price / positive amount (a
 * non-finite or non-positive quotient is rejected too). Pure + tolerant — never
 * throws.
 */
export function deriveEthPriceUsd(portfolio: PortfolioDto | null): number | null {
  if (portfolio === null) return null;
  for (const token of portfolio.tokens) {
    if (token.symbol?.toUpperCase() !== "ETH") continue;
    const { balanceUsd, amount } = token;
    if (balanceUsd === null || amount === null || amount <= 0) continue;
    const price = balanceUsd / amount;
    if (Number.isFinite(price) && price > 0) return price;
  }
  return null;
}

/**
 * The USD notional for one move: the move's own priced `valueUsd` when present;
 * else its ETH-denominated leg converted at `ethPrice` (the portfolio-derived
 * ETH→USD spot) when BOTH a parseable ETH leg and a price exist; else `null`
 * (the row then falls back to its raw ETH figure — never `$NaN`/`$null`). This
 * is what lights the USD ledger on an unpriced chain where the moves alone
 * carry no dollar figure. Pure + tolerant — never throws.
 */
export function moveUsd(move: MoveItem, ethPrice: number | null): number | null {
  if (move.valueUsd !== null && Number.isFinite(move.valueUsd)) return move.valueUsd;
  if (ethPrice === null) return null;
  const eth = ethLegAmount(move);
  return eth === null ? null : eth * ethPrice;
}

/**
 * Deployed USD — the notional staked into positions, summing the priced
 * `valueUsd` of every BUY across the fetched moves (unpriced BUYs are skipped,
 * never counted as 0). The USD-mode counterpart to `computeDeployedEth`;
 * bounded by the same fetched window. Pure + tolerant — never throws.
 */
export function computeDeployedUsd(moves: readonly MoveItem[]): number {
  let total = 0;
  for (const m of moves) {
    if (m.tradeSide?.toLowerCase() !== "buy") continue;
    if (m.valueUsd === null || !Number.isFinite(m.valueUsd)) continue;
    total += m.valueUsd;
  }
  return total;
}

/**
 * Compact USD for a MOVES figure: `$19.90`, `$1.2k`, `$3.4m`. Sub-$1k keeps
 * cents; $1k+ compacts with a lowercase suffix. `null`/non-finite input →
 * `null` so callers fall back to the ETH figure (never `$NaN` / `$null`).
 */
export function formatUsdCompact(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

/**
 * Deployed as a percentage of the seed. `null` when the seed is missing, zero,
 * or non-finite (no meaningful denominator) — the header then drops the `(N%)`.
 */
export function deployedPct(deployed: number, seed: number | null): number | null {
  if (seed === null || !Number.isFinite(seed) || seed <= 0) return null;
  if (!Number.isFinite(deployed)) return null;
  return (deployed / seed) * 100;
}

/**
 * One leg's printed text. In USD mode the base/native UNIT leg shows the move's
 * compact USD notional (`$19.90`) instead of its ETH figure — pass `usdText`
 * (already formatted, `null` when unpriced → falls back to the ETH figure). In
 * ETH mode `usdText` is `null` and the leg reads `0.01 ETH`. The traded token's
 * raw quantity is intentionally dropped — only the unit leg carries a figure.
 */
function legText(
  display: TokenDisplay,
  amount: string | null,
  usdText: string | null,
): string {
  if (display.isUnit && usdText !== null) return usdText;
  return amount !== null && display.isUnit
    ? `${amount} ${display.text}`
    : display.text;
}

type SideTone = "buy" | "sell" | "neutral";

interface SideStamp {
  readonly text: string;
  readonly tone: SideTone;
}

/**
 * Chip stamp with `productType` priority: `bridge` → BRIDGE, venue-qualified
 * (`BRIDGE·RELAY`) when the tolerant `venue` is present; `send`/`transfer` →
 * TRANSFER; anything else falls through to the tolerant `tradeSide` —
 * `buy`/`sell` (EVM spot) carry their own tones; `null`/empty is a neutral
 * Solana swap → SWAP; any other engine value prints uppercased in the neutral
 * tone. Never throw, never hide data (legacy rows carry `productType: null`
 * and keep the tradeSide-only derivation).
 */
function sideStamp(move: MoveItem): SideStamp {
  const product = move.productType?.toLowerCase() ?? "";
  if (product === "bridge") {
    const venue = move.venue !== null && move.venue.length > 0 ? move.venue.toUpperCase() : null;
    return { text: venue !== null ? `BRIDGE·${venue}` : "BRIDGE", tone: "neutral" };
  }
  if (product === "send" || product === "transfer") {
    return { text: "TRANSFER", tone: "neutral" };
  }
  const side = move.tradeSide?.toLowerCase() ?? "";
  if (side === "buy") return { text: "BUY", tone: "buy" };
  if (side === "sell") return { text: "SELL", tone: "sell" };
  if (side.length === 0) return { text: "SWAP", tone: "neutral" };
  return { text: side.toUpperCase(), tone: "neutral" };
}

/** SIDE chip tones — hairline chips, ink stays on the text (no fills). */
const STAMP_TONE: Record<SideTone, string> = {
  // BUY — the landing's live/pass green as a hairline, not a fill.
  buy: "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] text-success",
  // SELL — neutral paper-tone hairline.
  sell: "border-[var(--vex-line-strong)] text-[var(--vex-text-2)]",
  // SWAP / unknown side — the muted register.
  neutral: "border-[var(--vex-line)] text-[var(--vex-text-3)]",
};

export function MovesBlock({ sessionId }: { readonly sessionId: string }): JSX.Element {
  // Display mode is read lazily from localStorage (default USD) and mirrored
  // back on change so the choice survives reloads.
  const [mode, setMode] = useState<DisplayMode>(readDisplayMode);
  useEffect(() => {
    window.localStorage.setItem(DISPLAY_MODE_KEY, mode);
  }, [mode]);

  const query = useMoves(sessionId);
  const result = query.data;
  const allMoves = result?.ok ? result.data : [];

  // ETH spot price for USD conversion, sourced from the session PORTFOLIO's ETH
  // holding (the same session-scoped read PositionBlock uses). This is the
  // AUTHORITATIVE price and the whole point of USD mode working on the Robinhood
  // chain: the moves there carry no `valueUsd`, but the ETH balance IS priced,
  // so `deriveEthPriceUsd` recovers a real spot to convert the ETH legs. Per-move
  // USD uses ONLY this real spot (never an implied reconstruction).
  const portfolioQuery = usePortfolioScoped({ scope: "session", sessionId });
  const portfolio = portfolioQuery.data?.ok ? portfolioQuery.data.data : null;
  const ethPriceUsd = deriveEthPriceUsd(portfolio);
  // Take the most-recent window (server returns newest-first), then render it in
  // ASCENDING timestamp order so the ledger reads oldest → newest top-to-bottom
  // (the buy→sell story flows down the list). Sort a copy — never touch allMoves,
  // which the Deployed sum below still reads over the full fetched set.
  const moves = allMoves
    .slice(0, MOVES_DISPLAY_CAP)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  // Seed = the session's starting bankroll in ETH, read from its latest
  // finalized mission result (`bankrollStartEth`) — the one clean,
  // ETH-denominated seed source the renderer already holds. `null` before the
  // first finalization (no result row yet) or when the snapshot is missing;
  // the summary then shows Deployed alone (no fabricated denominator).
  const seedResult = useMissionSessionResult(sessionId).data;
  const seedEth =
    seedResult?.ok && seedResult.data !== null
      ? seedResult.data.bankrollStartEth
      : null;
  // Deployed is summed over the FULL fetched window, not the display slice.
  const deployedEth = computeDeployedEth(allMoves);
  const deployedUsd = computeDeployedUsd(allMoves);
  const pct = deployedPct(deployedEth, seedEth);
  // The SEED/DEPLOYED summary prefers the portfolio spot price, falling back to
  // a price IMPLIED from any priced move (`valueUsd / ethLeg`) so a chain that
  // ships priced moves but no portfolio ETH line still converts the aggregates.
  const summaryEthPrice = ethPriceUsd ?? impliedEthPriceUsd(allMoves);

  let body: JSX.Element;
  if (query.isLoading) {
    body = (
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        Loading…
      </p>
    );
  } else if (result !== undefined && !result.ok) {
    body = (
      <p className="text-[11px] text-[var(--vex-warn-text)]">
        Couldn&apos;t load moves.
      </p>
    );
  } else if (moves.length === 0) {
    body = (
      <p className="text-[11px] text-[var(--vex-text-3)]">
        No moves yet — the agent&apos;s trades appear here.
      </p>
    );
  } else {
    body = (
      <>
        <MovesSummary
          mode={mode}
          seed={seedEth}
          deployedEth={deployedEth}
          deployedUsd={deployedUsd}
          pct={pct}
          ethPriceUsd={summaryEthPrice}
        />
        {/* Landing .ws-stat grammar: hairline-separated ledger rows, mono figures. */}
        <ul className="flex flex-col">
          {moves.map((m) => (
            <MoveRow key={m.id} move={m} mode={mode} ethPrice={ethPriceUsd} />
          ))}
        </ul>
      </>
    );
  }

  return (
    <BookBlock
      title="Moves"
      trailing={
        allMoves.length > 0 ? (
          <span className="inline-flex items-center gap-2">
            <MovesModeToggle
              mode={mode}
              onToggle={() => setMode((m) => (m === "usd" ? "eth" : "usd"))}
            />
            {/* Landing .ws-badge: accent fill, accent-contrast mono figure
             * (white on cobalt, ink on the Robinhood lime fill), rounded-[5px].
             * Counts the FETCHED total (server-capped at MOVES_MAX), not the
             * 10-row display window below it. */}
            <span className="inline-flex min-w-[18px] items-center justify-center rounded-[5px] bg-[var(--vex-accent)] px-1.5 py-px font-mono text-[9px] font-medium tabular-nums text-[var(--vex-accent-contrast)]">
              {allMoves.length}
            </span>
          </span>
        ) : undefined
      }
    >
      {body}
    </BookBlock>
  );
}

/**
 * The ETH / USD amount-unit switch in the MOVES header. A single real button
 * (keyboard-focusable, aria-labelled with the ACTION it performs) that toggles
 * the ledger between USD (default) and ETH; the active unit sits in the panel's
 * primary ink, the inactive one in the muted register. Matches the panel's
 * mono / `--vex-*` grammar — an unobtrusive hairline chip, no fill.
 */
function MovesModeToggle({
  mode,
  onToggle,
}: {
  readonly mode: DisplayMode;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Show amounts in ${mode === "usd" ? "ETH" : "USD"}`}
      className="inline-flex items-center gap-1 rounded-[5px] border border-[var(--vex-line)] px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--vex-text-3)] transition-colors hover:border-[var(--vex-line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
    >
      <span className={mode === "usd" ? "text-[var(--vex-text)]" : undefined}>
        USD
      </span>
      <span aria-hidden className="text-[var(--vex-text-3)]">
        /
      </span>
      <span className={mode === "eth" ? "text-[var(--vex-text)]" : undefined}>
        ETH
      </span>
    </button>
  );
}

/**
 * Summary header at the top of the MOVES ledger: `SEED 0.10 ETH · DEPLOYED
 * 0.04 ETH (40%)` in ETH mode, `SEED $190 · DEPLOYED $76 (40%)` in USD mode.
 * Labels use the panel's eyebrow micro-label register (mono, uppercase,
 * wide-tracked, text-3); figures sit in the text-2 register with `tabular-nums`.
 * Seed + its separator drop out when there's no ETH seed source. In USD mode
 * the SEED/DEPLOYED figures convert via the ETH spot price (the portfolio ETH
 * holding, falling back to a price implied from any priced move) and fall back
 * to their ETH figures when no price is available; the `%` is the ETH-based
 * ratio in both modes.
 */
function MovesSummary({
  mode,
  seed,
  deployedEth,
  deployedUsd,
  pct,
  ethPriceUsd,
}: {
  readonly mode: DisplayMode;
  readonly seed: number | null;
  readonly deployedEth: number;
  readonly deployedUsd: number;
  readonly pct: number | null;
  readonly ethPriceUsd: number | null;
}): JSX.Element {
  const usd = mode === "usd";
  const seedText =
    seed === null
      ? null
      : (usd && ethPriceUsd !== null
          ? formatUsdCompact(seed * ethPriceUsd)
          : null) ?? `${formatEth(seed)} ETH`;
  // USD DEPLOYED: prefer the summed priced `valueUsd` of the buys; else convert
  // the ETH-denominated deployed figure at the ETH spot price (the Robinhood
  // path — buys carry no `valueUsd`, but the portfolio ETH price converts the
  // ETH sum); else fall back to the raw ETH figure so a session that staked
  // unpriced ETH with no price at all never reads a misleading `$0.00`.
  const deployedText =
    (usd
      ? deployedUsd > 0
        ? formatUsdCompact(deployedUsd)
        : ethPriceUsd !== null
          ? formatUsdCompact(deployedEth * ethPriceUsd)
          : null
      : null) ?? `${formatEth(deployedEth)} ETH`;
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums">
      {seedText !== null ? (
        <span className="text-[var(--vex-text-3)]">
          <span className="text-[10px] uppercase tracking-[0.14em]">Seed</span>{" "}
          <span className="text-[var(--vex-text-2)]">{seedText}</span>
        </span>
      ) : null}
      {seedText !== null ? (
        <span aria-hidden className="text-[var(--vex-text-3)]">
          ·
        </span>
      ) : null}
      <span className="text-[var(--vex-text-3)]">
        <span className="text-[10px] uppercase tracking-[0.14em]">Deployed</span>{" "}
        <span className="text-[var(--vex-text-2)]">{deployedText}</span>
        {pct !== null ? <span>{` (${Math.round(pct)}%)`}</span> : null}
      </span>
    </div>
  );
}

function MoveRow({
  move,
  mode,
  ethPrice,
}: {
  readonly move: MoveItem;
  readonly mode: DisplayMode;
  readonly ethPrice: number | null;
}): JSX.Element {
  const state = moveState(move.captureStatus);
  const side = sideStamp(move);
  const input = tokenDisplay(move.inputToken);
  const output = tokenDisplay(move.outputToken);
  const inputAmount = amountDisplay(move.inputAmount);
  const outputAmount = amountDisplay(move.outputAmount);
  // USD mode: the unit leg shows the move's compact USD notional — its own
  // `valueUsd`, or its ETH leg converted at the portfolio ETH spot when the move
  // is unpriced (the Robinhood path). `null` (ETH mode, or no price at all)
  // falls the leg back to its ETH figure.
  const usdText = mode === "usd" ? formatUsdCompact(moveUsd(move, ethPrice)) : null;
  const time = formatClock(move.createdAt);
  const explorerUrl = moveExplorerUrl(move.chain, move.txRef);

  // Shared row cells. The `group` sits on the hoverable wrapper (anchor for
  // linked rows, <li> for plain rows) so legs lighten on row hover in both.
  const cells = (
    <>
      {/* Pending = verifiably in-flight → the pulse ring loops; every
       * terminal state (done/failed/cancelled) rests still. */}
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          DOT[state],
          state === "pending" && "vex-pulse-dot",
        )}
      />
      <span
        className={cn(
          "inline-flex h-4 min-w-[42px] shrink-0 items-center justify-center rounded-[3px] border px-1 font-mono text-[9px] uppercase tracking-[0.14em]",
          STAMP_TONE[side.tone],
        )}
      >
        {side.text}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--vex-text-2)] transition-colors group-hover:text-[var(--vex-text)]">
        <span title={input.full ?? undefined}>{legText(input, inputAmount, usdText)}</span>
        <span className="text-[var(--vex-text-3)]">{" → "}</span>
        <span title={output.full ?? undefined}>{legText(output, outputAmount, usdText)}</span>
      </span>
      {time !== null ? (
        <span className="shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
          {time}
        </span>
      ) : null}
    </>
  );

  if (explorerUrl !== null) {
    return (
      <li
        title={move.instrumentKey ?? undefined}
        className="border-b border-[var(--vex-line)] last:border-b-0"
      >
        {/* target=_blank never opens a child window: main's
         * setWindowOpenHandler denies + routes allowlisted hosts through
         * shell.openExternal. The ↗ affordance rests hidden and reveals on
         * hover/keyboard focus. */}
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open transaction on block explorer"
          className="group flex items-center gap-2 rounded-[3px] py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
        >
          {cells}
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            size={11}
            aria-hidden
            className="shrink-0 text-[var(--vex-text-3)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </a>
      </li>
    );
  }

  return (
    <li
      title={move.instrumentKey ?? undefined}
      className="group flex items-center gap-2 border-b border-[var(--vex-line)] py-1.5 last:border-b-0"
    >
      {cells}
    </li>
  );
}
