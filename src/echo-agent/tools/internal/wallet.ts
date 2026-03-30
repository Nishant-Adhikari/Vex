/**
 * Wallet internal tool handlers.
 *
 * - wallet_read: address + multi-chain token balances (via Khalani)
 * - wallet_send_prepare: build transfer intent (no broadcast)
 * - wallet_send_confirm: sign + broadcast (mutating, needs approval)
 *
 * Imports from @tools/wallet/ for auth and @tools/khalani/ for balances.
 * Native transfers via @tools/chains/solana/transfer-service (Solana)
 * and @tools/wallet/signingClient (EVM/0G).
 */

import { requireEvmWallet, requireSolanaWallet } from "@tools/wallet/multi-auth.js";
import { normalizeWalletChain } from "@tools/wallet/family.js";
import { getKhalaniClient } from "@tools/khalani/client.js";
import { getPublicClient } from "@tools/wallet/client.js";
import { getSigningClient } from "@tools/wallet/signingClient.js";
import { sendSol, sendSplToken } from "@tools/solana-ecosystem/shared/solana-transfer.js";
import { resolveJupiterToken } from "@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js";
import { Keypair } from "@solana/web3.js";
import { formatUnits, parseUnits, type Address } from "viem";

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, num } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────

function parseChainIds(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  return raw.split(",").map(s => s.trim()).filter(Boolean).map(Number).filter(n => Number.isFinite(n) && n > 0);
}

function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}

function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

// ── In-memory intent store (per-process, cleared on restart) ─────

interface TransferIntent {
  id: string;
  network: "eip155" | "solana";
  to: string;
  amount: string;
  token: string | null;
  createdAt: number;
}

const pendingIntents = new Map<string, TransferIntent>();
let intentCounter = 0;

// ── wallet_read ──────────────────────────────────────────────────

export async function handleWalletRead(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const action = str(params, "action");

  if (action === "address") {
    const chain = normalizeWalletChain(str(params, "chain") || undefined);
    if (chain === "solana") {
      const wallet = requireSolanaWallet();
      return ok({ chain: "solana", address: wallet.address });
    }
    const wallet = requireEvmWallet();
    return ok({ chain: "eip155", address: wallet.address });
  }

  if (action === "balances") {
    const walletScope = str(params, "wallet") || "all";
    const chainIds = parseChainIds(str(params, "chainIds"));
    const results: Array<{ wallet: string; address: string; tokens: unknown[] }> = [];

    if (walletScope === "eip155" || walletScope === "all") {
      try {
        const evmWallet = requireEvmWallet();
        const tokens = await getKhalaniClient().getTokenBalances(evmWallet.address, chainIds);
        results.push({ wallet: "eip155", address: evmWallet.address, tokens });
      } catch (err) {
        if (walletScope === "eip155") {
          return fail(`EVM wallet error: ${err instanceof Error ? err.message : String(err)}`);
        }
        // wallet=all — skip if EVM not configured
      }
    }

    if (walletScope === "solana" || walletScope === "all") {
      try {
        const solWallet = requireSolanaWallet();
        const tokens = await getKhalaniClient().getTokenBalances(solWallet.address, chainIds);
        results.push({ wallet: "solana", address: solWallet.address, tokens });
      } catch (err) {
        if (walletScope === "solana") {
          return fail(`Solana wallet error: ${err instanceof Error ? err.message : String(err)}`);
        }
        // wallet=all — skip if Solana not configured
      }
    }

    return ok({ wallets: results });
  }

  return fail(`Unknown wallet_read action: "${action}". Use: address, balances`);
}

// ── wallet_send_prepare ──────────────────────────────────────────

export async function handleWalletSendPrepare(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const network = str(params, "network") as "eip155" | "solana";
  const to = str(params, "to");
  const amount = str(params, "amount");
  const token = str(params, "token") || null;

  if (!network || !to || !amount) {
    return fail("Missing required: network, to, amount");
  }

  if (network !== "eip155" && network !== "solana") {
    return fail("network must be eip155 or solana");
  }

  // Validate amount is numeric
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return fail(`Invalid amount: ${amount}`);
  }

  // Validate sender has wallet configured
  if (network === "solana") {
    requireSolanaWallet(); // throws if not configured
  } else {
    requireEvmWallet(); // throws if not configured
  }

  // Create intent
  intentCounter++;
  const intentId = `intent-${Date.now()}-${intentCounter}`;
  const intent: TransferIntent = {
    id: intentId,
    network,
    to,
    amount,
    token,
    createdAt: Date.now(),
  };
  pendingIntents.set(intentId, intent);

  // Clean old intents (>10 min)
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, i] of pendingIntents) {
    if (i.createdAt < cutoff) pendingIntents.delete(id);
  }

  return ok({
    intentId,
    network,
    to,
    amount,
    token: token ?? "native",
    status: "prepared",
    message: "Use wallet_send_confirm to broadcast this transfer.",
  });
}

