/**
 * Center chart pane v2 (design spec §13.3, zone `chart`). The chart IS the
 * room — no card chrome. The header is the venue's cockpit row: the coin
 * button (opens the market picker), live last price + delta, interval chips,
 * and the coverage badge when a position exists on the selected market.
 *
 * Market context lives HERE, not in the top bar. Candle interval is
 * mount-ephemeral state (a fresh room starts at 1H, like the venue).
 */

import { useEffect, useMemo, useState, type JSX } from "react";

import type {
  HyperliquidCandleInterval,
  HyperliquidMarketDto,
  HyperliquidPositionDto,
  HyperliquidWatchlistItemDto,
} from "@shared/schemas/hyperliquid.js";
import {
  useHyperliquidCandles,
  useHyperliquidLiveWatch,
  useHyperliquidMarkets,
} from "../../../lib/api/hyperliquid.js";
import { useUiStore } from "../../../stores/uiStore.js";
import { useSubmitChat } from "../../../lib/api/chat.js";
import { cn } from "../../../lib/utils.js";
import { SelectMenu } from "../../../components/ui/select-menu.js";
import { HyperliquidCoverageBadge } from "../book/HyperliquidCoverageBadge.js";
import { HyperliquidPositionChart } from "../book/HyperliquidPositionChart.js";
import { deriveHyperliquidCoverage } from "../book/HyperliquidPositionsBlock.js";
import {
  HypervexingMarketPicker,
  type HvMarketRow,
} from "./HypervexingMarketPicker.js";
import { directionToneClass } from "./workspacePositions.js";

const INTERVALS: readonly {
  readonly id: HyperliquidCandleInterval;
  readonly label: string;
}[] = [
  { id: "5m", label: "5M" },
  { id: "15m", label: "15M" },
  { id: "1h", label: "1H" },
  { id: "4h", label: "4H" },
  { id: "1d", label: "1D" },
];

function lastCloseAndDelta(
  candles: readonly { readonly close: string; readonly open: string }[] | null,
): { readonly last: string; readonly deltaPct: number } | null {
  const tail = candles === null || candles.length === 0 ? undefined : candles[candles.length - 1];
  if (tail === undefined) return null;
  const open = Number(tail.open);
  const close = Number(tail.close);
  const deltaPct = Number.isFinite(open) && open > 0 && Number.isFinite(close)
    ? ((close - open) / open) * 100
    : 0;
  return { last: tail.close, deltaPct };
}

/** Watchlist push → picker rows; the fallback while the markets read loads. */
function rowsFromWatchlist(
  watchlist: readonly HyperliquidWatchlistItemDto[],
): readonly HvMarketRow[] {
  return watchlist.map((item) => ({
    coin: item.coin,
    midPx: item.midPx,
    change24hPct: item.change24hPct,
    openInterestUsd: item.openInterestUsd,
  }));
}

/** Full-universe markets read → picker rows with leverage/funding/volume. */
function rowsFromMarkets(
  markets: readonly HyperliquidMarketDto[],
): readonly HvMarketRow[] {
  return markets.map((market) => ({
    coin: market.coin,
    midPx: market.markPx,
    change24hPct: market.change24hPct,
    openInterestUsd: market.openInterestUsd,
    maxLeverage: market.maxLeverage,
    fundingRate8hPct: market.fundingRate8hPct,
    dayVolumeUsd: market.dayNtlVlmUsd,
  }));
}

