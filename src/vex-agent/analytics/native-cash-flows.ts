/**
 * Native cash-flow detection for a wallet — the DEPOSIT/WITHDRAWAL `Flow[]`
 * that Time-Weighted Return needs to neutralise external cash movements.
 *
 * ROOT GAP this closes: `proj_activity` only records swaps
 * (`swap/spot/buy|sell`); nothing tracks a wallet's native ETH deposits or
 * withdrawals. So the naive `(last - first) / first` return over
 * `proj_portfolio_snapshots.total_usd` counted a ~2-ETH withdrawal as a loss.
 *
 * CLASSIFICATION RULE (native transfers only, this pass):
 *   A native transfer with value > 0 is an EXTERNAL cash flow when the
 *   counterparty is NOT an allowlisted DEX router / wrapped-native / system
 *   contract. Swaps route native value THROUGH the Uniswap router (native
 *   input = msg.value to the router; wraps go to WETH), so router/WETH
 *   counterparties are trading-internal, never deposits/withdrawals.
 *     - `from == wallet`  → WITHDRAWAL (negative usd)
 *     - `to   == wallet`  → DEPOSIT    (positive usd)
 *   Failed txs, zero-value txs, self-transfers, and null counterparties are
 *   dropped.
 *
 * PRICING: each flow is valued in USD as `nativeAmount × price`, where price is
 * the per-tx native-coin USD rate from the explorer when present, else a
 * fallback current native price resolved via the SAME DexScreener-backed path
 * the balance reader uses (`readLocalChainBalances().nativePriceUsd`). Nothing
 * is hardcoded. A flow that cannot be priced at all is DROPPED (never valued at
 * a fabricated $0).
 *
 * FAIL-SOFT: `getNativeCashFlows` returns `[]` on any explorer/RPC failure or
 * for a chain we don't have a local config for — so the portfolio return falls
 * back to the naive number rather than crashing.
 *
 * LIMITS (documented follow-ons, NOT handled here):
 *   - TOKEN (ERC-20) deposits/withdrawals — only native flows are detected.
 *   - Internal-transaction inflows (e.g. an exchange that pays out through a
 *     contract) — only top-level native transactions are scanned. This is
 *     deliberate: the native ETH a swap returns arrives as an internal tx from
 *     the router, and scanning internals would risk misreading it as a deposit.
 *   - Per-tx price is the explorer's rate (current on some Blockscout
 *     instances), so historical valuation is approximate; the dominant signal
 *     is the native QUANTITY moved.
 */

import { formatUnits, getAddress } from "viem";

import { getLocalChain, type LocalChainConfig } from "@tools/evm-chains/registry.js";
import { getUniswapDeployment } from "@tools/uniswap/deployments.js";
import { readLocalChainBalances } from "@tools/evm-chains/balances.js";
import logger from "@utils/logger.js";

import type { Flow } from "./twr.js";

/**
 * One native transaction, normalised from the explorer response. `valueWei` is
 * a decimal wei string; `priceUsd` is the native-coin USD rate at (or near) the
 * tx time, `null` when the explorer gave none.
 */
export interface RawNativeTx {
  readonly from: string | null;
  readonly to: string | null;
  readonly valueWei: string;
  readonly timestampMs: number;
  readonly success: boolean;
  readonly priceUsd: number | null;
}

/**
 * Build the lowercased exclusion set for a chain: the Uniswap V2/V3 routers,
 * factories and quoter, the wrapped-native token, and the canonical
 * Multicall3. A native transfer whose counterparty is in this set is
 * trading-internal (swap/wrap/aggregation), never an external cash flow.
 *
 * Empty for a chain with no local config AND no Uniswap deployment (we then
 * have no basis to distinguish swaps from transfers, so `getNativeCashFlows`
 * returns `[]` for such a chain anyway).
 */
export function buildExcludedContracts(chainId: number): ReadonlySet<string> {
  const set = new Set<string>();
  const add = (addr: string | undefined): void => {
    if (addr) set.add(addr.toLowerCase());
  };

  const config = getLocalChain(chainId);
  if (config) add(config.multicall3);

  const deployment = getUniswapDeployment(chainId);
  if (deployment) {
    add(deployment.weth);
    for (const connector of deployment.connectors) add(connector);
    if (deployment.v2) {
      add(deployment.v2.router02);
      add(deployment.v2.factory);
    }
    if (deployment.v3) {
      add(deployment.v3.swapRouter02);
      add(deployment.v3.quoterV2);
      add(deployment.v3.factory);
    }
  }
  return set;
}

