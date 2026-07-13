/**
 * Pure derivations for the mission-result Decision Journal.
 *
 * The journal answers "why did the agent buy and sell?" by anchoring each
 * executed trade (a `proj_activity` move) to the assistant reasoning turn that
 * immediately preceded it, then distilling that prose into a one-line rationale
 * (the full text stays available behind a disclosure). Everything here is pure
 * and unit-tested so `MissionSummaryCard.tsx` stays a thin map over already-
 * derived values.
 *
 * SOURCING / MAPPING (and its limits):
 *   - Trades come from the same `portfolio.listMoves` feed the MOVES block reads
 *     (`MoveItem`), scoped to this mission's run window `[startedAt, endedAt]`.
 *   - Reasoning comes from the session `messages` feed (assistant text turns).
 *   - A trade is mapped to the LAST assistant turn whose `createdAt` is at or
 *     before the trade's `createdAt` (the decision that led to the fill). This
 *     is a timestamp heuristic — it can mis-attribute when a single reasoning
 *     turn triggers a batch of fills (they all share that one rationale) or when
 *     the engine records a fill before persisting its reasoning turn (then the
 *     trade shows the prior turn, or none). It never fabricates: a trade with no
 *     preceding reasoning carries `rationaleFull: null`.
 *
 * BAGS-HELD (mission-scoped): `countMissionBagsHeld` counts tokens BOUGHT within
 * the run window that were not subsequently SOLD within it — so a mission that
 * bought 3 tokens and sold all 3 reads 0, ignoring the wallet's pre-existing
 * legacy holdings that the ledger's `openPositionsCount` over-counts. Limit: it
 * keys on the raw traded-token identity and ignores partial-exit quantities (a
 * token half-sold still counts as closed), which is the pragmatic correct call
 * without cost-basis attribution the renderer does not have.
 */

import { truncateAddress } from "../../lib/format.js";

/** Base / native / quote units — never the "traded" side of a swap leg. */
const UNIT_SYMBOLS: ReadonlySet<string> = new Set([
  "ETH",
  "WETH",
  "SOL",
  "USDC",
  "USDT",
]);

/** Wrapped-native EVM addresses → treated as the ETH unit (mirrors MovesBlock). */
const KNOWN_UNIT_ADDRESSES: ReadonlySet<string> = new Set([
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  "0x4200000000000000000000000000000000000006",
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  "so11111111111111111111111111111111111111112",
  "epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v",
  "es9vmfrzacermjfrf4h2fyd4kconky11mcce8benwnyb",
]);

const ADDRESS_LIKE = /^[0-9a-zA-Z]{13,}$/;

/** Max characters for the distilled one-liner before it is ellipsised. */
export const RATIONALE_MAX_CHARS = 110;

/** Minimal move shape the journal reads (a structural subset of `MoveItem`). */
export interface JournalMove {
  readonly id: string;
  readonly tradeSide: string | null;
  readonly inputToken: string | null;
  readonly outputToken: string | null;
  readonly createdAt: string;
}

/** Minimal message shape the journal reads (a structural subset of the DTO). */
export interface JournalMessage {
  readonly id: number;
  readonly role: string;
  readonly kind: string;
  readonly content: string;
  readonly createdAt: string;
}

/** An assistant reasoning turn, normalised + time-sortable. */
export interface ReasoningTurn {
  readonly id: number;
  readonly content: string;
  readonly at: number;
}

export type JournalSide = "buy" | "sell" | "swap" | "other";

/** One chronological journal entry, anchored to a trade. */
export interface JournalEntry {
  /** Stable key — the move id. */
  readonly key: string;
  readonly side: JournalSide;
  /** Uppercase chip label (BUY / SELL / SWAP / …). */
  readonly sideLabel: string;
  /** Display label for the traded token (`VENA`, `So1111…1112`, or `—`). */
  readonly token: string;
  /** Full traded-token value for a tooltip when `token` is lossy, else null. */
  readonly tokenFull: string | null;
  readonly createdAt: string;
  /** Untouched assistant prose revealed on expand; null when none preceded. */
  readonly rationaleFull: string | null;
  /** Distilled one-liner; null when there is no reasoning to distil. */
  readonly rationaleLine: string | null;
}

function toMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * True when a trade's `createdAt` falls within the mission run window. The lower
 * bound is `startedAt`; the upper bound is `endedAt` when known (null → open,
 * i.e. no upper bound). Unparseable move timestamps are excluded (never throw).
 */
export function isWithinRun(
  moveCreatedAt: string,
  startedAt: string,
  endedAt: string | null,
): boolean {
  const t = toMs(moveCreatedAt);
  if (Number.isNaN(t)) return false;
  const start = toMs(startedAt);
  if (!Number.isNaN(start) && t < start) return false;
  if (endedAt !== null) {
    const end = toMs(endedAt);
    if (!Number.isNaN(end) && t > end) return false;
  }
  return true;
}

/**
 * The traded token of a move — the non-unit leg. A BUY spends a unit (ETH) to
 * acquire the traded `outputToken`; a SELL disposes the traded `inputToken` for
 * a unit. Returns the raw token string, or `null` when the relevant leg is
 * missing or is itself a unit (nothing to attribute a bag to).
 */
export function tradedToken(move: JournalMove): string | null {
  const side = move.tradeSide?.toLowerCase() ?? "";
  const raw = side === "sell" ? move.inputToken : move.outputToken;
  if (raw === null || raw.trim().length === 0) return null;
  const norm = raw.trim();
  if (UNIT_SYMBOLS.has(norm.toUpperCase())) return null;
  if (KNOWN_UNIT_ADDRESSES.has(norm.toLowerCase())) return null;
  return norm;
}

interface TokenLabel {
  readonly text: string;
  readonly full: string | null;
}

/** Display form for a traded token: address-like → truncated, else uppercase. */
function tokenLabel(raw: string | null): TokenLabel {
  if (raw === null) return { text: "—", full: null };
  if (ADDRESS_LIKE.test(raw)) return { text: truncateAddress(raw), full: raw };
  return { text: raw.toUpperCase(), full: null };
}

function sideOf(move: JournalMove): { side: JournalSide; label: string } {
  const s = move.tradeSide?.toLowerCase() ?? "";
  if (s === "buy") return { side: "buy", label: "BUY" };
  if (s === "sell") return { side: "sell", label: "SELL" };
  if (s.length === 0) return { side: "swap", label: "SWAP" };
  return { side: "other", label: s.toUpperCase() };
}

/**
 * Select assistant reasoning turns (plain prose + stopped turns), dropping empty
 * content, sorted oldest→newest (id breaks `createdAt` ties). Rows with
 * unparseable timestamps are dropped so the mapping stays total.
 */
export function selectReasoningTurns(
  messages: readonly JournalMessage[],
): ReasoningTurn[] {
  const turns: ReasoningTurn[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (m.kind !== "text" && m.kind !== "assistant_stopped") continue;
    if (m.content.trim().length === 0) continue;
    const at = toMs(m.createdAt);
    if (Number.isNaN(at)) continue;
    turns.push({ id: m.id, content: m.content, at });
  }
  turns.sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id - b.id));
  return turns;
}

/**
 * Last reasoning turn at or before `tradeAt`. Assumes `turns` is sorted
 * ascending by `at` (as `selectReasoningTurns` returns). Linear scan — the per-
 * mission volume is small. Returns null when no turn precedes the trade.
 */
function reasoningBefore(
  turns: readonly ReasoningTurn[],
  tradeAt: number,
): ReasoningTurn | null {
  let match: ReasoningTurn | null = null;
  for (const turn of turns) {
    if (turn.at <= tradeAt) match = turn;
    else break;
  }
  return match;
}

/**
 * Build the chronological, trade-anchored journal. Trades are scoped to the run
 * window and sorted oldest→newest; each is mapped to the assistant turn that
 * immediately preceded it, whose prose is distilled into the one-liner.
 */
