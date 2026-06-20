/**
 * Polymarket Data API concise projectors (P0-5).
 *
 * The Data API returns image/bio/logo URLs that carry no signal for the agent
 * but inflate tool output (often past the 16 KiB overflow threshold). These
 * pure projectors strip that noise at the handler seam — BEFORE `ok()` — so the
 * model sees a lean, attribution-preserving row.
 *
 * Default-concise with NO verbosity knob for v1: there is no agent use case for
 * `profileImage` / `builderLogo` / `bio` URLs. (Polymarket-data tools are
 * `mutating:false` with no `_tradeCapture`, so projecting the `ok()` arg — which
 * trims both the output string and the unused `data` — is safe; see plan §6.)
 *
 * Each projector is `Input → Concise` with an explicit return type. Nested
 * `holders` / `marketPositions` map their inner row arrays defensively.
 */

import type {
  DataTrade,
  DataHolder,
  DataMetaHolder,
  DataLeaderboardEntry,
  DataBuilderEntry,
  DataBuilderVolumeEntry,
  DataMarketPositionV1,
  DataMetaMarketPosition,
} from "@tools/polymarket/data/types.js";

// ── Concise output shapes ────────────────────────────────────────

/** Concise trade row — drops `profileImage`, keeps `name` for attribution. */
export interface ConciseTrade {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string | null;
  slug: string | null;
  outcome: string | null;
  outcomeIndex: number;
  transactionHash: string | null;
  name: string | null;
  pseudonym: string | null;
}

/** Concise holder row — drops `bio` and `profileImage`. */
export interface ConciseHolder {
  proxyWallet: string;
  asset: string;
  pseudonym: string | null;
  amount: number;
  displayUsernamePublic: boolean;
  outcomeIndex: number;
  name: string | null;
}

/** Concise holder group — nested `holders[]` projected. */
export interface ConciseHolderGroup {
  token: string;
  holders: ConciseHolder[];
}

/** Concise leaderboard entry — drops `profileImage`, keeps `verifiedBadge`. */
export interface ConciseLeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string | null;
  vol: number;
  pnl: number;
  xUsername: string | null;
  verifiedBadge: boolean;
}

/** Concise builder entry — drops `builderLogo`. */
export interface ConciseBuilderEntry {
  rank: string;
  builder: string;
  volume: number;
  activeUsers: number;
  verified: boolean;
}

/** Concise builder-volume entry — drops `builderLogo`. */
export interface ConciseBuilderVolumeEntry {
  dt: string;
  builder: string;
  verified: boolean;
  volume: number;
  activeUsers: number;
  rank: string;
}

/** Concise market-position row — drops `profileImage`. */
export interface ConciseMarketPosition {
  proxyWallet: string;
  name: string | null;
  verified: boolean;
  asset: string;
  conditionId: string;
  avgPrice: number;
  size: number;
  currPrice: number;
  currentValue: number;
  cashPnl: number;
  totalBought: number;
  realizedPnl: number;
  totalPnl: number;
  outcome: string | null;
  outcomeIndex: number;
}

/** Concise market-position group — nested `positions[]` projected. */
export interface ConciseMarketPositionGroup {
  token: string;
  positions: ConciseMarketPosition[];
}

// ── Projectors ───────────────────────────────────────────────────

/** Strip `profileImage` from a Data API trade row. */
export function projectTrade(t: DataTrade): ConciseTrade {
  return {
    proxyWallet: t.proxyWallet,
    side: t.side,
    asset: t.asset,
    conditionId: t.conditionId,
    size: t.size,
    price: t.price,
    timestamp: t.timestamp,
    title: t.title,
    slug: t.slug,
    outcome: t.outcome,
    outcomeIndex: t.outcomeIndex,
    transactionHash: t.transactionHash,
    name: t.name,
    pseudonym: t.pseudonym,
  };
}

/** Strip `bio` + `profileImage` from a single holder row. */
function projectHolder(h: DataHolder): ConciseHolder {
  return {
    proxyWallet: h.proxyWallet,
    asset: h.asset,
    pseudonym: h.pseudonym,
    amount: h.amount,
    displayUsernamePublic: h.displayUsernamePublic,
    outcomeIndex: h.outcomeIndex,
    name: h.name,
  };
}

/** Project a holder group, mapping its nested `holders[]` defensively. */
export function projectHolderGroup(g: DataMetaHolder): ConciseHolderGroup {
  return {
    token: g.token,
    holders: (Array.isArray(g.holders) ? g.holders : []).map(projectHolder),
  };
}

/** Strip `profileImage` from a leaderboard entry. */
export function projectLeaderboardEntry(e: DataLeaderboardEntry): ConciseLeaderboardEntry {
  return {
    rank: e.rank,
    proxyWallet: e.proxyWallet,
    userName: e.userName,
    vol: e.vol,
    pnl: e.pnl,
    xUsername: e.xUsername,
    verifiedBadge: e.verifiedBadge,
  };
}

/** Strip `builderLogo` from a builder-leaderboard entry. */
export function projectBuilderEntry(e: DataBuilderEntry): ConciseBuilderEntry {
  return {
    rank: e.rank,
    builder: e.builder,
    volume: e.volume,
    activeUsers: e.activeUsers,
    verified: e.verified,
  };
}

/** Strip `builderLogo` from a builder-volume entry. */
export function projectBuilderVolumeEntry(e: DataBuilderVolumeEntry): ConciseBuilderVolumeEntry {
  return {
    dt: e.dt,
    builder: e.builder,
    verified: e.verified,
    volume: e.volume,
    activeUsers: e.activeUsers,
    rank: e.rank,
  };
}

/** Strip `profileImage` from a single market-position row. */
function projectMarketPosition(p: DataMarketPositionV1): ConciseMarketPosition {
  return {
    proxyWallet: p.proxyWallet,
    name: p.name,
    verified: p.verified,
    asset: p.asset,
    conditionId: p.conditionId,
    avgPrice: p.avgPrice,
    size: p.size,
    currPrice: p.currPrice,
    currentValue: p.currentValue,
    cashPnl: p.cashPnl,
    totalBought: p.totalBought,
    realizedPnl: p.realizedPnl,
    totalPnl: p.totalPnl,
    outcome: p.outcome,
    outcomeIndex: p.outcomeIndex,
  };
}

/** Project a market-position group, mapping its nested `positions[]` defensively. */
export function projectMarketPositionGroup(g: DataMetaMarketPosition): ConciseMarketPositionGroup {
  return {
    token: g.token,
    positions: (Array.isArray(g.positions) ? g.positions : []).map(projectMarketPosition),
  };
}