/**
 * Native decimals for the chain's coin (18 fallback). Kept tiny so the pure
 * classifier stays decoupled from the registry types.
 */
const DEFAULT_NATIVE_DECIMALS = 18;

/**
 * PURE: turn raw native transactions into external-flow `Flow[]`.
 *
 * See the module doc for the classification + direction + pricing rules. This
 * function does no I/O and is fully deterministic — the network fetch and price
 * resolution live in `getNativeCashFlows`.
 */
export function classifyNativeFlows(params: {
  readonly walletAddress: string;
  readonly txs: readonly RawNativeTx[];
  readonly excludedContracts: ReadonlySet<string>;
  readonly nativeDecimals?: number;
  readonly fallbackNativePriceUsd?: number | null;
}): Flow[] {
  const {
    walletAddress,
    txs,
    excludedContracts,
    nativeDecimals = DEFAULT_NATIVE_DECIMALS,
    fallbackNativePriceUsd = null,
  } = params;

  const wallet = walletAddress.toLowerCase();
  const flows: Flow[] = [];

  for (const tx of txs) {
    if (!tx.success) continue;
    if (!Number.isFinite(tx.timestampMs)) continue;

    let valueWei: bigint;
    try {
      valueWei = BigInt(tx.valueWei);
    } catch {
      continue; // malformed value — drop defensively
    }
    if (valueWei <= 0n) continue; // no native movement (plain contract call)

    const from = tx.from?.toLowerCase() ?? null;
    const to = tx.to?.toLowerCase() ?? null;

    // Direction relative to the wallet. A self-transfer or a tx where the
    // wallet is neither side (or the counterparty is null) is not a cash flow.
    let sign: 1 | -1;
    let counterparty: string;
    if (from === wallet && to !== null && to !== wallet) {
      sign = -1; // out of the wallet → withdrawal
      counterparty = to;
    } else if (to === wallet && from !== null && from !== wallet) {
      sign = 1; // into the wallet → deposit
      counterparty = from;
    } else {
      continue;
    }

    // Swap / wrap / system interaction — internal to trading, not a cash flow.
    if (excludedContracts.has(counterparty)) continue;

    const price = pickPrice(tx.priceUsd, fallbackNativePriceUsd);
    if (price === null) continue; // unpriceable — drop rather than fabricate $0

    const amount = Number(formatUnits(valueWei, nativeDecimals));
    if (!Number.isFinite(amount)) continue;

    flows.push({ t: tx.timestampMs, usd: sign * amount * price });
  }

  return flows;
}

