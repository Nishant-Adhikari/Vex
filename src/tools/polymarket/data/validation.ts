/**
 * Runtime validators for Polymarket Data API responses (Zod rewrite).
 *
 * codex-002 Phase 2 (full uniformity): these gate the SHAPE of positions,
 * activity, trades, holders, leaderboard, and accounting responses at the HTTP
 * boundary before the values feed wallet/position views and bot decisions. The
 * Data API is LENIENT-DEFAULTING at the FIELD level — every field falls back to
 * a safe default (`""`, `0`, `null`, `false`, `[]`) rather than rejecting, so a
 * single malformed field never fails the whole response. The ROOT behaviour is
 * MIXED per validator and preserved exactly:
 *   - array-root list validators (positions, closed positions, activity, trades,
 *     holders, leaderboard, market positions) throw a plain `Error` with the
 *     ORIGINAL message when the root is not an array;
 *   - builder leaderboard / builder volume / open-interest map their element
 *     defaults and NEVER throw (a non-array root collapses to `[]`; per the
 *     original, open-interest still throws on a non-array root);
 *   - live-volume / value / traded NEVER throw and return their scalar default
 *     on a bad root.
 *
 * Numeric note (Zod 4 gotcha): the original `num()` accepts any
 * `typeof v === "number" && !Number.isNaN(v)` (INCLUDING ±Infinity) and the
 * loose `typeof x === "number" ? x : 0` fields ALSO accept NaN. `z.number()`
 * rejects ±Infinity, so it is NOT used here — `numDefault` (NaN-rejecting,
 * Infinity-accepting) and `numLoose` (accepts NaN too) reproduce the two exact
 * original guards.
 *
 * The schemas are intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each exported validator keeps
 * its declared return type so `tsc` verifies the inferred schema output is
 * assignable to that interface. Exported function names, signatures, and return
 * types are preserved so `client.ts` call sites stay unchanged.
 */

import { z } from "zod";
import { isRecord } from "../../../utils/validation-helpers.js";
import { zOptionalString } from "../../../utils/zod-validation-helpers.js";
import type {
  DataPosition, DataClosedPosition, DataActivity, DataTrade,
  DataHolder, DataMetaHolder, DataOpenInterest, DataLiveVolume,
  DataLeaderboardEntry, DataBuilderEntry, DataBuilderVolumeEntry,
  DataMarketPositionV1, DataMetaMarketPosition,
} from "./types.js";

// ── Lenient field primitives (mirror the hand-written guards exactly) ──
//
// `zOptStrNull` reproduces `asOptionalString(x) ?? null`: a non-empty string
// passes through, everything else becomes `null`.
const zOptStrNull = zOptionalString.transform((v) => v ?? null);

/** `str(v, def)`: `typeof v === "string" ? v : def` (accepts empty string). */
const strDefault = (def = "") =>
  z.unknown().transform((v) => (typeof v === "string" ? v : def));

/**
 * `num(v, def)`: `typeof v === "number" && !Number.isNaN(v) ? v : def`.
 * Accepts ±Infinity, rejects NaN — NOT `z.number()`.
 */
const numDefault = (def = 0) =>
  z.unknown().transform((v) => (typeof v === "number" && !Number.isNaN(v) ? v : def));

/**
 * Loose numeric guard `typeof x === "number" ? x : def` — used by the original
 * for `outcomeIndex`, `timestamp`, `activeUsers`, and `traded`. This ACCEPTS
 * NaN (no `Number.isNaN` check), so it must stay distinct from `numDefault`.
 */
const numLoose = (def = 0) =>
  z.unknown().transform((v) => (typeof v === "number" ? v : def));

/** `v === true` — only the literal boolean `true` is truthy. */
const isTrue = z.unknown().transform((v) => v === true);

/** `side === "BUY" || side === "SELL" ? side : null` (activity side). */
const activitySideSchema = z
  .unknown()
  .transform((v) => (v === "BUY" || v === "SELL" ? v : null));

/** `side === "SELL" ? "SELL" : "BUY"` (trade side). */
const tradeSideSchema = z.unknown().transform((v) => (v === "SELL" ? "SELL" : "BUY"));

// ── Positions ──────────────────────────────────────────────────────────

const positionSchema: z.ZodType<DataPosition> = z.object({
  proxyWallet: strDefault(),
  asset: strDefault(),
  conditionId: strDefault(),
  size: numDefault(),
  avgPrice: numDefault(),
  initialValue: numDefault(),
  currentValue: numDefault(),
  cashPnl: numDefault(),
  percentPnl: numDefault(),
  totalBought: numDefault(),
  realizedPnl: numDefault(),
  curPrice: numDefault(),
  redeemable: isTrue,
  mergeable: isTrue,
  title: zOptStrNull,
  slug: zOptStrNull,
  eventSlug: zOptStrNull,
  outcome: zOptStrNull,
  outcomeIndex: numLoose(),
  endDate: zOptStrNull,
  negativeRisk: isTrue,
});

