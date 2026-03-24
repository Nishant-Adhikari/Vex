/**
 * Polymarket constants — URLs, contract addresses, timeouts.
 */

import type { Address } from "viem";

// ── Base URLs ───────────────────────────────────────────────────────

export const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
export const CLOB_BASE_URL = "https://clob.polymarket.com";
export const CLOB_WS_USER_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/user";
export const DATA_API_BASE_URL = "https://data-api.polymarket.com";
export const BRIDGE_BASE_URL = "https://bridge.polymarket.com";
export const RELAYER_BASE_URL = "https://relayer-v2.polymarket.com";

// ── Chain ───────────────────────────────────────────────────────────

export const POLYGON_CHAIN_ID = 137;
export const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";

// ── Tokens ──────────────────────────────────────────────────────────

/** USDC.e on Polygon — 6 decimals. Collateral token for Polymarket. */
export const USDC_E_ADDRESS: Address = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
export const USDC_E_DECIMALS = 6;

// ── Contracts (Polygon) ─────────────────────────────────────────────

/** CTF Exchange — standard binary markets. */
export const CTF_EXCHANGE: Address = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";

/** Neg Risk CTF Exchange — multi-outcome capital-efficient markets. */
export const NEG_RISK_CTF_EXCHANGE: Address = "0xC5d563A36AE78145C45a50134d48A1215220f80a";

/** Conditional Tokens Framework contract. */
export const CONDITIONAL_TOKENS: Address = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

// ── Spender allowlist ───────────────────────────────────────────────

export const POLY_KNOWN_SPENDERS: Set<string> = new Set([
  CTF_EXCHANGE.toLowerCase(),
  NEG_RISK_CTF_EXCHANGE.toLowerCase(),
]);

// ── Timeouts ────────────────────────────────────────────────────────

export const GAMMA_TIMEOUT_MS = 10_000;
export const CLOB_TIMEOUT_MS = 15_000;
export const DATA_API_TIMEOUT_MS = 10_000;
export const BRIDGE_TIMEOUT_MS = 20_000;
export const RELAYER_TIMEOUT_MS = 15_000;

// ── Env var names for secrets ───────────────────────────────────────

export const ENV_POLYMARKET_API_KEY = "POLYMARKET_API_KEY";
export const ENV_POLYMARKET_API_SECRET = "POLYMARKET_API_SECRET";
export const ENV_POLYMARKET_PASSPHRASE = "POLYMARKET_PASSPHRASE";
