import { Command } from "commander";
import { getDexScreenerClient } from "../../dexscreener/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import { formatPairRow, PAIR_COLUMNS } from "./helpers.js";

export function createSearchSubcommand(): Command {
  return new Command("search")
    .description("Search DEX pairs across all chains")
    .argument("<query>", "Token name, symbol, pair address, or token address")
    .action(async (query: string) => {
      const client = getDexScreenerClient();
      const result = await client.search(query);

      if (isHeadless()) {
        writeJsonSuccess({ pairs: result.pairs, count: result.pairs.length });
        return;
      }

      if (result.pairs.length === 0) {
        process.stderr.write(`No pairs found for "${query}"\n`);
        return;
      }

      process.stderr.write(colors.info(`Found ${result.pairs.length} pairs for "${query}"\n\n`));
      printTable(PAIR_COLUMNS, result.pairs.slice(0, 25).map(formatPairRow));
    });
}