export function validatePositionsResponse(raw: unknown): DataPosition[] {
  if (!Array.isArray(raw)) throw new Error("Expected positions array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("position must be an object");
    return positionSchema.parse(r);
  });
}

// ── Closed positions ────────────────────────────────────────────────────

const closedPositionSchema: z.ZodType<DataClosedPosition> = z.object({
  proxyWallet: strDefault(),
  asset: strDefault(),
  conditionId: strDefault(),
  avgPrice: numDefault(),
  totalBought: numDefault(),
  realizedPnl: numDefault(),
  curPrice: numDefault(),
  timestamp: numLoose(),
  title: zOptStrNull,
  slug: zOptStrNull,
  eventSlug: zOptStrNull,
  outcome: zOptStrNull,
  outcomeIndex: numLoose(),
  endDate: zOptStrNull,
});

export function validateClosedPositionsResponse(raw: unknown): DataClosedPosition[] {
  if (!Array.isArray(raw)) throw new Error("Expected closed positions array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("closed position must be an object");
    return closedPositionSchema.parse(r);
  });
}

// ── Activity ────────────────────────────────────────────────────────────

const activitySchema: z.ZodType<DataActivity> = z.object({
  proxyWallet: strDefault(),
  timestamp: numLoose(),
  conditionId: strDefault(),
  // Original: `str(r.type, "TRADE") as DataActivity["type"]` — any string passes
  // through (cast), missing/non-string -> "TRADE". Preserve the loose cast.
  type: z
    .unknown()
    .transform((v) => (typeof v === "string" ? v : "TRADE") as DataActivity["type"]),
  size: numDefault(),
  usdcSize: numDefault(),
  price: numDefault(),
  asset: strDefault(),
  side: activitySideSchema,
  outcomeIndex: numLoose(),
  title: zOptStrNull,
  slug: zOptStrNull,
  outcome: zOptStrNull,
  transactionHash: zOptStrNull,
});

export function validateActivityResponse(raw: unknown): DataActivity[] {
  if (!Array.isArray(raw)) throw new Error("Expected activity array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("activity must be an object");
    return activitySchema.parse(r);
  });
}

// ── Trades ──────────────────────────────────────────────────────────────

const tradeSchema: z.ZodType<DataTrade> = z.object({
  proxyWallet: strDefault(),
  side: tradeSideSchema,
  asset: strDefault(),
  conditionId: strDefault(),
  size: numDefault(),
  price: numDefault(),
  timestamp: numLoose(),
  title: zOptStrNull,
  slug: zOptStrNull,
  outcome: zOptStrNull,
  outcomeIndex: numLoose(),
  transactionHash: zOptStrNull,
  name: zOptStrNull,
  pseudonym: zOptStrNull,
  profileImage: zOptStrNull,
});

export function validateTradesResponse(raw: unknown): DataTrade[] {
  if (!Array.isArray(raw)) throw new Error("Expected trades array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("trade must be an object");
    return tradeSchema.parse(r);
  });
}

// ── Holders ─────────────────────────────────────────────────────────────

// Default for a non-record holder element (matches the original's inline default).
const holderDefault: DataHolder = {
  proxyWallet: "", bio: null, asset: "", pseudonym: null, amount: 0,
  displayUsernamePublic: false, outcomeIndex: 0, name: null, profileImage: null,
};

const holderSchema: z.ZodType<DataHolder> = z.object({
  proxyWallet: strDefault(),
  bio: zOptStrNull,
  asset: strDefault(),
  pseudonym: zOptStrNull,
  amount: numDefault(),
  displayUsernamePublic: isTrue,
  outcomeIndex: numLoose(),
  name: zOptStrNull,
  profileImage: zOptStrNull,
});

const metaHolderSchema: z.ZodType<DataMetaHolder> = z.object({
  token: strDefault(),
  // Non-array -> []; array -> element-mapped: non-record element -> holderDefault.
  holders: z.unknown().transform((v) =>
    Array.isArray(v) ? v.map((h) => (isRecord(h) ? holderSchema.parse(h) : holderDefault)) : [],
  ),
});

export function validateHoldersResponse(raw: unknown): DataMetaHolder[] {
  if (!Array.isArray(raw)) throw new Error("Expected holders array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("meta holder must be an object");
    return metaHolderSchema.parse(r);
  });
}

// ── Open interest (throws on non-array root; per-element default) ───────

const openInterestDefault: DataOpenInterest = { market: "", value: 0 };
const openInterestSchema: z.ZodType<DataOpenInterest> = z.object({
  market: strDefault(),
  value: numDefault(),
});

export function validateOpenInterestResponse(raw: unknown): DataOpenInterest[] {
  if (!Array.isArray(raw)) throw new Error("Expected OI array");
  return raw.map((r) => (isRecord(r) ? openInterestSchema.parse(r) : openInterestDefault));
}

// ── Live volume (never throws; default on bad root/first element) ───────

const liveVolumeMarketSchema = z.object({
  market: strDefault(),
  value: numDefault(),
});

