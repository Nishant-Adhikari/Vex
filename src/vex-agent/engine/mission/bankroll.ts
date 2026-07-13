/**
 * ETH-equivalent bankroll read for the mission results ledger.
 *
 * The bankroll is native ETH + WETH (they are 1:1 and price rides on wrapped
 * native — see local-chain-balance-sync). Every other held token is an OPEN
 * position: reported separately and EXCLUDED from the bankroll so an unsold bag
 * never distorts a mission's PNL.
 *
 * Two reads live here:
 *   - `readEthBankroll` folds the `proj_balances` projection (no RPC). Cheap,
 *     but the projection refreshes on its own sync cycle, so at finalize it can
 *     lag the trades a mission just made — reporting a stale (often unchanged)
 *     bankroll and a false-zero PNL.
 *   - `readEthBankrollOnChain` reads the wallet's ETH bankroll LIVE from chain
 *     (native + WETH), so start/end snapshots share an accurate, up-to-date
 *     basis. Prices/open-positions still come from the projection.
 * Both are fail-soft — a read error yields null so mission finalization is never
 * blocked by bankroll accounting.
 */

import { formatEther, formatUnits, getAddress, type Address } from "viem";
import { getBalances } from "../../db/repos/balances/read.js";
import type { BalanceRow } from "../../db/repos/balances/types.js";
import { NATIVE_TOKEN_ADDRESS } from "../../../tools/kyberswap/constants.js";
import { getUniswapPublicClient } from "../../../tools/uniswap/evm-client.js";
import { resolveUniswapDeployment } from "../../../tools/uniswap/chains.js";
import logger from "@utils/logger.js";

export interface OpenPosition {
  symbol: string | null;
  address: string;
  amount: number;
  valueUsd: number | null;
}

export interface EthBankroll {
  /** Native ETH + WETH, in ETH. */
  bankrollEth: number;
  /** ETH/USD from the native/WETH row (display tooltip only); null if unpriced. */
  ethPriceUsd: number | null;
  /** Non-ETH tokens still held, excluded from the bankroll. */
  openPositions: OpenPosition[];
}

function toAmount(raw: string, decimals: number | null): number {
  try {
    return Number(formatUnits(BigInt(raw), decimals ?? 18));
  } catch {
    return 0;
  }
}

/** Pure: fold proj_balances rows into an ETH bankroll + open-position list. */
export function computeEthBankroll(rows: readonly BalanceRow[]): EthBankroll {
  let bankrollEth = 0;
  let ethPriceUsd: number | null = null;
  const openPositions: OpenPosition[] = [];

  for (const r of rows) {
    const isNative =
      r.tokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
    const isWeth = (r.tokenSymbol ?? "").toUpperCase() === "WETH";
    const amount = toAmount(r.balanceRaw, r.decimals);

    if (isNative || isWeth) {
      bankrollEth += amount;
      if (ethPriceUsd === null && r.priceUsd !== null) ethPriceUsd = r.priceUsd;
    } else if (amount > 0) {
      openPositions.push({
        symbol: r.tokenSymbol,
        address: r.tokenAddress,
        amount,
        valueUsd: r.balanceUsd,
      });
    }
  }

  return { bankrollEth, ethPriceUsd, openPositions };
}

export interface BankrollDeps {
  getBalances: typeof getBalances;
}

/**
 * Read the wallet's ETH bankroll on a chain from `proj_balances`. Fail-soft:
 * returns null on any read error (caller records a null snapshot rather than
 * failing the run).
 */
export async function readEthBankroll(
  walletAddress: string,
  chainId: number,
  deps: BankrollDeps = { getBalances },
): Promise<EthBankroll | null> {
  try {
    const rows = await deps.getBalances(walletAddress, chainId);
    return computeEthBankroll(rows);
  } catch (err) {
    logger.warn("mission.bankroll.read_failed", {
      walletAddress,
      chainId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Minimal ERC-20 `balanceOf` surface for the live WETH read. */
const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface OnChainBankrollDeps {
  resolveDeployment: typeof resolveUniswapDeployment;
  getPublicClient: typeof getUniswapPublicClient;
}

/**
 * Read the wallet's ETH bankroll (native ETH + WETH) LIVE from chain, bypassing
 * the `proj_balances` projection so start/end snapshots reflect the trades a
 * mission actually made. Resolves the chain via the Uniswap deployment registry
 * (which knows the WETH address); a keyless public client does the two reads.
 *
 * `ethPriceUsd` and `openPositions` are intentionally left null/empty — those
 * come from the projection; this read exists solely for an accurate ETH figure.
 * Fail-soft: an unresolved chain or any RPC error yields null (caller falls back
 * to the projection read rather than failing the run).
 */
export async function readEthBankrollOnChain(
  walletAddress: string,
  chainId: number,
  deps: OnChainBankrollDeps = {
    resolveDeployment: resolveUniswapDeployment,
    getPublicClient: getUniswapPublicClient,
  },
): Promise<EthBankroll | null> {
  try {
    const deployment = deps.resolveDeployment(String(chainId));
    if (!deployment) return null;
    const client = deps.getPublicClient(deployment);
    const owner = getAddress(walletAddress);
    const [nativeWei, wethWei] = await Promise.all([
      client.getBalance({ address: owner }),
      client.readContract({
        address: deployment.weth as Address,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),
    ]);
    const bankrollEth = Number(formatEther(nativeWei)) + Number(formatUnits(wethWei, 18));
    return { bankrollEth, ethPriceUsd: null, openPositions: [] };
  } catch (err) {
    logger.warn("mission.bankroll.onchain_read_failed", {
      walletAddress,
      chainId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
