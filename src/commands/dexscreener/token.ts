import { Command } from "commander";
import { getDexScreenerClient } from "../../tools/dexscreener/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import { formatPairRow, PAIR_COLUMNS } from "./helpers.js";

export function createTokenSubcommand(): Command {
  return new Command("token")
    .description("Get token data by chain and address (up to 30 comma-separated)")
    .argument("<chainId>", "Chain identifier (e.g. solana, ethereum, bsc)")
    .argument("<tokenAddresses>", "One or more token addresses, comma-separated (max 30)")
    .action(async (chainId: string, tokenAddresses: string) => {
      const client = getDexScreenerClient();
      const pairs = await client.getTokens(chainId, tokenAddresses);

      if (isHeadless()) {
        writeJsonSuccess({ pairs, count: pairs.length });
        return;
      }

      if (pairs.length === 0) {
        process.stderr.write(`No data found for tokens on ${chainId}\n`);
        return;
      }

      process.stderr.write(colors.info(`Found ${pairs.length} pairs for token(s) on ${chainId}\n\n`));
      printTable(PAIR_COLUMNS, pairs.slice(0, 25).map(formatPairRow));
    });
}
