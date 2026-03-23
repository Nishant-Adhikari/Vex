/**
 * `echoclaw polymarket leaderboard/activity` — analytics commands.
 */

import { Command } from "commander";
import { getPolyDataClient } from "../../polymarket/data/client.js";
import { formatUsd } from "./helpers.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, infoBox, colors } from "../../utils/ui.js";
import { parseIntSafe } from "../../utils/validation.js";

export function createLeaderboardSubcommand(): Command {
  return new Command("leaderboard")
    .description("Polymarket trader leaderboard")
    .option("--category <cat>", "Category: OVERALL, POLITICS, SPORTS, CRYPTO, CULTURE, ECONOMICS, TECH")
    .option("--period <period>", "Time period: DAY, WEEK, MONTH, ALL", "WEEK")
    .option("--orderBy <field>", "Order by: PNL, VOL", "PNL")
    .option("--limit <n>", "Max results", "25")
    .exitOverride()
    .action(async (options: { category?: string; period: string; orderBy: string; limit: string }) => {
      const data = getPolyDataClient();
      const spin = spinner("Fetching leaderboard...");
      spin.start();

      const entries = await data.getLeaderboard({
        category: options.category,
        timePeriod: options.period,
        orderBy: options.orderBy,
        limit: parseIntSafe(options.limit, "limit"),
      });

      spin.succeed(`Loaded ${entries.length} traders`);

      if (isHeadless()) {
        writeJsonSuccess({ leaderboard: entries, period: options.period, orderBy: options.orderBy });
        return;
      }

      if (entries.length === 0) {
        infoBox("Leaderboard", "No entries found.");
        return;
      }

      const lines = entries.map((e) => {
        const name = e.userName ?? e.proxyWallet.slice(0, 10) + "...";
        const pnlColor = e.pnl >= 0 ? colors.value : colors.error;
        const badge = e.verifiedBadge ? " ✓" : "";
        return `#${e.rank.padEnd(4)} ${name}${badge}\n      PnL: ${pnlColor(formatUsd(e.pnl))} | Vol: ${formatUsd(e.vol)}`;
      });

      infoBox(`Leaderboard (${options.period}, by ${options.orderBy})`, lines.join("\n"));
    });
}

export function createActivitySubcommand(): Command {
  return new Command("activity")
    .description("View Polymarket trade activity")
    .option("--user <address>", "User address (defaults to own wallet)")
    .option("--type <type>", "Filter: TRADE, SPLIT, MERGE, REDEEM")
    .option("--side <side>", "Filter: BUY, SELL")
    .option("--limit <n>", "Max results", "20")
    .exitOverride()
    .action(async (options: { user?: string; type?: string; side?: string; limit: string }) => {
      let userAddr = options.user;
      if (!userAddr) {
        const { address } = requireWalletAndKeystore();
        userAddr = address;
      }

      const data = getPolyDataClient();
      const spin = spinner("Fetching activity...");
      spin.start();

      const activity = await data.getActivity(userAddr, {
        type: options.type,
        side: options.side,
        limit: parseIntSafe(options.limit, "limit"),
      });

      spin.succeed(`Found ${activity.length} activities`);

      if (isHeadless()) {
        writeJsonSuccess({ activity, user: userAddr });
        return;
      }

      if (activity.length === 0) {
        infoBox("Activity", `No activity for ${userAddr}`);
        return;
      }

      const lines = activity.map((a) => {
        const date = new Date(a.timestamp * 1000).toISOString().slice(0, 16);
        const sideStr = a.side ? ` ${a.side}` : "";
        return `${date} ${a.type}${sideStr} ${a.outcome ?? ""}\n  ${a.title ?? a.conditionId} | ${formatUsd(a.usdcSize)} | ${a.size.toFixed(2)} shares`;
      });

      infoBox(`Activity: ${userAddr.slice(0, 10)}...`, lines.join("\n\n"));
    });
}
