import { Command } from "commander";
import { getDexScreenerClient } from "../../tools/dexscreener/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import type { TableColumn } from "../../utils/ui.js";

const BOOST_COLUMNS: TableColumn[] = [
  { header: "Chain", width: 12 },
  { header: "Address", width: 20 },
  { header: "Amount", width: 12 },
  { header: "Total", width: 12 },
  { header: "Description", width: 36 },
];

export function createBoostsSubcommand(): Command {
  return new Command("boosts")
    .description("Get latest or top boosted tokens")
    .option("--top", "Show tokens with most active boosts instead of latest")
    .action(async (options: { top?: boolean }) => {
      const client = getDexScreenerClient();
      const boosts = options.top
        ? await client.getTopBoosts()
        : await client.getBoosts();

      if (isHeadless()) {
        writeJsonSuccess({ boosts, count: boosts.length, mode: options.top ? "top" : "latest" });
        return;
      }

      if (boosts.length === 0) {
        process.stderr.write("No boosted tokens found\n");
        return;
      }

      const label = options.top ? "Top" : "Latest";
      process.stderr.write(colors.info(`${label} ${boosts.length} boosted tokens\n\n`));

      const rows = boosts.slice(0, 30).map(b => [
        b.chainId,
        b.tokenAddress.slice(0, 18) + "...",
        String(b.amount),
        String(b.totalAmount),
        (b.description ?? "-").slice(0, 34),
      ]);

      printTable(BOOST_COLUMNS, rows);
    });
}