function compactUsd(value: string | null | undefined): string {
  if (value == null) return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  if (numeric >= 1_000_000_000) return `$${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (numeric >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `$${(numeric / 1_000).toFixed(1)}K`;
  return `$${numeric.toFixed(2)}`;
}

/** Venue funding pays hourly — countdown ticks to the top of the hour. */
function useFundingCountdown(): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = 3_600_000 - (now % 3_600_000);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function HeaderStat({
  label,
  value,
  toneClass,
}: {
  readonly label: string;
  readonly value: string;
  readonly toneClass?: string;
}): JSX.Element {
  return (
    <span className="flex flex-col leading-tight">
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[12px] tabular-nums",
          toneClass ?? "text-[var(--vex-text-2)]",
        )}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * Live position economics (owner-requested): the open position's P&L breathes
 * with the WS mid. PnL = (mid − entry) × size × direction; ROE approximates
 * pnl ÷ (notional ÷ leverage) and renders only when leverage is known.
 * Decimal→number is rendering-only, like the chart adapter. Falls back to the
 * venue-confirmed unrealizedPnl until the first mid arrives.
 */
export function computeLivePnl(
  position: Pick<HyperliquidPositionDto, "side" | "size" | "entryPx" | "leverage" | "unrealizedPnl">,
  liveMid: string | null,
): { readonly pnl: number; readonly roePct: number | null } | null {
  const size = Number(position.size);
  const entry = Number(position.entryPx);
  const mid = liveMid === null ? Number.NaN : Number(liveMid);
  const direction = position.side === "long" ? 1 : -1;
  const pnl =
    Number.isFinite(mid) && Number.isFinite(entry) && Number.isFinite(size)
      ? (mid - entry) * size * direction
      : Number(position.unrealizedPnl);
  if (!Number.isFinite(pnl)) return null;
  const leverage = position.leverage === null ? Number.NaN : Number(position.leverage);
  const margin = Number.isFinite(leverage) && leverage > 0 ? (entry * size) / leverage : Number.NaN;
  const roePct = Number.isFinite(margin) && margin > 0 ? (pnl / margin) * 100 : null;
  return { pnl, roePct };
}

/**
 * Inline SL/TP editor (owner feature): the value doubles as a button; one
 * click opens a tiny price input, confirm routes the change through the
 * AGENT ("move my stop…") — the same policy/protection/approval path as any
 * other mutation. The UI never signs.
 */
function EditableTrigger({
  label,
  coin,
  value,
  sessionId,
  kind,
}: {
  readonly label: string;
  readonly coin: string;
  readonly value: string | null;
  readonly sessionId: string | null;
  readonly kind: "stop-loss" | "take-profit";
}): JSX.Element {
  const submit = useSubmitChat();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const send = (): void => {
    const price = draft.trim();
    if (sessionId === null || price.length === 0) return;
    submit.mutate({
      sessionId,
      message: `Move my ${coin} ${kind} to ${price}. Keep it full-position and confirm the result.`,
    });
    setEditing(false);
    setDraft("");
  };
  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-[var(--vex-text-3)]">{label}</span>
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
            if (event.key === "Escape") setEditing(false);
          }}
          placeholder={value ?? "price"}
          inputMode="decimal"
          aria-label={`New ${coin} ${kind} price`}
          className="w-[76px] rounded border border-[var(--vex-accent-border)] bg-[var(--vex-surface-down)] px-1 py-0.5 font-mono text-[11px] tabular-nums text-[var(--vex-text)] focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={submit.isPending}
          className="font-mono text-[10px] uppercase text-[var(--vex-accent-text)] hover:underline disabled:opacity-40"
        >
          {submit.isPending ? "…" : "Set"}
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={`Edit ${kind} via Vex`}
      className="group/edit inline-flex items-baseline gap-1 rounded px-0.5 text-[var(--vex-text-3)] transition-colors hover:bg-[var(--vex-accent-fill-8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
    >
      {label} <span className="text-[var(--vex-text-2)]">{value ?? "—"}</span>
      <span aria-hidden className="text-[9px] opacity-0 transition-opacity group-hover/edit:opacity-70">✎</span>
    </button>
  );
}

function PositionEconomicsStrip({
  position,
  liveMid,
  sessionId,
}: {
  readonly position: HyperliquidPositionDto;
  readonly liveMid: string | null;
  readonly sessionId: string | null;
}): JSX.Element {
  const economics = computeLivePnl(position, liveMid);
  const tone =
    economics === null || economics.pnl === 0
      ? "text-[var(--vex-text-2)]"
      : economics.pnl > 0
        ? "text-[var(--vex-long)]"
        : "text-[var(--vex-short)]";
  const signedUsd = (value: number): string =>
    `${value >= 0 ? "+" : "−"}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-[var(--vex-surface-2)] px-3 py-1.5 font-mono text-[11px] tabular-nums">
      <span
        className={cn(
          "text-[10px] uppercase tracking-[0.14em]",
          position.side === "long" ? "text-[var(--vex-long)]" : "text-[var(--vex-short)]",
        )}
      >
        {position.side} {position.size} @ {position.entryPx}
      </span>
      <span className={cn("font-semibold", tone)}>
        {/* ROE is an initial-margin ESTIMATE (entry×size÷leverage) — true ROE
         * needs marginUsed, which the venue does not give us per position;
         * cross margin is shared and isolated margin is user-adjustable. */}
        {economics === null
          ? "PnL —"
          : `PnL ${signedUsd(economics.pnl)}${economics.roePct === null ? "" : ` (${economics.roePct >= 0 ? "+" : ""}${economics.roePct.toFixed(2)}% est.)`}`}
      </span>
      <EditableTrigger label="SL" coin={position.coin} value={position.slPrice} sessionId={sessionId} kind="stop-loss" />
      <EditableTrigger label="TP" coin={position.coin} value={position.tpPrice} sessionId={sessionId} kind="take-profit" />
      {position.liquidationPx !== null ? (
        <span className="text-[var(--vex-text-3)]">
          Liq <span className="text-[var(--vex-text-2)]">{position.liquidationPx}</span>
        </span>
      ) : null}
    </div>
  );
}

