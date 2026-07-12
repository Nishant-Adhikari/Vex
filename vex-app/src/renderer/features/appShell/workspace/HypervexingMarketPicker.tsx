/**
 * Market picker (design spec §13.4) — the venue-style dropdown that opens
 * from the chart header's coin button. Search over every listed row, an
 * All/Favorites filter, and a data table (Market · Last · 24h · Funding ·
 * Volume · OI) with keyboard selection.
 *
 * Data honesty: rows are a superset type. Today they come from the pushed
 * watchlist (coin/mid/24h/OI); once the full-universe markets read lands the
 * same table gains leverage badges, funding, and volume with NO layout change
 * — absent numbers render an em-dash, never an invention.
 *
 * Popover chrome is the app's solid popover idiom (dialog/select-menu):
 * surface ink + hairline, no blur of its own (the zone beneath is already
 * glass; stacking blur would violate the guard's single-wrapper sanction).
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";

import { cn } from "../../../lib/utils.js";

/** Superset row: watchlist fills a subset today, markets IPC fills all. */
export interface HvMarketRow {
  readonly coin: string;
  readonly midPx: string | null;
  readonly change24hPct: string | null;
  readonly openInterestUsd: string | null;
  readonly maxLeverage?: number;
  readonly fundingRate8hPct?: string | null;
  readonly dayVolumeUsd?: string | null;
}

type PickerFilter = "all" | "favorites";

