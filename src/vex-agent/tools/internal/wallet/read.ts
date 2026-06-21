/**
 * Wallet read handler — live balance snapshot for configured wallets.
 */

import { z } from "zod";
import { resolveSelectedAddressForRead } from "./resolve.js";
import {
  type BalanceChainSelection,
  getSelectedChainIdsForFamily,
  getTokenBalancesAcrossChains,
  parseBalanceChainSelection,
} from "@tools/khalani/balances.js";
import type { ChainFamily } from "@tools/khalani/types.js";
import {
  type ConciseKhalaniToken,
  projectTokens,
} from "../../protocols/khalani/projectors.js";

import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { fail, ok } from "../types.js";

const WalletReadArgs = z.object({
  wallet: z.enum(["eip155", "solana", "all"]).optional().default("all"),
  // Empty / whitespace-only `chainIds` is treated as omission (scan all chains).
  // LLM serializers often emit `""` for "no value" — see plan PR-balance-toolkit.
  chainIds: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().min(1, { message: "chainIds must be a non-empty comma-separated string" }).optional(),
  ),
  // Optional cap on the number of tokens returned per wallet snapshot. Only
  // applied when response_format is 'concise' (see below); ignored in the
  // compatibility-first 'detailed' default so existing callers keep every row.
  limit: z.number().int().positive().optional(),
  // 'detailed' (DEFAULT, compatibility-first) returns every projected token.
  // 'concise' enables the `limit` trim to the top-N tokens by held USD value.
  response_format: z.enum(["concise", "detailed"]).optional().default("detailed"),
}).strict();

interface WalletSnapshot {
  wallet: ChainFamily;
  address: string;
  tokenCount: number;
  totalUsd: number;
  scannedChainIds: number[];
  chainErrors: Array<{ chainId: number; chainName?: string; message: string }>;
  tokens: ConciseKhalaniToken[];
}

// ── wallet_balances ─────────────────────────────────────────────

export async function handleWalletBalances(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = WalletReadArgs.safeParse(params);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return fail(`wallet_balances: ${firstIssue?.message ?? "invalid arguments"}`);
  }

  let selection: BalanceChainSelection;
  try {
    selection = await parseBalanceChainSelection(parsed.data.chainIds);
  } catch (err) {
    return fail(`wallet_balances: ${err instanceof Error ? err.message : String(err)}`);
  }
  const walletFamilies = requestedWalletFamilies(parsed.data.wallet);
  const snapshots: WalletSnapshot[] = [];
  const walletErrors: Array<{ wallet: ChainFamily; message: string }> = [];

  for (const family of walletFamilies) {
    const chainIds = getSelectedChainIdsForFamily(selection, family);
    if (selection.rawProvided && chainIds?.length === 0) {
      if (parsed.data.wallet === family) {
        return fail(`wallet_balances: no ${family} chains matched chainIds="${parsed.data.chainIds}".`);
      }
      continue;
    }

    try {
      const address = resolveSelectedAddressForRead(context.walletResolution, context.walletPolicy, family);
      // Live read: opt into the EVM native-coin top-up. The sync/projection path
      // (syncWalletBalances) deliberately does NOT, to avoid deleting cached
      // native rows on a transient RPC failure.
      const scan = await getTokenBalancesAcrossChains({ address, family, chainIds, includeNative: true });
      // Slim each row at the handler seam (P1-7): reuse the Khalani projector so
      // the model sees identity + lifted priceUsd/balance, not the heavy logoURI
      // / open `extensions` bag. `tokenCount` / `totalUsd` stay computed off the
      // FULL scan so an optional `limit` trim never distorts the held totals.
      const projected = projectTokens(scan.tokens);
      snapshots.push({
        wallet: family,
        address,
        tokenCount: scan.tokens.length,
        totalUsd: scan.totalUsd,
        scannedChainIds: scan.scannedChainIds,
        chainErrors: scan.chainErrors,
        tokens: trimTokens(projected, parsed.data.limit, parsed.data.response_format),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (parsed.data.wallet === family) {
        return fail(`${family} wallet error: ${message}`);
      }
      walletErrors.push({ wallet: family, message });
    }
  }

  if (snapshots.length === 0) {
    return fail(`wallet_balances: no requested wallet snapshots were available.${formatWalletErrors(walletErrors)}`);
  }

  return ok({
    wallet: parsed.data.wallet,
    walletCount: snapshots.length,
    totalUsd: snapshots.reduce((sum, snapshot) => sum + snapshot.totalUsd, 0),
    walletErrors,
    wallets: snapshots,
  });
}

function requestedWalletFamilies(wallet: "eip155" | "solana" | "all"): ChainFamily[] {
  if (wallet === "all") return ["eip155", "solana"];
  return [wallet];
}

/**
 * Held USD value of a projected token row: `balance × priceUsd`, normalised to a
 * smallest-unit → human conversion (mirrors the canonical `tokenUsd` used for
 * `totalUsd`). Missing / malformed price or balance is null-safe → `0`, so a
 * row with no price/balance signal sorts last rather than throwing.
 */
function projectedTokenUsd(token: ConciseKhalaniToken): number {
  const { balance, priceUsd, decimals } = token;
  if (!balance || !priceUsd) return 0;
  try {
    const balanceHuman = Number(BigInt(balance)) / Math.pow(10, decimals);
    const price = Number(priceUsd);
    if (!Number.isFinite(balanceHuman) || !Number.isFinite(price)) return 0;
    return balanceHuman * price;
  } catch {
    return 0;
  }
}

/**
 * Optionally trim a projected token list to the top-N by held USD value.
 *
 * Compatibility-first: a trim only happens when `response_format` is 'concise'
 * AND a positive `limit` was supplied. The default 'detailed' format (or an
 * omitted `limit`) returns every row untouched, so existing callers are
 * unaffected. The sort is a stable copy (no in-place mutation of the input).
 */
function trimTokens(
  tokens: ConciseKhalaniToken[],
  limit: number | undefined,
  responseFormat: "concise" | "detailed",
): ConciseKhalaniToken[] {
  if (responseFormat === "detailed" || limit === undefined) return tokens;
  return [...tokens]
    .sort((a, b) => projectedTokenUsd(b) - projectedTokenUsd(a))
    .slice(0, limit);
}

function formatWalletErrors(errors: Array<{ wallet: ChainFamily; message: string }>): string {
  if (errors.length === 0) return "";
  return ` Errors: ${errors.map((entry) => `${entry.wallet}: ${entry.message}`).join("; ")}`;
}
