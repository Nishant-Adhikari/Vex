/**
 * KyberSwap multi-chain EVM utilities.
 *
 * Creates viem clients for arbitrary KyberSwap chains,
 * handles ERC-20 allowance with spender validation,
 * and sends signed transactions.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  maxUint256,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EchoError, ErrorCodes } from "../../errors.js";
import { KYBER_KNOWN_SPENDERS } from "./constants.js";
import { slugToChainId } from "./chains.js";
import logger from "../../utils/logger.js";
import type { KyberChainSlug } from "./types.js";

// ── ERC-20 ABI (minimal: allowance + approve + metadata) ─────────────

const ERC20_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ── Default RPC URLs per chain ──────────────────────────────────────

const DEFAULT_RPC: Record<string, string> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  bsc: "https://bsc-rpc.publicnode.com",
  arbitrum: "https://arbitrum-one-rpc.publicnode.com",
  polygon: "https://polygon-bor-rpc.publicnode.com",
  optimism: "https://optimism-rpc.publicnode.com",
  avalanche: "https://avalanche-c-chain-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com",
  linea: "https://rpc.linea.build",
  mantle: "https://rpc.mantle.xyz",
  sonic: "https://rpc.soniclabs.com",
  berachain: "https://rpc.berachain.com",
  ronin: "https://api.roninchain.com/rpc",
  unichain: "https://mainnet.unichain.org",
  hyperevm: "https://rpc.hyperliquid.xyz/evm",
  plasma: "https://rpc.plasma.digital",
  etherlink: "https://node.mainnet.etherlink.com",
  monad: "https://rpc.monad.xyz",
  megaeth: "https://rpc.megaeth.com",
  scroll: "https://rpc.scroll.io",
  zksync: "https://mainnet.era.zksync.io",
};

const RPC_TIMEOUT_MS = 30_000;
const RPC_RETRY_COUNT = 2;

// ── Chain to viem Chain ─────────────────────────────────────────────

function toViemChain(slug: KyberChainSlug): Chain {
  const chainId = slugToChainId(slug);
  const rpcUrl = DEFAULT_RPC[slug];
  if (!rpcUrl) {
    throw new EchoError(ErrorCodes.KYBER_UNSUPPORTED_CHAIN, `No RPC URL for chain: ${slug}`);
  }
  return {
    id: chainId,
    name: slug,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

// ── Client creation ─────────────────────────────────────────────────

export interface KyberEvmClients {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain>;
}

export function getKyberEvmClients(slug: KyberChainSlug, privateKey: Hex): KyberEvmClients {
  const chain = toViemChain(slug);
  const rpcUrl = DEFAULT_RPC[slug]!;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  }) as PublicClient<Transport, Chain>;

  const walletClient = createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain,
    transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  }) as WalletClient<Transport, Chain>;

  return { publicClient, walletClient };
}

// ── Read-only public client ─────────────────────────────────────────

/**
 * Get a read-only public client for a chain (no wallet needed).
 * Used for on-chain token metadata reads.
 */
export function getKyberPublicClient(slug: KyberChainSlug): PublicClient<Transport, Chain> {
  const chain = toViemChain(slug);
  const rpcUrl = DEFAULT_RPC[slug]!;
  return createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  }) as PublicClient<Transport, Chain>;
}

// ── On-chain ERC-20 metadata ────────────────────────────────────────

export interface Erc20Metadata {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  isNative: false;
}

/**
 * Read ERC-20 metadata directly from chain.
 *
 * Tolerant handling:
 * - decimals() — mandatory, throw if missing (not a valid ERC-20)
 * - symbol() — optional, some tokens return bytes32 or revert → "UNKNOWN"
 * - name() — optional, some tokens revert → "Unknown Token"
 */