function compactUsd(value: string | null | undefined): string {
  if (value == null) return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  if (numeric >= 1_000_000_000) return `$${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (numeric >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `$${(numeric / 1_000).toFixed(1)}K`;
  return `$${numeric.toFixed(2)}`;
}

function pct(value: string | null | undefined): { readonly text: string; readonly tone: string } {
  if (value == null) return { text: "—", tone: "text-[var(--vex-text-3)]" };
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { text: "—", tone: "text-[var(--vex-text-3)]" };
  return {
    text: `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`,
    tone: numeric >= 0 ? "text-[var(--vex-long)]" : "text-[var(--vex-short)]",
  };
}

/** OI-desc default ordering — the venue's "what matters first". */
function orderRows(rows: readonly HvMarketRow[]): readonly HvMarketRow[] {
  return [...rows].sort((a, b) => {
    const oiA = a.openInterestUsd === null ? -1 : Number(a.openInterestUsd);
    const oiB = b.openInterestUsd === null ? -1 : Number(b.openInterestUsd);
    return (Number.isFinite(oiB) ? oiB : -1) - (Number.isFinite(oiA) ? oiA : -1);
  });
}

export function filterMarketRows(
  rows: readonly HvMarketRow[],
  queryText: string,
  filter: PickerFilter,
  favorites: readonly string[],
): readonly HvMarketRow[] {
  const needle = queryText.trim().toUpperCase();
  return orderRows(rows).filter((row) => {
    if (filter === "favorites" && !favorites.includes(row.coin)) return false;
    return needle.length === 0 || row.coin.toUpperCase().includes(needle);
  });
}

export function HypervexingMarketPicker({
  rows,
  favorites,
  selectedCoin,
  onToggleFavorite,
  onSelect,
  onClose,
}: {
  readonly rows: readonly HvMarketRow[];
  readonly favorites: readonly string[];
  readonly selectedCoin: string;
  readonly onToggleFavorite: (coin: string) => void;
  readonly onSelect: (coin: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [queryText, setQueryText] = useState("");
  const [filter, setFilter] = useState<PickerFilter>("all");
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Whether the last cursor move came from the keyboard (only then follow). */
  const keyboardCursor = useRef(false);

  const visible = useMemo(
    () => filterMarketRows(rows, queryText, filter, favorites),
    [rows, queryText, filter, favorites],
  );
  const clampedCursor = Math.min(cursor, Math.max(visible.length - 1, 0));

  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  // Keep the keyboard cursor in view by scrolling ONLY the list element.
  // `scrollIntoView` is banned here: it also scrolls overflow-hidden
  // ancestors (the glass zone), which visibly lifted the chart header while
  // hover-scrolling the list (user bug report). Mouse-driven cursor moves
  // never scroll — adjusting scrollTop mid-wheel fights the user's hand.
  useEffect(() => {
    if (!keyboardCursor.current) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(
      `[data-hv-row-index="${clampedCursor}"]`,
    );
    if (list == null || row == null) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) {
      list.scrollTop += rowRect.top - listRect.top;
    } else if (rowRect.bottom > listRect.bottom) {
      list.scrollTop += rowRect.bottom - listRect.bottom;
    }
  }, [clampedCursor]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      keyboardCursor.current = true;
      setCursor((c) => Math.min(c + 1, Math.max(visible.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      keyboardCursor.current = true;
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = visible[clampedCursor];
      if (row !== undefined) {
        onSelect(row.coin);
        onClose();
      }
    }
  };

  const hasExtendedColumns = rows.some((row) => row.maxLeverage !== undefined);

  return (
    <>
      {/* Click-away scrim (transparent — the room stays visible). */}
      <button
        type="button"
        aria-label="Close market picker"
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default"
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-label="Select market"
        onKeyDown={onKeyDown}
        className="absolute left-0 top-full z-30 mt-2 flex max-h-[420px] w-[min(620px,calc(100vw-380px))] min-w-[440px] flex-col overflow-hidden rounded-xl border border-[var(--vex-line-strong)] bg-[var(--vex-surface-1)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--vex-line)] p-2.5">
          <input
            ref={searchRef}
            value={queryText}
            onChange={(event) => {
              setQueryText(event.target.value);
              setCursor(0);
            }}
            placeholder="Search markets"
            aria-label="Search markets"
            className="h-8 min-w-0 flex-1 rounded-md border border-[var(--vex-line)] bg-[var(--vex-surface-0)] px-2.5 font-mono text-[12px] text-[var(--vex-text)] placeholder:text-[var(--vex-text-3)] focus-visible:border-[var(--vex-accent-border)] focus-visible:outline-none"
          />
          {(["all", "favorites"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setFilter(id);
                setCursor(0);
              }}
              aria-pressed={filter === id}
              className={cn(
                "h-8 rounded-md px-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                filter === id
                  ? "bg-[var(--vex-accent-fill-12)] text-[var(--vex-accent-text)]"
                  : "text-[var(--vex-text-3)] hover:text-[var(--vex-text-2)]",
              )}
            >
              {id === "all" ? "All" : "Favorites"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[16px_minmax(96px,1.2fr)_1fr_0.8fr_0.9fr_0.9fr] items-center gap-2 px-3 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
          <span aria-hidden />
          <span>Market</span>
          <span className="text-right">Last</span>
          <span className="text-right">24h</span>
          <span className="text-right">{hasExtendedColumns ? "8h Funding" : "OI"}</span>
          <span className="text-right">{hasExtendedColumns ? "OI" : ""}</span>
        </div>

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1.5"
          role="listbox"
          aria-label="Markets"
        >
          {visible.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-[var(--vex-text-3)]">
              {filter === "favorites" && favorites.length === 0
                ? "No favorites yet — star a market to pin it here."
                : "No market matches."}
            </p>
          ) : (
            visible.map((row, index) => {
              const change = pct(row.change24hPct);
              const funding = pct(row.fundingRate8hPct);
              const starred = favorites.includes(row.coin);
              return (
                <div
                  key={row.coin}
                  data-hv-row-index={index}
                  role="option"
                  aria-selected={row.coin === selectedCoin}
                  className={cn(
                    "grid cursor-pointer grid-cols-[16px_minmax(96px,1.2fr)_1fr_0.8fr_0.9fr_0.9fr] items-center gap-2 px-3 py-1.5 transition-colors duration-100",
                    index === clampedCursor
                      ? "bg-[var(--vex-accent-fill-8)]"
                      : "hover:bg-[var(--vex-accent-fill-8)]",
                  )}
                  onMouseEnter={() => {
                    keyboardCursor.current = false;
                    setCursor(index);
                  }}
                  onClick={() => {
                    onSelect(row.coin);
                    onClose();
                  }}
                >
                  <button
                    type="button"
                    aria-label={starred ? `Unstar ${row.coin}` : `Star ${row.coin}`}
                    aria-pressed={starred}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavorite(row.coin);
                    }}
                    className={cn(
                      "text-[11px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                      starred ? "text-[var(--vex-accent-text)]" : "text-[var(--vex-text-3)] hover:text-[var(--vex-text-2)]",
                    )}
                  >
                    {starred ? "★" : "☆"}
                  </button>
                  <span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] tabular-nums text-[var(--vex-text)]">
                    <span className="truncate">{row.coin}-USD</span>
                    {row.maxLeverage !== undefined ? (
                      <span className="shrink-0 rounded-sm bg-[var(--vex-accent-fill-12)] px-1 py-px font-mono text-[9px] tabular-nums text-[var(--vex-accent-text)]">
                        {row.maxLeverage}x
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right font-mono text-[12px] tabular-nums text-[var(--vex-text-2)]">
                    {row.midPx ?? "—"}
                  </span>
                  <span className={cn("text-right font-mono text-[11px] tabular-nums", change.tone)}>
                    {change.text}
                  </span>
                  {hasExtendedColumns ? (
                    <>
                      <span className={cn("text-right font-mono text-[11px] tabular-nums", funding.tone)}>
                        {funding.text}
                      </span>
                      <span className="text-right font-mono text-[11px] tabular-nums text-[var(--vex-text-2)]">
                        {compactUsd(row.openInterestUsd)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-right font-mono text-[11px] tabular-nums text-[var(--vex-text-2)]">
                        {compactUsd(row.openInterestUsd)}
                      </span>
                      <span aria-hidden />
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
