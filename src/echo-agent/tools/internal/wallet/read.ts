/**
 * Wallet read handler — address + multi-chain token balances.
 */

import { requireEvmWallet, requireSolanaWallet } from "@tools/wallet/multi-auth.js";
import { normalizeWalletChain } from "@tools/wallet/family.js";

import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { str } from "../types.js";

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

// ── wallet_read ─────────���────────────────────────────────────────

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
    const { getKhalaniClient } = await import("@tools/khalani/client.js");
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
