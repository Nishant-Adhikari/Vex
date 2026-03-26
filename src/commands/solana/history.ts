/**
 * Solana spot trade history — Jupiter Datapi.
 * Shows swap history with input/output tokens and USD values.
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../tools/wallet/multi-auth.js";
import { jupiterGetSpotHistory, type SpotTrade } from "../../tools/chains/solana/jupiter-client.js";
import { resolveToken, resolveTokens } from "../../tools/chains/solana/token-registry.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, printTable, colors, infoBox } from "../../utils/ui.js";

function parseTimestamp(value: string): string {
  if (/^\d+$/.test(value)) return new Date(Number(value) * 1000).toISOString();
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) throw new Error(`Invalid date: ${value}`);
  return new Date(ms).toISOString();
}

export function createHistorySubcommand(): Command {
  return new Command("history")
    .description("View swap trade history (Jupiter Datapi)")
    .option("--address <addr>", "Wallet address")
    .option("--token <token>", "Filter by token symbol or mint")
    .option("--after <date>", "Show trades after date or UNIX timestamp")
    .option("--before <date>", "Show trades before date or UNIX timestamp")
    .option("--limit <n>", "Max results", "10")
    .option("--offset <offset>", "Pagination offset from previous response")
    .exitOverride()
    .action(async (options: {
      address?: string;
      token?: string;
      after?: string;
      before?: string;
      limit: string;
      offset?: string;
    }) => {
      const address = options.address ?? requireSolanaWallet().address;
      const limit = Number(options.limit);

      let assetId: string | undefined;
      if (options.token) {
        const token = await resolveToken(options.token);
        if (token) assetId = token.address;
      }

      const spin = spinner("Loading trade history...");
      spin.start();

      const { userTrades, next } = await jupiterGetSpotHistory({
        address,
        assetId,
        after: options.after ? parseTimestamp(options.after) : undefined,
        before: options.before ? parseTimestamp(options.before) : undefined,
        limit,
        offset: options.offset,
      });

      // Group double-bookkeeping entries by txHash
      const grouped = new Map<string, SpotTrade[]>();
      for (const t of userTrades) {
        const existing = grouped.get(t.txHash);
        if (existing) existing.push(t);
        else grouped.set(t.txHash, [t]);
      }

      // Resolve token metadata for display
      const mints = [...new Set(userTrades.map((t) => t.assetId))];
      const tokenMap = mints.length > 0 ? await resolveTokens(mints) : new Map();

      const trades = [...grouped.values()]
        .map((entries) => {
          const sell = entries.find((e) => e.type === "sell");
          const buy = entries.find((e) => e.type === "buy");
          return {
            time: (sell ?? buy)!.blockTime,
            inputToken: sell ? tokenMap.get(sell.assetId)?.symbol ?? sell.assetId.slice(0, 8) : null,
            outputToken: buy ? tokenMap.get(buy.assetId)?.symbol ?? buy.assetId.slice(0, 8) : null,
            inAmount: sell ? String(sell.amount) : null,
            outAmount: buy ? String(buy.amount) : null,
            inUsdValue: sell ? sell.usdVolume : null,
            outUsdValue: buy ? buy.usdVolume : null,
            signature: (sell ?? buy)!.txHash,
          };
        })
        .slice(0, limit);

      spin.succeed(`${trades.length} trade(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ trades, next });
        return;
      }

      if (trades.length === 0) {
        infoBox("Trade History", "No trades found.");
        return;
      }

      printTable(
        [
          { header: "Time", width: 18 },
          { header: "Input", width: 24 },
          { header: "Output", width: 24 },
          { header: "Tx", width: 14 },
        ],
        trades.map((t) => [
          new Date(t.time).toLocaleString(),
          t.inAmount
            ? `${t.inAmount} ${t.inputToken ?? "?"} ($${(t.inUsdValue ?? 0).toFixed(2)})`
            : colors.muted("—"),
          t.outAmount
            ? `${t.outAmount} ${t.outputToken ?? "?"} ($${(t.outUsdValue ?? 0).toFixed(2)})`
            : colors.muted("—"),
          `${t.signature.slice(0, 4)}...${t.signature.slice(-4)}`,
        ]),
      );

      if (next) {
        process.stderr.write(`\n  Next page: --offset ${next}\n`);
      }
    });
}
