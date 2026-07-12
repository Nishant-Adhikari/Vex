/**
 * ETH-equivalent bankroll read for the mission results ledger.
 *
 * The bankroll is native ETH + WETH (they are 1:1 and price rides on wrapped
 * native — see local-chain-balance-sync). Every other held token is an OPEN
 * position: reported separately and EXCLUDED from the bankroll so an unsold bag
 * never distorts a mission's PNL. Reads the `proj_balances` projection (no
 * on-chain RPC) and is fail-soft — a read error yields null so mission
 * finalization is never blocked by bankroll accounting.
 */

import { formatUnits } from "viem";
import { getBalances } from "../../db/repos/balances/read.js";
import type { BalanceRow } from "../../db/repos/balances/types.js";
import { NATIVE_TOKEN_ADDRESS } from "../../../tools/kyberswap/constants.js";
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
