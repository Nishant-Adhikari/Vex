/**
 * Solana/Jupiter token concise projector (P0-3c).
 *
 * Jupiter's Tokens API V2 returns a ~40-field `JupiterMintInformation` per token
 * (icon/social URLs, raw mint/freeze authority pubkeys, an open passthrough bag,
 * and four verbose per-interval stat blocks). On `solana.tokens.search` /
 * `solana.tokens.trending` (default limit 20) that routinely blows the 16 KiB
 * overflow threshold for fields a trading agent never acts on.
 *
 * This pure projector strips that noise at the handler seam — BEFORE `ok()` — so
 * the model sees a lean, decision-relevant row: identity, price/market-cap/
 * liquidity, holder + organic-trading signals, the safety audit flags the agent
 * uses, tags/launchpad, age, and a concise per-interval stats subset.
 *
 * Default-concise with NO verbosity knob: there is no agent use case for the
 * dropped social URLs or raw provider sub-objects (the icon is re-surfaced as a
 * single bounded `logoUrl` the renderer can display). (Both wiring tools are
 * `mutating:false` / `actionKind:"read"` with no `_tradeCapture`, so projecting
 * the `ok()` arg — which trims both the output string and the unused `data` — is
 * safe; see CC-3 / P0-3 in the tool-output eval.)
 *
 * Every field read is defensive: the shape comes from an external API, so missing
 * / null fields are normalised rather than assumed present.
 */

import type {
  JupiterMintInformation,
  JupiterTokenSwapStats,
} from "@tools/solana-ecosystem/jupiter/jupiter-tokens/types.js";

// ── Concise output shapes ────────────────────────────────────────

/**
 * Concise per-interval swap stats — the price/volume/flow signals a trading
 * agent acts on, lifted from a verbose `JupiterTokenSwapStats` block. Every
 * field is `number | null` because Jupiter may omit or null any of them.
 */
export interface ConciseJupiterTokenStats {
  priceChange: number | null;
  volumeChange: number | null;
  holderChange: number | null;
  liquidityChange: number | null;
  buyVolume: number | null;
  sellVolume: number | null;
  numBuys: number | null;
  numSells: number | null;
  numTraders: number | null;
}

/** Concise per-token safety audit — the flags the agent uses for safety. */
export interface ConciseJupiterTokenAudit {
  isSus: boolean | null;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  topHoldersPercentage: number | null;
  devBalancePercentage: number | null;
}

/**
 * Concise Jupiter token row. Keeps identity, market signals, organic/trending
 * signals, the safety audit, tags/launchpad, age, and a single bounded
 * `logoUrl` (from `icon`); drops social URLs, raw authority pubkeys, the open
 * passthrough bag, APY, and raw provider sub-objects (`firstPool`, full stat
 * blocks).
 */
export interface ConciseJupiterToken {
  /** Mint address (Jupiter `id`). */
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  usdPrice: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidity: number | null;
  circSupply: number | null;
  totalSupply: number | null;
  holderCount: number | null;
  organicScore: number | null;
  organicScoreLabel: string | null;
  isVerified: boolean | null;
  /** Bounded, https-only token logo URL (from `icon`); `null` when unsafe/absent. */
  logoUrl: string | null;
  tags: string[] | null;
  launchpad: string | null;
  createdAt: string | null;
  audit: ConciseJupiterTokenAudit | null;
  stats5m: ConciseJupiterTokenStats | null;
  stats1h: ConciseJupiterTokenStats | null;
  stats6h: ConciseJupiterTokenStats | null;
  stats24h: ConciseJupiterTokenStats | null;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Normalise an optional/nullable number off an external shape to `number | null`. */
function numOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" ? value : null;
}

