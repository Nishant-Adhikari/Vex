/**
 * Signals hour-grouping helper (Signals section) — pure, presentation-only.
 *
 * Takes the sanitized signal DTOs and buckets them into hour groups keyed by
 * each signal's ingest time, formatted in the renderer's LOCAL timezone
 * (this is a desktop Electron app — local tz is the user's tz). Groups are
 * ordered newest-hour-first and, within a group, newest signal first, so
 * "which is latest" reads top-to-bottom.
 *
 * Fail-soft: a missing or unparseable `ingestedAt` never throws — those rows
 * collect under a single "Unknown time" group pinned to the bottom, preserving
 * their input order.
 *
 * DISCOVERY/observability only — this reorders how signals are DISPLAYED and
 * touches no scoring, grading, or trade logic.
 */

import type { SignalListItemDto } from "@shared/schemas/signals.js";

/** Stable key for the synthetic bottom group holding undated rows. */
export const UNKNOWN_HOUR_KEY = "unknown";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** A signal plus its parsed time + preformatted local stamp for the row. */
export interface GroupedSignal {
  readonly signal: SignalListItemDto;
  /** Epoch ms of `ingestedAt`, or `null` when missing/unparseable. */
  readonly time: number | null;
  /** Compact local stamp e.g. `Jul 24 · 05:12`, or `null` when undated. */
  readonly stamp: string | null;
}

/** One hour bucket, formatted for display. */
export interface SignalHourGroup {
  /** Stable react key: `YYYY-MM-DDTHH` (local) or {@link UNKNOWN_HOUR_KEY}. */
  readonly key: string;
  /** Epoch ms at the top of the hour (local). `null` for the unknown group. */
  readonly hourStart: number | null;
  /** Hour label e.g. `05:00`, or `Unknown time` for the undated bucket. */
  readonly hourLabel: string;
  /** Day label e.g. `Jul 24`; empty string for the unknown bucket. */
  readonly dateLabel: string;
  readonly signals: readonly GroupedSignal[];
}

function localHourKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate(),
  )}T${pad2(d.getHours())}`;
}

function fmtStamp(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}`;
}

function fmtDateLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function fmtHourLabel(d: Date): string {
  return `${pad2(d.getHours())}:00`;
}

interface MutableGroup {
  key: string;
  hourStart: number | null;
  hourLabel: string;
  dateLabel: string;
  signals: GroupedSignal[];
}

/**
 * Bucket signals into hour groups, newest first (descending). Groups are
 * ordered by hour-start descending; within each group signals are ordered by
 * ingest time descending. Rows with a missing/unparseable `ingestedAt` land in
 * a single "Unknown time" group pinned last, keeping their input order.
 */
export function groupSignalsByHour(
  signals: readonly SignalListItemDto[],
): readonly SignalHourGroup[] {
  const byKey = new Map<string, MutableGroup>();

  for (const signal of signals) {
    const parsed = Date.parse(signal.ingestedAt);
    if (Number.isNaN(parsed)) {
      const unknown = byKey.get(UNKNOWN_HOUR_KEY) ?? {
        key: UNKNOWN_HOUR_KEY,
        hourStart: null,
        hourLabel: "Unknown time",
        dateLabel: "",
        signals: [],
      };
      unknown.signals.push({ signal, time: null, stamp: null });
      byKey.set(UNKNOWN_HOUR_KEY, unknown);
      continue;
    }

    const d = new Date(parsed);
    const key = localHourKey(d);
    const group = byKey.get(key) ?? {
      key,
      hourStart: new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        d.getHours(),
        0,
        0,
        0,
      ).getTime(),
      hourLabel: fmtHourLabel(d),
      dateLabel: fmtDateLabel(d),
      signals: [],
    };
    group.signals.push({ signal, time: parsed, stamp: fmtStamp(d) });
    byKey.set(key, group);
  }

  const groups = [...byKey.values()];
  // Newest hour first; the undated group (hourStart === null) sorts last.
  groups.sort((a, b) => {
    if (a.hourStart === null) return b.hourStart === null ? 0 : 1;
    if (b.hourStart === null) return -1;
    return b.hourStart - a.hourStart;
  });
  // Newest signal first within each dated hour; preserve input order for the
  // undated bucket (its members have no comparable time).
  for (const group of groups) {
    if (group.hourStart === null) continue;
    group.signals.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  }
  return groups;
}
