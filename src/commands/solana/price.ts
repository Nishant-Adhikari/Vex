/**
 * Solana price lookup — Jupiter Price V3 API.
 * Standalone price query (Khalani gives prices only in balance context).
 */

import { Command } from "commander";
import { getJupiterPricesForTokenQueries } from "../../tools/solana-ecosystem/jupiter/jupiter-prices/service.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { shortenSolanaAddress } from "../../tools/solana-ecosystem/shared/solana-validation.js";

function formatPrice(price: number): string {
  if (price < 0.0001) return `$${price.toFixed(10)}`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  if (price < 1) return `$${price.toFixed(4)}`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function createPriceSubcommand(): Command {
  return new Command("price")
    .description("Get token prices (Jupiter Price V3)")
    .argument("<tokens...>", "Token symbols or mint addresses (1 or more)")
    .exitOverride()
    .action(async (tokens: string[]) => {
      const spin = spinner(`Fetching prices for ${tokens.length} token(s)...`);
      spin.start();

      try {
        const batch = await getJupiterPricesForTokenQueries(tokens);

        spin.succeed(`Prices for ${batch.resolved.length} token(s)`);

        const results = batch.resolved.map((r) => ({
          query: r.query,
          symbol: r.token?.symbol ?? r.query,
          mint: r.mint,
          priceUsd: r.price?.usdPrice ?? null,
          liquidity: r.price?.liquidity ?? null,
          priceChange24h: r.price?.priceChange24h ?? null,
          decimals: r.price?.decimals ?? null,
        }));

        if (isHeadless()) {
          writeJsonSuccess({ resolved: batch.resolved, raw: batch.raw });
          return;
        }

        printTable(
          [
            { header: "Token", width: 10 },
            { header: "Mint", width: 14 },
            { header: "Price USD", width: 18 },
          ],
          results.map((r) => [
            r.symbol,
            shortenSolanaAddress(r.mint),
            r.priceUsd != null ? formatPrice(r.priceUsd) : colors.muted("N/A"),
          ]),
        );
      } catch (err) {
        spin.fail("Price fetch failed");
        throw err;
      }
    });
}