/** Normalise an optional/nullable boolean off an external shape to `boolean | null`. */
function boolOrNull(value: boolean | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Max length of a surfaced logo URL — bounds the field against an oversized icon. */
const MAX_LOGO_URL_LEN = 512;

/**
 * Normalise Jupiter's `icon` to a bounded, https-only logo URL the renderer can
 * safely display. Returns `null` when the value is absent, non-https, carries a
 * control char, or exceeds the length cap.
 *
 * The logic is duplicated (not imported from the renderer's `safeImgSrc`) on
 * purpose: the engine and the untrusted renderer must not share a helper across
 * the process boundary. The renderer re-validates every src independently, so
 * this is a bounding/normalisation step, not the trust gate.
 */
function normalizeLogoUrl(icon: string | null | undefined): string | null {
  if (typeof icon !== "string") return null;
  const trimmed = icon.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LOGO_URL_LEN) return null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return null; // control chars
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Project one verbose swap-stats block to its concise signal subset. Returns
 * `null` when the source block is absent so an empty interval is an absent
 * block, not a row of nulls.
 */
function projectStats(
  stats: JupiterTokenSwapStats | null | undefined,
): ConciseJupiterTokenStats | null {
  if (stats == null) return null;
  return {
    priceChange: numOrNull(stats.priceChange),
    volumeChange: numOrNull(stats.volumeChange),
    holderChange: numOrNull(stats.holderChange),
    liquidityChange: numOrNull(stats.liquidityChange),
    buyVolume: numOrNull(stats.buyVolume),
    sellVolume: numOrNull(stats.sellVolume),
    numBuys: numOrNull(stats.numBuys),
    numSells: numOrNull(stats.numSells),
    numTraders: numOrNull(stats.numTraders),
  };
}

/**
 * Project the per-token audit block to the safety flags the agent uses. Returns
 * `null` when Jupiter provided no audit so absence stays absent.
 */
function projectAudit(
  audit: JupiterMintInformation["audit"],
): ConciseJupiterTokenAudit | null {
  if (audit == null) return null;
  return {
    isSus: boolOrNull(audit.isSus),
    mintAuthorityDisabled: boolOrNull(audit.mintAuthorityDisabled),
    freezeAuthorityDisabled: boolOrNull(audit.freezeAuthorityDisabled),
    topHoldersPercentage: numOrNull(audit.topHoldersPercentage),
    devBalancePercentage: numOrNull(audit.devBalancePercentage),
  };
}

// ── Projector ────────────────────────────────────────────────────

/**
 * Project a raw `JupiterMintInformation` to a concise, decision-relevant row.
 *
 * KEEP: mint/symbol/name/decimals, usdPrice, marketCap (`mcap`)/fdv, liquidity,
 * circ/total supply, holderCount, organicScore (+ label), isVerified, a bounded
 * https-only `logoUrl` (from `icon`), the audit safety flags, tags, launchpad,
 * createdAt, and a concise per-interval stats subset.
 *
 * DROP: twitter/telegram/website/discord/instagram/tiktok/otherUrl, dev,
 * raw mintAuthority/freezeAuthority pubkeys (the disabled-booleans carry the
 * signal), tokenProgram, partnerConfig, graduatedPool/graduatedAt, priceBlockId,
 * apy, the raw `firstPool` sub-object, the full stat blocks, updatedAt, and the
 * open `[key: string]: unknown` passthrough bag.
 */
export function projectJupiterToken(token: JupiterMintInformation): ConciseJupiterToken {
  return {
    mint: token.id,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    usdPrice: numOrNull(token.usdPrice),
    marketCap: numOrNull(token.mcap),
    fdv: numOrNull(token.fdv),
    liquidity: numOrNull(token.liquidity),
    circSupply: numOrNull(token.circSupply),
    totalSupply: numOrNull(token.totalSupply),
    holderCount: numOrNull(token.holderCount),
    organicScore: numOrNull(token.organicScore),
    organicScoreLabel: typeof token.organicScoreLabel === "string" ? token.organicScoreLabel : null,
    isVerified: boolOrNull(token.isVerified),
    logoUrl: normalizeLogoUrl(token.icon),
    tags: Array.isArray(token.tags) ? token.tags : null,
    launchpad: typeof token.launchpad === "string" ? token.launchpad : null,
    createdAt: typeof token.createdAt === "string" ? token.createdAt : null,
    audit: projectAudit(token.audit),
    stats5m: projectStats(token.stats5m),
    stats1h: projectStats(token.stats1h),
    stats6h: projectStats(token.stats6h),
    stats24h: projectStats(token.stats24h),
  };
}

/** Project an array of raw tokens defensively (tolerates a non-array input). */
export function projectJupiterTokens(
  tokens: readonly JupiterMintInformation[] | null | undefined,
): ConciseJupiterToken[] {
  return (Array.isArray(tokens) ? tokens : []).map(projectJupiterToken);
}
