/**
 * Khalani-independent viem client factory for local (non-Khalani) EVM chains.
 *
 * Mirrors `tools/kyberswap/evm/config.ts` (getKyberEvmClients / toViemChain) and
 * `tools/khalani/evm-client.ts` (createDynamicPublicClient/WalletClient) so the
 * whole toolkit builds clients the same way. The viem `Chain` (including
 * `contracts.multicall3`) comes from the local registry, so `publicClient
 * .multicall(...)` works without any Khalani dependency.
 *
 * Gas rule: NEVER cache or hardcode gas limits. Robinhood Chain is an Arbitrum
 * Orbit L2 whose fee has an L1-data component that fluctuates block to block —
 * viem estimates gas fresh at send time (its default) and we keep it that way.
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
import { getLocalChainRpcUrl, toLocalViemChain, type LocalChainConfig } from "./registry.js";

const EVM_RPC_TIMEOUT_MS = 30_000;
const EVM_RPC_RETRY_COUNT = 2;

export interface LocalEvmClients {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
}

// Explicit return annotations (mirroring kyberswap/evm/config.ts and
// khalani/evm-client.ts): viem's inferred client types reference internal
// action modules and are not portable across declaration emit (TS2742).
export function getLocalPublicClient(config: LocalChainConfig): PublicClient<Transport, Chain> {
  const rpcUrl = getLocalChainRpcUrl(config);
  return createPublicClient({
    chain: toLocalViemChain(config),
    transport: http(rpcUrl, { timeout: EVM_RPC_TIMEOUT_MS, retryCount: EVM_RPC_RETRY_COUNT }),
  }) as PublicClient<Transport, Chain>;
}

export function getLocalEvmClients(config: LocalChainConfig, privateKey: Hex): LocalEvmClients {
  const chain = toLocalViemChain(config);
  const rpcUrl = getLocalChainRpcUrl(config);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: EVM_RPC_TIMEOUT_MS, retryCount: EVM_RPC_RETRY_COUNT }),
  }) as PublicClient<Transport, Chain>;
  const walletClient = createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain,
    transport: http(rpcUrl, { timeout: EVM_RPC_TIMEOUT_MS, retryCount: EVM_RPC_RETRY_COUNT }),
  }) as WalletClient<Transport, Chain, Account>;
  return { publicClient, walletClient };
}
