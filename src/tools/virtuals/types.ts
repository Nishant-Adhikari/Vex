/**
 * Virtuals Protocol API type definitions (domain shapes).
 *
 * The Virtuals API (https://api.virtuals.io) is an UNAUTHENTICATED, UNDOCUMENTED
 * Strapi backend. Its per-agent payload carries ~90 fields and can drift without
 * notice, so these are NOT wire types — they are the NORMALIZED, tolerant domain
 * shapes produced by `validation.ts` from the raw payload. Every consumer field
 * is defensively typed (`| null`) because the source is untrusted external data.
 *
 * Free-text fields (`description`, `overview`, `tokenUtility`, tokenomics entry
 * names, socials) are prompt-injection surface. They are carried here RAW for
 * the protocol projector to bound + sanitize (or omit) — they MUST NOT reach the
 * model without passing through `sanitizeForSystemPrompt` + a length cap.
 */

// ── Chain enum (server-side filter values — EXACTLY these four) ─────

export const VIRTUALS_CHAINS = ["BASE", "SOLANA", "ROBINHOOD", "ETH"] as const;
export type VirtualsChain = (typeof VIRTUALS_CHAINS)[number];

// ── Sub-shapes ─────────────────────────────────────────────────────

/** launchInfo subset — antiSniperTaxType drives the graduation buy-tax window. */
export interface VirtualsLaunchInfo {
  launchMode: number | null;
  /** 0 = none, 1 = 60s linear window (default), 2 = 5880s linear window. */
  antiSniperTaxType: number | null;
  airdropPercent: number | null;
}

/** One verified social handle (impersonation-resistant "VERIFIED_*" only). */
export interface VirtualsSocial {
  platform: string;
  handle: string;
  url: string | null;
}

/** One tokenomics vesting allocation (names are free-text → sanitized in projector). */
export interface VirtualsTokenomicsEntry {
  name: string | null;
  amount: number | null;
  isLocked: boolean | null;
}

export interface VirtualsTokenomicsStatus {
  hasUnlocked: boolean | null;
  daysFromFirstUnlock: number | null;
}

// ── Normalized agent (list + detail share this shape) ──────────────

export interface VirtualsAgent {
  id: number | null;
  /** RAW free-text — sanitize + bound before surfacing to the model. */
  name: string | null;
  symbol: string | null;
  chain: string | null;
  /** UNDERGRAD (bonding curve) | AVAILABLE (graduated). */
  status: string | null;
  /** BONDING_V5 | BONDING | OLD | null. */
  factory: string | null;
  category: string | null;

  // Addresses — graduated agents populate tokenAddress + lpAddress + lpCreatedAt.
  tokenAddress: string | null;
  preToken: string | null;
  migrateTokenAddress: string | null;
  lpAddress: string | null;
  lpCreatedAt: string | null;
  createdAt: string | null;

  // Market metrics (mcap/fdv denominated in VIRTUAL, not USD).
  mcapInVirtual: number | null;
  fdvInVirtual: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  priceChangePercent24h: number | null;
  holderCount: number | null;
  top10HolderPercentage: number | null;
  totalSupply: number | null;

  /** Anti-impersonation badge — NOT a safety/quality gate. */
  isVerified: boolean;

  launchInfo: VirtualsLaunchInfo | null;
  socials: VirtualsSocial[];

  // Detail-only free-text — carried RAW for the projector to bound + sanitize.
  description: string | null;
  overview: string | null;
  tokenUtility: string | null;
  tokenomics: VirtualsTokenomicsEntry[];
  tokenomicsStatus: VirtualsTokenomicsStatus | null;
}

// ── Pagination + list result ───────────────────────────────────────

export interface VirtualsPagination {
  page: number | null;
  pageSize: number | null;
  pageCount: number | null;
  total: number | null;
}

export interface VirtualsListResult {
  agents: VirtualsAgent[];
  pagination: VirtualsPagination | null;
}

// ── Genesis (Base launch calendar) ─────────────────────────────────

export interface VirtualsGenesis {
  id: number | null;
  genesisId: string | null;
  status: string | null;
  startsAt: string | null;
  endsAt: string | null;
  totalParticipants: number | null;
  totalVirtuals: number | null;
  /** Nested agent metadata (partial — top-level chain/name live here). */
  agent: VirtualsAgent | null;
}

export interface VirtualsGenesesResult {
  geneses: VirtualsGenesis[];
  pagination: VirtualsPagination | null;
}

// ── Request params ─────────────────────────────────────────────────

export type VirtualsSortField = "mcapInVirtual" | "volume24h" | "createdAt" | "lpCreatedAt";

export interface ListVirtualsParams {
  chain: VirtualsChain;
  /** API sort field. Default mcapInVirtual. Direction is always desc. */
  sort?: VirtualsSortField;
  page?: number;
  pageSize?: number;
  /** Server-side anti-impersonation filter (the one filter the API honors). */
  isVerified?: boolean;
}

export interface ListGenesesParams {
  page?: number;
  pageSize?: number;
}
