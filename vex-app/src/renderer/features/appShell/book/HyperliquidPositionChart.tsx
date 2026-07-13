/**
 * Per-position Hyperliquid chart. lightweight-charts is used directly (no
 * React wrapper) because its lifecycle must be owned by this component.
 * Numeric conversion is a rendering adapter only; policy/signing and every
 * IPC boundary retain canonical decimal strings.
 */

import { useEffect, useRef, type JSX } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  createChart,
  type UTCTimestamp,
} from "lightweight-charts";

import type {
  HyperliquidCandleInterval,
  HyperliquidPositionDto,
} from "@shared/schemas/hyperliquid.js";
import { useHyperliquidCandles } from "../../../lib/api/hyperliquid.js";

export type CandleChartState = "loading" | "error" | "empty" | "ready";

export function deriveCandleChartState(
  isLoading: boolean,
  isError: boolean,
  result: { readonly ok: boolean; readonly data?: { readonly candles: readonly unknown[] } } | undefined,
): CandleChartState {
  if (isLoading) return "loading";
  if (isError || result?.ok === false) return "error";
  return result?.ok && (result.data?.candles.length ?? 0) > 0 ? "ready" : "empty";
}

function renderNumber(value: string): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * lightweight-charts colors are JS options, not CSS, so the design tokens are
 * read at runtime from the shell scope (design spec §7) — NO hex literals in
 * this module; every color resolves from a --vex-* custom property. The
 * properties are defined CONCRETE (hex / rgba, never color-mix/var indirection)
 * in globals.css so the computed value survives the getComputedStyle read. This
 * runs only after the chart host is mounted inside the [data-vex-shell] scope,
 * where the cascade always resolves the tokens to non-empty values.
 */
function readChartTokens(host: Element): {
  readonly bg: string;
  readonly axis: string;
  readonly grid: string;
  readonly border: string;
  readonly long: string;
  readonly short: string;
  readonly volume: string;
  readonly entry: string;
  readonly sl: string;
  readonly liq: string;
  readonly last: string;
} {
  const style = getComputedStyle(host);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  return {
    bg: read("--vex-chart-bg"),
    axis: read("--vex-chart-axis"),
    grid: read("--vex-chart-grid"),
    border: read("--vex-line-strong"),
    long: read("--vex-long"),
    short: read("--vex-short"),
    volume: read("--vex-chart-volume"),
    entry: read("--vex-chart-entry"),
    sl: read("--vex-chart-sl"),
    liq: read("--vex-chart-liq"),
    last: read("--vex-chart-last"),
  };
}