export function validateLiveVolumeResponse(raw: unknown): DataLiveVolume {
  if (!Array.isArray(raw) || !isRecord(raw[0])) return { total: 0, markets: [] };
  const r = raw[0];
  return {
    total: numDefault().parse(r.total),
    markets: Array.isArray(r.markets)
      ? r.markets.map((m) => (isRecord(m) ? liveVolumeMarketSchema.parse(m) : { market: "", value: 0 }))
      : [],
  };
}

// ── Leaderboard (throws on non-array root) ──────────────────────────────

const leaderboardEntrySchema: z.ZodType<DataLeaderboardEntry> = z.object({
  rank: strDefault(),
  proxyWallet: strDefault(),
  userName: zOptStrNull,
  vol: numDefault(),
  pnl: numDefault(),
  profileImage: zOptStrNull,
  xUsername: zOptStrNull,
  verifiedBadge: isTrue,
});

export function validateLeaderboardResponse(raw: unknown): DataLeaderboardEntry[] {
  if (!Array.isArray(raw)) throw new Error("Expected leaderboard array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("leaderboard entry must be an object");
    return leaderboardEntrySchema.parse(r);
  });
}

// ── Builder leaderboard (never throws; [] on bad root) ──────────────────

const builderEntryDefault: DataBuilderEntry = {
  rank: "", builder: "", volume: 0, activeUsers: 0, verified: false, builderLogo: null,
};
const builderEntrySchema: z.ZodType<DataBuilderEntry> = z.object({
  rank: strDefault(),
  builder: strDefault(),
  volume: numDefault(),
  activeUsers: numLoose(),
  verified: isTrue,
  builderLogo: zOptStrNull,
});

export function validateBuilderLeaderboardResponse(raw: unknown): DataBuilderEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => (isRecord(r) ? builderEntrySchema.parse(r) : builderEntryDefault));
}

// ── Builder volume (never throws; [] on bad root) ──────────────────────

const builderVolumeDefault: DataBuilderVolumeEntry = {
  dt: "", builder: "", builderLogo: null, verified: false, volume: 0, activeUsers: 0, rank: "",
};
const builderVolumeSchema: z.ZodType<DataBuilderVolumeEntry> = z.object({
  dt: strDefault(),
  builder: strDefault(),
  builderLogo: zOptStrNull,
  verified: isTrue,
  volume: numDefault(),
  activeUsers: numLoose(),
  rank: strDefault(),
});

export function validateBuilderVolumeResponse(raw: unknown): DataBuilderVolumeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => (isRecord(r) ? builderVolumeSchema.parse(r) : builderVolumeDefault));
}

// ── Value / traded scalars (never throw) ────────────────────────────────

export function validateValueResponse(raw: unknown): { user: string; value: number } {
  if (Array.isArray(raw) && isRecord(raw[0])) {
    return { user: strDefault().parse(raw[0].user), value: numDefault().parse(raw[0].value) };
  }
  if (isRecord(raw)) return { user: strDefault().parse(raw.user), value: numDefault().parse(raw.value) };
  return { user: "", value: 0 };
}

export function validateTradedResponse(raw: unknown): { user: string; traded: number } {
  if (isRecord(raw)) return { user: strDefault().parse(raw.user), traded: numLoose().parse(raw.traded) };
  return { user: "", traded: 0 };
}

// ── Market positions (throws on non-array root; per-element default) ────

const marketPositionDefault: DataMarketPositionV1 = {
  proxyWallet: "", name: null, profileImage: null, verified: false, asset: "", conditionId: "",
  avgPrice: 0, size: 0, currPrice: 0, currentValue: 0, cashPnl: 0, totalBought: 0,
  realizedPnl: 0, totalPnl: 0, outcome: null, outcomeIndex: 0,
};
const marketPositionSchema: z.ZodType<DataMarketPositionV1> = z.object({
  proxyWallet: strDefault(),
  name: zOptStrNull,
  profileImage: zOptStrNull,
  verified: isTrue,
  asset: strDefault(),
  conditionId: strDefault(),
  avgPrice: numDefault(),
  size: numDefault(),
  currPrice: numDefault(),
  currentValue: numDefault(),
  cashPnl: numDefault(),
  totalBought: numDefault(),
  realizedPnl: numDefault(),
  totalPnl: numDefault(),
  outcome: zOptStrNull,
  outcomeIndex: numLoose(),
});

const metaMarketPositionDefault: DataMetaMarketPosition = { token: "", positions: [] };
const metaMarketPositionSchema: z.ZodType<DataMetaMarketPosition> = z.object({
  token: strDefault(),
  positions: z.unknown().transform((v) =>
    Array.isArray(v) ? v.map((p) => (isRecord(p) ? marketPositionSchema.parse(p) : marketPositionDefault)) : [],
  ),
});

export function validateMarketPositionsResponse(raw: unknown): DataMetaMarketPosition[] {
  if (!Array.isArray(raw)) throw new Error("Expected market positions array");
  return raw.map((r) => (isRecord(r) ? metaMarketPositionSchema.parse(r) : metaMarketPositionDefault));
}
