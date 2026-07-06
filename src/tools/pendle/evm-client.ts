/**
 * Pendle viem client factory (multichain, public + wallet).
 *
 * Self-contained (not coupled to another venue): builds a viem `Chain` for any
 * supported Pendle chain from the network-free registry (`./chains.ts`), wiring
 * the Multicall3 contract so `publicClient.multicall` works and honoring a
 * user RPC override (`pendleRpcUrls[chainId]` in config) over the bundled
 * keyless default. Gas is estimated fresh at send time (viem default) — never
 * cached. An unsupported chain id is rejected with a clear VexError.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { loadConfig } from "../../config/store.js";
import { VexError, ErrorCodes } from "../../errors.js";
import { getPendleChain, type PendleChain } from "./chains.js";

const RPC_TIMEOUT_MS = 30_000;
const RPC_RETRY_COUNT = 2;

export interface PendleEvmClients {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
}

/** Resolve the registry entry for a chain id or throw a clear VexError. */
function requirePendleChain(chainId: number): PendleChain {
  const chain = getPendleChain(chainId);
  if (!chain) {
    throw new VexError(ErrorCodes.PENDLE_API_ERROR, `Pendle does not support chain id ${chainId}.`);
  }
  return chain;
}

/** Config override RPC (per chainId) wins; else the bundled default. */
function rpcUrlFor(chain: PendleChain): string {
  const override = loadConfig().pendleRpcUrls?.[String(chain.chainId)];
  return override && override.length > 0 ? override : chain.defaultRpcUrl;
}

/** Build the viem `Chain` (with Multicall3 wired) for a supported chain id. */
function buildViemChain(chain: PendleChain): Chain {
  return {
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [rpcUrlFor(chain)] } },
    contracts: { multicall3: { address: chain.multicall3 } },
  };
}

/** Read-only public client for a supported chain (balances / allowance / metadata). */
export function getPendlePublicClient(chainId: number): PublicClient<Transport, Chain> {
  const chain = requirePendleChain(chainId);
  const viemChain = buildViemChain(chain);
  return createPublicClient({
    chain: viemChain,
    transport: http(viemChain.rpcUrls.default.http[0], { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  }) as PublicClient<Transport, Chain>;
}

/** Public + wallet clients for broadcast on a supported chain. Decrypts nothing beyond the passed key. */
export function getPendleEvmClients(chainId: number, privateKey: Hex): PendleEvmClients {
  const chain = requirePendleChain(chainId);
  const viemChain = buildViemChain(chain);
  const publicClient = createPublicClient({
    chain: viemChain,
    transport: http(viemChain.rpcUrls.default.http[0], { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  }) as PublicClient<Transport, Chain>;
  const walletClient = createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: viemChain,
    transport: http(viemChain.rpcUrls.default.http[0], { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  }) as WalletClient<Transport, Chain, Account>;
  return { publicClient, walletClient };
}
