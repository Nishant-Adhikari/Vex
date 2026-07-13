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
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import type { MoveItem } from "@shared/schemas/portfolio-moves.js";
import { useMoves } from "../../../lib/api/portfolio.js";
import { useMissionSessionResult } from "../../../lib/api/mission.js";
import { moveExplorerUrl } from "../../../lib/explorer-links.js";
import { formatClock, truncateAddress } from "../../../lib/format.js";
import { formatEth } from "../missionHistoryModel.js";
import { cn } from "../../../lib/utils.js";
import { BookBlock } from "./BookBlock.js";

/** Rendered window: the 10 newest fills. The badge counts the fetched total. */
const MOVES_DISPLAY_CAP = 10;

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
 * Deployed as a percentage of the seed. `null` when the seed is missing, zero,
 * or non-finite (no meaningful denominator) — the header then drops the `(N%)`.
 */
export function deployedPct(deployed: number, seed: number | null): number | null {
  if (seed === null || !Number.isFinite(seed) || seed <= 0) return null;
  if (!Number.isFinite(deployed)) return null;
  return (deployed / seed) * 100;
}

/**
 * One leg's printed text: `0.01 ETH` for a base/native/quote UNIT that carries
 * a displayable amount, else the bare symbol (`VENA`). The traded token's raw
 * quantity is intentionally dropped (owner: "we don't care about qty") — only
 * the unit leg keeps its figure.
 */
function legText(display: TokenDisplay, amount: string | null): string {
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
  const query = useMoves(sessionId);
  const result = query.data;
  const allMoves = result?.ok ? result.data : [];
  const moves = allMoves.slice(0, MOVES_DISPLAY_CAP);

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
  const pct = deployedPct(deployedEth, seedEth);

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
        <MovesSummary seed={seedEth} deployed={deployedEth} pct={pct} />
        {/* Landing .ws-stat grammar: hairline-separated ledger rows, mono figures. */}
        <ul className="flex flex-col">
          {moves.map((m) => <MoveRow key={m.id} move={m} />)}
        </ul>
      </>
    );
  }

  return (
    <BookBlock
      title="Moves"
      trailing={
        allMoves.length > 0 ? (
          // Landing .ws-badge: accent fill, accent-contrast mono figure
          // (white on cobalt, ink on the Robinhood lime fill), rounded-[5px].
          // Counts the FETCHED total (server-capped at MOVES_MAX), not the
          // 10-row display window below it.
          <span className="inline-flex min-w-[18px] items-center justify-center rounded-[5px] bg-[var(--vex-accent)] px-1.5 py-px font-mono text-[9px] font-medium tabular-nums text-[var(--vex-accent-contrast)]">
            {allMoves.length}
          </span>
        ) : undefined
      }
    >
      {body}
    </BookBlock>
  );
}

/**
 * Summary header at the top of the MOVES ledger: `SEED 0.10 ETH · DEPLOYED
 * 0.04 ETH (40%)`. ETH is the unit throughout. Labels use the panel's eyebrow
 * micro-label register (mono, uppercase, wide-tracked, text-3); figures sit in
 * the text-2 register with `tabular-nums`, matching the ledger rows. Seed +
 * its separator drop out when there's no ETH seed source, so the header
 * degrades to Deployed alone rather than showing a fabricated denominator.
 */
function MovesSummary({
  seed,
  deployed,
  pct,
}: {
  readonly seed: number | null;
  readonly deployed: number;
  readonly pct: number | null;
}): JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums">
      {seed !== null ? (
        <span className="text-[var(--vex-text-3)]">
          <span className="text-[10px] uppercase tracking-[0.14em]">Seed</span>{" "}
          <span className="text-[var(--vex-text-2)]">{formatEth(seed)} ETH</span>
        </span>
      ) : null}
      {seed !== null ? (
        <span aria-hidden className="text-[var(--vex-text-3)]">
          ·
        </span>
      ) : null}
      <span className="text-[var(--vex-text-3)]">
        <span className="text-[10px] uppercase tracking-[0.14em]">Deployed</span>{" "}
        <span className="text-[var(--vex-text-2)]">{formatEth(deployed)} ETH</span>
        {pct !== null ? <span>{` (${Math.round(pct)}%)`}</span> : null}
      </span>
    </div>
  );
}

function MoveRow({ move }: { readonly move: MoveItem }): JSX.Element {
  const state = moveState(move.captureStatus);
  const side = sideStamp(move);
  const input = tokenDisplay(move.inputToken);
  const output = tokenDisplay(move.outputToken);
  const inputAmount = amountDisplay(move.inputAmount);
  const outputAmount = amountDisplay(move.outputAmount);
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
        <span title={input.full ?? undefined}>{legText(input, inputAmount)}</span>
        <span className="text-[var(--vex-text-3)]">{" → "}</span>
        <span title={output.full ?? undefined}>{legText(output, outputAmount)}</span>
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
