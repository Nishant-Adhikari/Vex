/**
 * KyberSwap constants — URLs, contract addresses, timeouts, spender allowlist.
 */

import type { Address } from "viem";

// ── Client identification ───────────────────────────────────────────

export const KYBER_CLIENT_ID = "EchoClaw";

// ── Native token (same on all EVM chains) ───────────────────────────

export const NATIVE_TOKEN_ADDRESS: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// ── Base URLs ───────────────────────────────────────────────────────

export const AGGREGATOR_BASE_URL = "https://aggregator-api.kyberswap.com";
export const TOKEN_API_BASE_URL = "https://token-api.kyberswap.com";
export const COMMON_SERVICE_BASE_URL = "https://common-service.kyberswap.com";
export const LIMIT_ORDER_BASE_URL = "https://limit-order.kyberswap.com";
export const ZAAS_BASE_URL = "https://zap-api.kyberswap.com";

// ── Aggregator contracts (same address on all 18 chains) ────────────

export const META_AGGREGATION_ROUTER_V2: Address = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
export const INPUT_SCALING_HELPER_V2: Address = "0x2f577A41BeC1BE1152AeEA12e73b7391d15f655D";

// ── Limit Order contracts ───────────────────────────────────────────

/** DSLOProtocol — deployed on all 17 LO-supported chains. */
export const DSLO_PROTOCOL: Address = "0xcab2FA2eeab7065B45CBcF6E3936dDE2506b4f6C";

/** LimitOrderProtocol — only on Ethereum, BSC, Arbitrum, Polygon, Optimism, Avalanche. */
export const LIMIT_ORDER_PROTOCOL: Address = "0x227B0c196eA8db17A665EA6824D972A64202E936";

export const WETH_UNWRAPPER: Address = "0x37334Cd06DFEcd2e9b3937a6dA17853d637A5b94";

// ── ZaaS contracts (same address on all ZaaS-supported chains) ──────

export const KS_ZAP_ROUTER_POSITION: Address = "0x0e97c887b61ccd952a53578b04763e7134429e05";
export const KS_ZAP_VALIDATOR_V2: Address = "0xa16f32442209c6b978431818aa535bcc9ad2863e";
/** Not deployed on Linea, Sonic, Ronin. */
export const KS_ZAP_ROUTER_PERMIT: Address = "0x638d935eEcD1646991A8b2CE9C2A2B7B840CCaBb";

// ── Spender allowlist (security: validate before any ERC-20 approve) ─

export const KYBER_KNOWN_SPENDERS: Set<string> = new Set([
  META_AGGREGATION_ROUTER_V2.toLowerCase(),
  DSLO_PROTOCOL.toLowerCase(),
  KS_ZAP_ROUTER_POSITION.toLowerCase(),
  KS_ZAP_ROUTER_PERMIT.toLowerCase(),
]);

// ── Per-client timeouts ─────────────────────────────────────────────

export const AGGREGATOR_TIMEOUT_MS = 15_000;
export const TOKEN_API_TIMEOUT_MS = 10_000;
export const COMMON_SERVICE_TIMEOUT_MS = 10_000;
export const LIMIT_ORDER_TIMEOUT_MS = 15_000;
export const ZAAS_TIMEOUT_MS = 20_000;
