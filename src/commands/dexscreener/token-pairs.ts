import { Command } from "commander";
import { getDexScreenerClient } from "../../dexscreener/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import { formatPairRow, PAIR_COLUMNS } from "./helpers.js";

export function createTokenPairsSubcommand(): Command {
  return new Command("token-pairs")
    .description("Get all trading pools for a specific token")
    .argument("<chainId>", "Chain identifier (e.g. solana, ethereum, bsc)")
    .argument("<tokenAddress>", "Token contract address")
    .action(async (chainId: string, tokenAddress: string) => {
      const client = getDexScreenerClient();
      const pairs = await client.getTokenPairs(chainId, tokenAddress);

      if (isHeadless()) {
        writeJsonSuccess({ pairs, count: pairs.length });
        return;
      }

      if (pairs.length === 0) {
        process.stderr.write(`No pools found for ${tokenAddress} on ${chainId}\n`);
        return;
      }

      process.stderr.write(colors.info(`Found ${pairs.length} pools for token on ${chainId}\n\n`));
      printTable(PAIR_COLUMNS, pairs.slice(0, 25).map(formatPairRow));
    });
}