/** Venue cockpit strip: 24h Δ · 24h Vol · OI · Funding + hourly countdown. */
function MarketStatsStrip({
  market,
}: {
  readonly market: HyperliquidMarketDto;
}): JSX.Element {
  const countdown = useFundingCountdown();
  const change = market.change24hPct === null ? null : Number(market.change24hPct);
  const funding = market.fundingRate8hPct === null ? null : Number(market.fundingRate8hPct);
  return (
    <div className="flex items-center gap-4 border-l border-[var(--vex-line)] pl-4">
      <HeaderStat label="Mark" value={market.markPx} toneClass="text-[var(--vex-text)]" />
      <HeaderStat
        label="24h"
        value={
          change === null || !Number.isFinite(change)
            ? "—"
            : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
        }
        toneClass={
          change === null || !Number.isFinite(change)
            ? undefined
            : change >= 0
              ? "text-[var(--vex-long)]"
              : "text-[var(--vex-short)]"
        }
      />
      <HeaderStat label="24h Vol" value={compactUsd(market.dayNtlVlmUsd)} />
      <HeaderStat label="OI" value={compactUsd(market.openInterestUsd)} />
      <HeaderStat
        label={`Funding · ${countdown}`}
        value={
          funding === null || !Number.isFinite(funding)
            ? "—"
            : `${funding >= 0 ? "+" : ""}${funding.toFixed(4)}%`
        }
        toneClass={
          funding === null || !Number.isFinite(funding)
            ? undefined
            : funding >= 0
              ? "text-[var(--vex-long)]"
              : "text-[var(--vex-short)]"
        }
      />
    </div>
  );
}