export async function readErc20Metadata(slug: KyberChainSlug, address: Address): Promise<Erc20Metadata> {
  const client = getKyberPublicClient(slug);

  // decimals — mandatory
  let decimals: number;
  try {
    decimals = await client.readContract({
      address,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
  } catch (err) {
    throw new EchoError(
      ErrorCodes.KYBER_TOKEN_NOT_FOUND,
      `Cannot read decimals for ${address} on ${slug} — not a valid ERC-20 contract`,
      "Verify the token address and chain are correct.",
    );
  }

  // symbol — optional, tolerant
  let symbol = "UNKNOWN";
  try {
    symbol = await client.readContract({
      address,
      abi: ERC20_ABI,
      functionName: "symbol",
    });
  } catch {
    logger.debug({ event: "kyberswap.erc20.symbol_failed", address, slug });
  }

  // name — optional, tolerant
  let name = "Unknown Token";
  try {
    name = await client.readContract({
      address,
      abi: ERC20_ABI,
      functionName: "name",
    });
  } catch {
    logger.debug({ event: "kyberswap.erc20.name_failed", address, slug });
  }

  return { address, symbol, name, decimals, isNative: false as const };
}

// ── Spender validation ──────────────────────────────────────────────

/** Verify a spender address is in the KyberSwap known contracts allowlist. */
export function validateKyberSpender(address: Address): void {
  if (!KYBER_KNOWN_SPENDERS.has(address.toLowerCase())) {
    throw new EchoError(
      ErrorCodes.INVALID_SPENDER,
      `Spender ${address} is not a known KyberSwap contract`,
      `Known: MetaAggregationRouterV2, DSLOProtocol, KSZapRouterPosition, KSZapRouterPermit`,
    );
  }
}

/** Verify the router address from API response matches the expected constant. */
export function verifyRouterAddress(actual: Address, expected: Address): void {
  if (getAddress(actual) !== getAddress(expected)) {
    throw new EchoError(
      ErrorCodes.KYBER_API_ERROR,
      `Router address mismatch: API returned ${actual}, expected ${expected}`,
      "This may indicate an API issue. Do not approve or send transactions.",
    );
  }
}

// ── Allowance management ────────────────────────────────────────────

export interface ApproveResult {
  txHash: Hex;
  resetTxHash?: Hex;
}

/**
 * Ensure ERC-20 allowance is sufficient. Approve if needed.
 * Handles USDT-style tokens that require reset to 0 before new approval.
 *
 * @param publicClient - viem PublicClient for the target chain
 * @param walletClient - viem WalletClient for signing
 * @param token - ERC-20 token address
 * @param spender - Spender to approve (validated against KYBER_KNOWN_SPENDERS)
 * @param requiredAmount - Minimum allowance needed
 * @param approveExact - If true, approve exact amount; otherwise maxUint256
 */
export async function ensureKyberAllowance(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  token: Address,
  spender: Address,
  requiredAmount: bigint,
  approveExact = false,
): Promise<ApproveResult | null> {
  validateKyberSpender(spender);

  const owner = walletClient.account!.address;

  const currentAllowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });

  if (currentAllowance >= requiredAmount) {
    logger.debug({ event: "kyberswap.allowance.sufficient", token, spender, current: currentAllowance.toString() });
    return null;
  }

  let resetTxHash: Hex | undefined;

  // USDT-style reset: if current > 0 and < required, reset to 0 first
  if (currentAllowance > 0n && currentAllowance < requiredAmount) {
    logger.debug({ event: "kyberswap.allowance.reset", token, spender });
    try {
      resetTxHash = await walletClient.writeContract({
        account: walletClient.account!,
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, 0n],
      });
      await publicClient.waitForTransactionReceipt({ hash: resetTxHash });
    } catch (err) {
      throw new EchoError(ErrorCodes.APPROVAL_FAILED, `Failed to reset allowance: ${err instanceof Error ? err.message : err}`);
    }
  }

  const approveAmount = approveExact ? requiredAmount : maxUint256;

  try {
    logger.debug({ event: "kyberswap.allowance.approve", token, spender, amount: approveAmount.toString() });
    const txHash = await walletClient.writeContract({
      account: walletClient.account!,
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, approveAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash, resetTxHash };
  } catch (err) {
    throw new EchoError(ErrorCodes.APPROVAL_FAILED, `Failed to approve: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Transaction sending ─────────────────────────────────────────────

/**
 * Send a pre-built KyberSwap transaction (swap, cancel, zap).
 *
 * @returns Transaction hash
 */
export async function sendKyberTransaction(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  params: { to: Address; data: Hex; value?: bigint },
): Promise<Hex> {
  try {
    const txHash = await walletClient.sendTransaction({
      account: walletClient.account!,
      to: params.to,
      data: params.data,
      value: params.value ?? 0n,
      chain: walletClient.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  } catch (err) {
    throw new EchoError(ErrorCodes.SWAP_FAILED, `Transaction failed: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Send a KyberSwap transaction and return both hash and receipt.
 * Used by zap.in to extract NFT position ID from receipt logs.
 */
export async function sendKyberTransactionWithReceipt(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  params: { to: Address; data: Hex; value?: bigint },
): Promise<{ hash: Hex; receipt: { logs: Array<{ address: string; topics: string[]; data: string }> } }> {
  try {
    const hash = await walletClient.sendTransaction({
      account: walletClient.account!,
      to: params.to,
      data: params.data,
      value: params.value ?? 0n,
      chain: walletClient.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return {
      hash,
      receipt: {
        logs: receipt.logs.map(l => ({
          address: l.address,
          topics: l.topics as string[],
          data: l.data,
        })),
      },
    };
  } catch (err) {
    throw new EchoError(ErrorCodes.SWAP_FAILED, `Transaction failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── ERC-721 approval ───────────────────────────────────────────────

const ERC721_ABI = [
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "getApproved",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "owner", type: "address" }, { name: "operator", type: "address" }],
    name: "isApprovedForAll",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }],
    name: "approve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Ensure ERC-721 NFT is approved for a spender. Approve if needed.
 */
export async function ensureErc721Approval(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  nftContract: Address,
  tokenId: bigint,
  spender: Address,
): Promise<Hex | null> {
  validateKyberSpender(spender);
  const owner = walletClient.account!.address;

  // Check isApprovedForAll first — many DEXes (Algebra, Velodrome) use operator approval
  try {
    const operatorApproved = await publicClient.readContract({
      address: nftContract,
      abi: ERC721_ABI,
      functionName: "isApprovedForAll",
      args: [owner, spender],
    });
    if (operatorApproved) {
      logger.debug({ event: "kyberswap.erc721.operator_approved", nftContract, spender });
      return null;
    }
  } catch {
    logger.debug({ event: "kyberswap.erc721.isApprovedForAll_failed", nftContract });
  }

  // Check per-token approval
  try {
    const approved = await publicClient.readContract({
      address: nftContract,
      abi: ERC721_ABI,
      functionName: "getApproved",
      args: [tokenId],
    });

    if (getAddress(approved) === getAddress(spender)) {
      logger.debug({ event: "kyberswap.erc721.already_approved", nftContract, tokenId: tokenId.toString(), spender });
      return null;
    }
  } catch {
    logger.debug({ event: "kyberswap.erc721.getApproved_failed", nftContract, tokenId: tokenId.toString() });
  }

  try {
    logger.debug({ event: "kyberswap.erc721.approve", nftContract, tokenId: tokenId.toString(), spender });
    const txHash = await walletClient.writeContract({
      account: walletClient.account!,
      address: nftContract,
      abi: ERC721_ABI,
      functionName: "approve",
      args: [spender, tokenId],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  } catch (err) {
    throw new EchoError(ErrorCodes.APPROVAL_FAILED, `ERC-721 approve failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── ERC-1155 approval ──────────────────────────────────────────────

const ERC1155_ABI = [
  {
    inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }],
    name: "isApprovedForAll",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Ensure ERC-1155 setApprovalForAll for a spender. Approve if needed.
 */
export async function ensureErc1155ApprovalForAll(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  contract: Address,
  operator: Address,
): Promise<Hex | null> {
  validateKyberSpender(operator);

  const owner = walletClient.account!.address;

  try {
    const approved = await publicClient.readContract({
      address: contract,
      abi: ERC1155_ABI,
      functionName: "isApprovedForAll",
      args: [owner, operator],
    });

    if (approved) {
      logger.debug({ event: "kyberswap.erc1155.already_approved", contract, operator });
      return null;
    }
  } catch {
    logger.debug({ event: "kyberswap.erc1155.isApprovedForAll_failed", contract, operator });
  }

  try {
    logger.debug({ event: "kyberswap.erc1155.setApprovalForAll", contract, operator });
    const txHash = await walletClient.writeContract({
      account: walletClient.account!,
      address: contract,
      abi: ERC1155_ABI,
      functionName: "setApprovalForAll",
      args: [operator, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  } catch (err) {
    throw new EchoError(ErrorCodes.APPROVAL_FAILED, `ERC-1155 setApprovalForAll failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── ERC-721 mint extraction from receipt ────────────────────────

const ERC721_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_ADDR_PADDED = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Extract NFT position ID from transaction receipt logs.
 *
 * Priority:
 * 1. Direct mint: Transfer(from=0x0, to=wallet, tokenId) — standard mint
 * 2. Router-intermediated: Transfer(from=any, to=wallet, tokenId) — router mints to
 *    itself first, then transfers to wallet. Only matches logs with 4 indexed topics
 *    (ERC-721, not ERC-20).
 */
export function extractMintedNftId(
  logs: Array<{ address: string; topics: string[]; data: string }>,
  recipientAddress: string,
  expectedContract?: string,
): string | undefined {
  const recipientPadded = `0x000000000000000000000000${recipientAddress.slice(2).toLowerCase()}`;
  const expectedLower = expectedContract?.toLowerCase();

  // Pass 1: direct mint (from=0x0 → wallet)
  for (const log of logs) {
    if (
      log.topics[0] === ERC721_TRANSFER_TOPIC &&
      log.topics.length === 4 &&
      log.topics[1] === ZERO_ADDR_PADDED &&
      log.topics[2]?.toLowerCase() === recipientPadded &&
      (!expectedLower || log.address.toLowerCase() === expectedLower)
    ) {
      return BigInt(log.topics[3]).toString();
    }
  }

  // Pass 2: router-intermediated (any → wallet, 4 topics = ERC-721)
  for (const log of logs) {
    if (
      log.topics[0] === ERC721_TRANSFER_TOPIC &&
      log.topics.length === 4 &&
      log.topics[1] !== ZERO_ADDR_PADDED &&
      log.topics[2]?.toLowerCase() === recipientPadded &&
      (!expectedLower || log.address.toLowerCase() === expectedLower)
    ) {
      return BigInt(log.topics[3]).toString();
    }
  }

  return undefined;
}

// ── ERC-1155 position extraction from receipt ──────────────────────

const ERC1155_TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const ERC1155_TRANSFER_BATCH_TOPIC = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";

/**
 * Extract ERC-1155 position token ID from receipt logs.
 * Looks for TransferSingle or TransferBatch events where `to` is the recipient.
 */
export function extractErc1155Position(
  logs: Array<{ address: string; topics: string[]; data: string }>,
  recipientAddress: string,
): string | undefined {
  const recipientPadded = `0x000000000000000000000000${recipientAddress.slice(2).toLowerCase()}`;

  // TransferSingle(operator, from, to, id, value) — to is topics[3]
  for (const log of logs) {
    if (
      log.topics[0] === ERC1155_TRANSFER_SINGLE_TOPIC &&
      log.topics.length === 4 &&
      log.topics[3]?.toLowerCase() === recipientPadded
    ) {
      // id is in data[0:32]
      const id = BigInt("0x" + log.data.slice(2, 66));
      return id.toString();
    }
  }

  // TransferBatch(operator, from, to, ids[], values[]) — to is topics[3]
  for (const log of logs) {
    if (
      log.topics[0] === ERC1155_TRANSFER_BATCH_TOPIC &&
      log.topics.length === 4 &&
      log.topics[3]?.toLowerCase() === recipientPadded
    ) {
      // For batch, take the first id from the ABI-encoded array
      // Offset to ids array starts at data position 0 (offset pointer), then length, then first element
      try {
        const dataHex = log.data.slice(2);
        const idsOffset = Number(BigInt("0x" + dataHex.slice(0, 64))) * 2;
        const firstId = BigInt("0x" + dataHex.slice(idsOffset + 64, idsOffset + 128));
        return firstId.toString();
      } catch {
        continue;
      }
    }
  }

  return undefined;
}