export function buildJournal(
  moves: readonly JournalMove[],
  messages: readonly JournalMessage[],
  startedAt: string,
  endedAt: string | null,
): JournalEntry[] {
  const turns = selectReasoningTurns(messages);
  const scoped = moves
    .filter((m) => isWithinRun(m.createdAt, startedAt, endedAt))
    .slice()
    .sort((a, b) => {
      const da = toMs(a.createdAt);
      const db = toMs(b.createdAt);
      if (da !== db) return da - db;
      return a.id.localeCompare(b.id);
    });

  return scoped.map((move) => {
    const { side, label } = sideOf(move);
    const token = tokenLabel(tradedToken(move));
    const turn = reasoningBefore(turns, toMs(move.createdAt));
    return {
      key: move.id,
      side,
      sideLabel: label,
      token: token.text,
      tokenFull: token.full,
      createdAt: move.createdAt,
      rationaleFull: turn?.content ?? null,
      rationaleLine: turn !== null ? distillRationale(turn.content) : null,
    };
  });
}

/**
 * Count mission-scoped bags still held: tokens BOUGHT within the run window that
 * were not SOLD within it. Ignores the wallet's pre-existing legacy holdings the
 * ledger `openPositionsCount` conflates. Keyed on the lowercased raw traded
 * token; partial exits are treated as full (see module note). Never throws.
 */
export function countMissionBagsHeld(
  moves: readonly JournalMove[],
  startedAt: string,
  endedAt: string | null,
): number {
  const bought = new Set<string>();
  const sold = new Set<string>();
  for (const move of moves) {
    if (!isWithinRun(move.createdAt, startedAt, endedAt)) continue;
    const token = tradedToken(move);
    if (token === null) continue;
    const key = token.toLowerCase();
    const side = move.tradeSide?.toLowerCase() ?? "";
    if (side === "sell") sold.add(key);
    else if (side === "buy") bought.add(key);
  }
  let held = 0;
  for (const key of bought) if (!sold.has(key)) held += 1;
  return held;
}

// Emoji / pictographs / dingbats / arrows / warning glyphs, incl. VS16 + ZWJ.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

/**
 * Distil a raw assistant message into a single glanceable line: strip markdown
 * structure (fences, inline code, headers, blockquotes, list markers, emphasis,
 * links) and emoji/warning glyphs, collapse whitespace, take the first
 * meaningful sentence, and truncate to ~110 chars on a word boundary with an
 * ellipsis. Pure — the expansion always shows the untouched original text.
 */
export function distillRationale(text: string): string {
  if (text.length === 0) return "";
  // Drop fenced code blocks entirely; keep inline-code contents.
  let s = text.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1");
  // Split into body vs. section-header lines: a header ("## Decision") is a
  // label, not prose, so we prefer the body — falling back to headers only when
  // there is no body text at all (nothing fabricated, nothing lost).
  const body: string[] = [];
  const headers: string[] = [];
  for (const rawLine of s.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line.length === 0) continue;
    if (/^#{1,6}\s/.test(line)) {
      headers.push(line.replace(/^#{1,6}\s*/, ""));
      continue;
    }
    line = line.replace(/^>\s?/, ""); // blockquote
    line = line.replace(/^[-*+]\s+/, ""); // unordered list
    line = line.replace(/^\d+[.)]\s+/, ""); // ordered list
    if (line.length > 0) body.push(line);
  }
  s = (body.length > 0 ? body : headers).join(" ");
  // Links → their text; strip emphasis markers; strip emoji; collapse space.
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\*\*|__|[*_]/g, "");
  s = s.replace(EMOJI, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length === 0) return "";
  // First sentence — up to the first terminal punctuation followed by space/end.
  const match = s.match(/^.*?[.!?](?=\s|$)/);
  let sentence = (match?.[0] ?? s).trim();
  // A too-short lead (e.g. a bare "OK.") is unhelpful — fall back to more text.
  if (sentence.length < 16 && s.length > sentence.length) sentence = s;
  return truncate(sentence, RATIONALE_MAX_CHARS);
}

/** Truncate to `max` chars on a word boundary, appending an ellipsis. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${head.replace(/[.,;:!?\s]+$/, "")}…`;
}