// ── wallet_send_confirm ──────────────────────────────────────────

export async function handleWalletSendConfirm(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const network = str(params, "network") as "eip155" | "solana";
  const intentId = str(params, "intentId");

  if (!network || !intentId) {
    return fail("Missing required: network, intentId");
  }

  const intent = pendingIntents.get(intentId);
  if (!intent) {
    return fail(`Intent not found: ${intentId}. It may have expired (10 min TTL) or was already used.`);
  }

  if (intent.network !== network) {
    return fail(`Network mismatch: intent is ${intent.network}, got ${network}`);
  }

  // Approval gate — mutating tool, requires approval in restricted/off mode
  if (!context.approved && context.loopMode !== "full") {
    // DON'T delete intent — must survive until approval retry
    return {
      success: false,
      output: `Transfer requires approval in ${context.loopMode} mode. Use the approval flow to confirm.`,
      pendingApproval: true,
    };
  }

  // Remove intent (one-time use) — only after approval check passes
  pendingIntents.delete(intentId);

  if (network === "solana") {
    return executeSolanaTransfer(intent);
  }

  return executeEvmTransfer(intent);
}

// ── Solana transfer execution ────────────────────────────────────

async function executeSolanaTransfer(intent: TransferIntent): Promise<ToolResult> {
  const wallet = requireSolanaWallet();
  const keypair = Keypair.fromSecretKey(wallet.secretKey);

  if (!intent.token || intent.token === "native" || intent.token.toUpperCase() === "SOL") {
    // Native SOL transfer
    const lamports = BigInt(Math.round(Number(intent.amount) * 1e9));
    const result = await sendSol({ from: keypair, to: intent.to, lamports });
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "transfer",
          chain: "solana",
          status: "executed",
          inputToken: "SOL",
          inputAmount: intent.amount,
          outputToken: "SOL",
          outputAmount: intent.amount,
          signature: result.signature,
        },
      },
    };
  }

  // SPL token transfer
  let tokenMeta;
  try {
    tokenMeta = await resolveJupiterToken(intent.token);
  } catch {
    // resolveJupiterToken may throw if JUPITER_API_KEY is missing
  }
  if (!tokenMeta) {
    return fail(`Token not found: ${intent.token}`);
  }

  const atomicAmount = BigInt(Math.round(Number(intent.amount) * 10 ** tokenMeta.decimals));
  const result = await sendSplToken({
    from: keypair,
    to: intent.to,
    mint: tokenMeta.address,
    amount: atomicAmount,
    decimals: tokenMeta.decimals,
  });

  return {
    success: true,
    output: JSON.stringify(result, null, 2),
    data: {
      ...result,
      _tradeCapture: {
        type: "transfer",
        chain: "solana",
        status: "executed",
        inputToken: tokenMeta.symbol,
        inputAmount: intent.amount,
        outputToken: tokenMeta.symbol,
        outputAmount: intent.amount,
        signature: result.signature,
      },
    },
  };
}

// ── EVM transfer execution (0G native) ───────────────────────────

async function executeEvmTransfer(intent: TransferIntent): Promise<ToolResult> {
  const wallet = requireEvmWallet();
  const client = getSigningClient(wallet.privateKey);

  // Native transfer only (ERC-20 transfers would need token contract interaction)
  const value = parseUnits(intent.amount, 18);

  const hash = await client.sendTransaction({
    to: intent.to as Address,
    value,
  });

  // Wait for receipt
  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return {
    success: true,
    output: JSON.stringify({
      txHash: hash,
      status: receipt.status === "success" ? "confirmed" : "failed",
      blockNumber: Number(receipt.blockNumber),
    }, null, 2),
    data: {
      txHash: hash,
      _tradeCapture: {
        type: "transfer",
        chain: "0g",
        status: "executed",
        inputToken: "0G",
        inputAmount: intent.amount,
        outputToken: "0G",
        outputAmount: intent.amount,
        signature: hash,
      },
    },
  };
}
