import { Command } from "commander";
import { getDexScreenerClient } from "../../tools/dexscreener/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import { formatPairRow, PAIR_COLUMNS } from "./helpers.js";

export function createPairsSubcommand(): Command {
  return new Command("pairs")
    .description("Get pair details by chain and pair address")
    .argument("<chainId>", "Chain identifier (e.g. solana, ethereum, bsc)")
    .argument("<pairId>", "Pair contract address")
    .action(async (chainId: string, pairId: string) => {
      const client = getDexScreenerClient();
      const result = await client.getPairs(chainId, pairId);

      if (isHeadless()) {
        writeJsonSuccess({ pairs: result.pairs, count: result.pairs?.length ?? 0 });
        return;
      }

      if (!result.pairs || result.pairs.length === 0) {
        process.stderr.write(`No pair found for ${chainId}/${pairId}\n`);
        return;
      }

      process.stderr.write(colors.info(`Pair details for ${chainId}/${pairId}\n\n`));
      printTable(PAIR_COLUMNS, result.pairs.map(formatPairRow));
    });
}