export function HypervexingChartPane({
  sessionId,
  coin,
  position,
  watchlist,
  onSelectCoin,
}: {
  readonly sessionId: string | null;
  readonly coin: string;
  readonly position: HyperliquidPositionDto | null;
  readonly watchlist: readonly HyperliquidWatchlistItemDto[];
  readonly onSelectCoin: (coin: string) => void;
}): JSX.Element {
  const [interval, setInterval] = useState<HyperliquidCandleInterval>("1h");
  const [pickerOpen, setPickerOpen] = useState(false);
  const hlFavorites = useUiStore((s) => s.hlFavorites);
  const toggleHlFavorite = useUiStore((s) => s.toggleHlFavorite);

  const candlesQuery = useHyperliquidCandles(sessionId, coin, interval);
  const candles = candlesQuery.data?.ok ? candlesQuery.data.data.candles : null;
  const tick = lastCloseAndDelta(candles);
  // WS live layer: header price beats the snapshot the moment mids arrive.
  const { liveMid } = useHyperliquidLiveWatch(sessionId, coin, interval);
  const headerLast = liveMid ?? tick?.last ?? null;

  const marketsQuery = useHyperliquidMarkets(sessionId);
  const markets = marketsQuery.data?.ok ? marketsQuery.data.data : null;
  const pickerRows = useMemo(
    () => (markets !== null && markets.length > 0 ? rowsFromMarkets(markets) : rowsFromWatchlist(watchlist)),
    [markets, watchlist],
  );
  const selectedMarket = markets?.find((market) => market.coin === coin) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="relative mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          className="group flex items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors duration-150 hover:bg-[var(--vex-accent-fill-8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          <span className="font-serif text-[26px] leading-none text-[var(--vex-text)]">
            {coin}
            <span className="text-[var(--vex-text-3)]">-USD</span>
          </span>
          {/* Leverage chip — venue-fed (per-asset maxLeverage from markets, or
           * the live position's leverage), optically CENTERED against the
           * serif symbol (baseline alignment dropped the chip; owner fix) and
           * carrying the app's sanctioned shimmer. */}
          {position?.leverage != null ? (
            <span className="vex-badge--shimmer self-center rounded-sm bg-[var(--vex-accent-fill-12)] px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums text-[var(--vex-accent-text)]">
              {position.leverage}x
            </span>
          ) : selectedMarket !== null ? (
            <span className="vex-badge--shimmer self-center rounded-sm bg-[var(--vex-surface-2)] px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums text-[var(--vex-text-2)]">
              {selectedMarket.maxLeverage}x
            </span>
          ) : null}
          <span
            aria-hidden
            className={cn(
              "font-mono text-[10px] text-[var(--vex-text-3)] transition-transform duration-150 group-hover:text-[var(--vex-text-2)]",
              pickerOpen && "rotate-180",
            )}
          >
            ▾
          </span>
        </button>
        {pickerOpen ? (
          <HypervexingMarketPicker
            rows={pickerRows}
            favorites={hlFavorites}
            selectedCoin={coin}
            onToggleFavorite={toggleHlFavorite}
            onSelect={onSelectCoin}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}

        {headerLast !== null ? (
          <span className="font-mono text-[18px] font-semibold tabular-nums leading-none text-[var(--vex-text)]">
            {headerLast}
          </span>
        ) : null}
        {tick !== null && selectedMarket === null ? (
          <span
            className={`font-mono text-[11px] tabular-nums leading-none ${directionToneClass(tick.deltaPct)}`}
          >
            {tick.deltaPct >= 0 ? "+" : ""}
            {tick.deltaPct.toFixed(2)}%
          </span>
        ) : null}
        {selectedMarket !== null ? <MarketStatsStrip market={selectedMarket} /> : null}
        {position !== null ? (
          <HyperliquidCoverageBadge label={deriveHyperliquidCoverage(position)} />
        ) : null}

        {/* Interval as a compact dropdown (user-ordered): frees header room so
         * the stats strip text never clips at narrower chart widths. */}
        <div className="ml-auto flex shrink-0 items-center">
          <SelectMenu
            value={interval}
            options={INTERVALS.map((option) => ({ value: option.id, label: option.label }))}
            onChange={(value) => {
              const next = INTERVALS.find((option) => option.id === value);
              if (next !== undefined) setInterval(next.id);
            }}
            ariaLabel="Candle interval"
            className="w-[84px]"
          />
        </div>
      </div>

      {position !== null ? (
        <PositionEconomicsStrip position={position} liveMid={liveMid} sessionId={sessionId} />
      ) : null}

      <div className="min-h-0 flex-1">
        {sessionId === null ? (
          <p className="pt-8 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
            Open a session to load markets.
          </p>
        ) : (
          <HyperliquidPositionChart
            sessionId={sessionId}
            coin={coin}
            interval={interval}
            position={position}
            liveMid={liveMid}
            fill
          />
        )}
      </div>
    </div>
  );
}