export function HyperliquidPositionChart({
  sessionId,
  coin,
  interval = "1h",
  position = null,
  fill = false,
  liveMid = null,
}: {
  readonly sessionId: string;
  /** Market driving the candles — a chart needs a coin, not a position. */
  readonly coin: string;
  /** Candle interval; callers without an interval control keep the 1H default. */
  readonly interval?: HyperliquidCandleInterval;
  /** Optional overlay: entry/SL/liq/mark lines render only when present. */
  readonly position?: HyperliquidPositionDto | null;
  /** Fill the host container's height instead of the compact 180px block. */
  readonly fill?: boolean;
  /** Live mid from the WS watch — drives the MARK line between pushes. */
  readonly liveMid?: string | null;
}): JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const query = useHyperliquidCandles(sessionId, coin, interval);
  const candles = query.data?.ok ? query.data.data.candles : null;
  const state = deriveCandleChartState(query.isLoading, query.isError, query.data);
  // Imperative handles for the live layer: candle ticks and mid moves mutate
  // the existing series in place — rebuilding the canvas per tick is banned.
  const candleSeries = useRef<CandleUpdateSeries | null>(null);
  const volumeSeries = useRef<CandleUpdateSeries | null>(null);
  const markLine = useRef<PriceLineHandle | null>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null || candles === null || candles.length === 0) return;
    const token = readChartTokens(element);
    const chart = createChart(element, {
      width: Math.max(element.clientWidth, 220),
      height: fill ? Math.max(element.clientHeight, 220) : 180,
      // Solid recessed floor (owner order: the transparent canvas blended the
      // candles into the glass zone) — the plot reads as its own dark well.
      layout: { background: { color: token.bg || "transparent" }, textColor: token.axis },
      grid: { vertLines: { color: token.grid }, horzLines: { color: token.grid } },
      rightPriceScale: { borderColor: token.border },
      timeScale: { borderColor: token.border, timeVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: token.long, downColor: token.short, borderVisible: false,
      wickUpColor: token.long, wickDownColor: token.short,
    });
    series.setData(candles.map((candle) => ({
      // lightweight-charts brands epoch seconds as UTCTimestamp; the cast is
      // the upstream-documented conversion for numeric epoch input.
      time: Math.floor(candle.openTimeMs / 1_000) as UTCTimestamp,
      open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close),
    })));
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      color: token.volume,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    volume.setData(candles.map((candle) => ({ time: Math.floor(candle.openTimeMs / 1_000) as UTCTimestamp, value: Number(candle.volume) })));

    if (position !== null) {
      addPriceLine(series, position.entryPx, "ENTRY", token.entry);
      if (position.slPrice !== null) addPriceLine(series, position.slPrice, "SL", token.sl, LineStyle.Dashed);
      if (position.tpPrice !== null) addPriceLine(series, position.tpPrice, "TP", token.long, LineStyle.Dashed);
      if (position.liquidationPx !== null) addPriceLine(series, position.liquidationPx, "LIQ", token.liq, LineStyle.Dashed);
      markLine.current = addPriceLine(series, position.markPx, "MARK", token.last, LineStyle.Dotted);
    }
    chart.timeScale().fitContent();
    candleSeries.current = series;
    volumeSeries.current = volume;

    const resize = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      const height = entries[0]?.contentRect.height;
      if (width !== undefined && width > 0) {
        chart.applyOptions({ width, ...(fill && height !== undefined && height > 0 ? { height } : {}) });
      }
    });
    resize.observe(element);
    return () => {
      candleSeries.current = null;
      volumeSeries.current = null;
      markLine.current = null;
      resize.disconnect();
      chart.remove();
    };
  }, [candles, coin, fill, position, position?.entryPx, position?.liquidationPx, position?.markPx, position?.slPrice, position?.tpPrice]);

  // LIVE LAYER 1 — per-tick candle updates from main's shared WS watch.
  // `series.update` mutates the last bar (or appends a new one) in place.
  useEffect(() => {
    return window.vex.hyperliquid.onCandleUpdate((event) => {
      if (event.coin !== coin || event.interval !== interval) return;
      const time = Math.floor(event.candle.openTimeMs / 1_000) as UTCTimestamp;
      const open = Number(event.candle.open);
      const high = Number(event.candle.high);
      const low = Number(event.candle.low);
      const close = Number(event.candle.close);
      const volume = Number(event.candle.volume);
      if (![open, high, low, close, volume].every(Number.isFinite)) return;
      candleSeries.current?.update({ time, open, high, low, close });
      volumeSeries.current?.update({ time, value: volume });
    });
  }, [coin, interval]);

  // LIVE LAYER 2 — the MARK overlay follows the live mid between position
  // pushes, so an open position breathes with the market.
  useEffect(() => {
    if (liveMid === null) return;
    const price = Number(liveMid);
    if (!Number.isFinite(price)) return;
    markLine.current?.applyOptions({ price });
  }, [liveMid]);

  if (state === "loading") return <p className="mt-2 text-[10px] text-[var(--vex-text-3)]">Loading chart…</p>;
  if (state === "error") return <p className="mt-2 text-[10px] text-[var(--vex-warn-text)]">Chart unavailable.</p>;
  if (state === "empty") return <p className="mt-2 text-[10px] text-[var(--vex-text-3)]">No candle history yet.</p>;
  return (
    <div
      ref={host}
      aria-label={`${coin} price chart`}
      className={fill ? "h-full min-h-[220px] w-full" : "mt-2 h-[180px] w-full"}
    />
  );
}

/** The subset of lightweight-charts' IPriceLine the live layer needs. */
interface PriceLineHandle {
  applyOptions(options: { readonly price: number }): void;
}

/** The subset of ISeriesApi the live tick layer needs (candles + volume). */
interface CandleUpdateSeries {
  update(bar: { readonly time: UTCTimestamp } & Record<string, unknown>): void;
}

interface PriceLineSeries {
  createPriceLine(options: {
    readonly price: number;
    readonly title: string;
    readonly color: string;
    readonly lineWidth: 1;
    readonly lineStyle: LineStyle;
    readonly axisLabelVisible: boolean;
  }): PriceLineHandle;
}

function addPriceLine(
  series: PriceLineSeries,
  value: string,
  title: string,
  color: string,
  lineStyle = LineStyle.Solid,
): PriceLineHandle | null {
  const price = renderNumber(value);
  if (price === null) return null;
  return series.createPriceLine({ price, title, color, lineWidth: 1, lineStyle, axisLabelVisible: true });
}