/** Prefer a finite, positive per-tx price; else the fallback; else null. */
function pickPrice(
  perTx: number | null,
  fallback: number | null,
): number | null {
  if (perTx !== null && Number.isFinite(perTx) && perTx > 0) return perTx;
  if (fallback !== null && Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
}

// ── Real fetch + pricing wrapper ────────────────────────────────────

/** Injectable I/O deps (defaults hit the live explorer + DexScreener path). */
export interface NativeCashFlowDeps {
  readonly fetchNativeTxs: (
    config: LocalChainConfig,
    walletAddress: string,
  ) => Promise<RawNativeTx[]>;
  readonly resolveNativePriceUsd: (
    config: LocalChainConfig,
    walletAddress: string,
  ) => Promise<number | null>;
}

/** Max explorer pages walked (bounded so a busy wallet can't run unbounded). */
const MAX_PAGES = 10;
/** Blockscout v2 default page size is 50; we request the address tx list. */
const EXPLORER_TIMEOUT_MS = 6_000;

/**
 * Detect a wallet's native external cash flows on a chain, valued in USD.
 *
 * Fail-soft: returns `[]` when the chain has no local config, when the explorer
 * fetch fails, or when no price is resolvable — so the caller's return simply
 * falls back to the naive number instead of throwing.
 */
export async function getNativeCashFlows(
  chainId: number,
  walletAddress: string,
  deps: NativeCashFlowDeps = defaultDeps,
): Promise<Flow[]> {
  const config = getLocalChain(chainId);
  if (!config) return [];

  const excludedContracts = buildExcludedContracts(chainId);

  let txs: RawNativeTx[];
  try {
    txs = await deps.fetchNativeTxs(config, walletAddress);
  } catch (err) {
    logger.warn("analytics.native_flows.fetch_failed", {
      chainId,
      address: walletAddress.slice(0, 10) + "...",
      error: err instanceof Error ? err.name : "unknown",
    });
    return [];
  }
  if (txs.length === 0) return [];

  let fallbackNativePriceUsd: number | null = null;
  try {
    fallbackNativePriceUsd = await deps.resolveNativePriceUsd(config, walletAddress);
  } catch {
    fallbackNativePriceUsd = null; // pricing is fail-soft; per-tx rates may still price flows
  }

  return classifyNativeFlows({
    walletAddress,
    txs,
    excludedContracts,
    nativeDecimals: config.nativeCurrency.decimals,
    fallbackNativePriceUsd,
  });
}

// ── Default I/O implementations ─────────────────────────────────────

interface BlockscoutAddressRef {
  readonly hash?: string;
}
interface BlockscoutTxItem {
  readonly from?: BlockscoutAddressRef | null;
  readonly to?: BlockscoutAddressRef | null;
  readonly value?: string | null;
  readonly timestamp?: string | null;
  readonly status?: string | null;
  readonly result?: string | null;
  readonly exchange_rate?: string | null;
  readonly historic_exchange_rate?: string | null;
}
interface BlockscoutTxPage {
  readonly items?: BlockscoutTxItem[];
  readonly next_page_params?: Record<string, string | number> | null;
}

/**
 * Live Blockscout fetch: walk the address's native transaction list
 * (`/api/v2/addresses/{addr}/transactions`, both directions), bounded to
 * `MAX_PAGES`. Never surfaces the raw provider error upstream (it can carry the
 * explorer URL); the caller logs a bounded class and returns `[]`.
 */
async function fetchNativeTxsFromExplorer(
  config: LocalChainConfig,
  walletAddress: string,
): Promise<RawNativeTx[]> {
  const addr = getAddress(walletAddress);
  const base = config.explorerUrl.replace(/\/+$/, "");
  const out: RawNativeTx[] = [];
  let nextParams: Record<string, string | number> | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${base}/api/v2/addresses/${addr}/transactions`);
    url.searchParams.set("filter", "to|from");
    if (nextParams) {
      for (const [k, v] of Object.entries(nextParams)) url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXPLORER_TIMEOUT_MS);
    let body: BlockscoutTxPage;
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`explorer ${res.status}`);
      body = (await res.json()) as BlockscoutTxPage;
    } finally {
      clearTimeout(timer);
    }

    for (const item of body.items ?? []) {
      const parsed = parseBlockscoutTx(item);
      if (parsed) out.push(parsed);
    }

    const np = body.next_page_params;
    if (!np || Object.keys(np).length === 0) break;
    nextParams = np;
  }
  return out;
}

/** Normalise one Blockscout tx item to `RawNativeTx` (null when unusable). */
function parseBlockscoutTx(item: BlockscoutTxItem): RawNativeTx | null {
  const value = item.value;
  if (typeof value !== "string") return null;
  const ts = item.timestamp ? Date.parse(item.timestamp) : Number.NaN;
  if (!Number.isFinite(ts)) return null;

  // Success: Blockscout marks failures via status "error" or result != "success".
  const status = (item.status ?? "").toLowerCase();
  const result = (item.result ?? "").toLowerCase();
  const success = status !== "error" && result !== "error" && result !== "reverted";

  const rateStr = item.historic_exchange_rate ?? item.exchange_rate ?? null;
  const rate = rateStr !== null ? Number(rateStr) : Number.NaN;
  const priceUsd = Number.isFinite(rate) && rate > 0 ? rate : null;

  return {
    from: item.from?.hash ?? null,
    to: item.to?.hash ?? null,
    valueWei: value,
    timestampMs: ts,
    success,
    priceUsd,
  };
}

/**
 * Current native-coin USD price via the SAME DexScreener-backed path the
 * balance reader uses — `readLocalChainBalances(...).nativePriceUsd` derives
 * ETH≈WETH from the wrapped-native seed token. Reused so nothing is hardcoded.
 */
async function resolveNativePriceUsdViaBalances(
  config: LocalChainConfig,
  walletAddress: string,
): Promise<number | null> {
  const seedAddrs = config.seedTokens.map((t) => getAddress(t.address));
  const read = await readLocalChainBalances(config, walletAddress, seedAddrs);
  return read.nativePriceUsd;
}

const defaultDeps: NativeCashFlowDeps = {
  fetchNativeTxs: fetchNativeTxsFromExplorer,
  resolveNativePriceUsd: resolveNativePriceUsdViaBalances,
};
