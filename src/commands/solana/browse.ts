/**
 * Browse trending/top Solana tokens via Jupiter Tokens API V2.
 * This is the one discovery feature Khalani does NOT cover.
 */

import { Command } from "commander";
import {
  getJupiterTokensByCategory,
  getJupiterTokensByTag,
  getJupiterRecentTokens,
} from "../../tools/solana-ecosystem/jupiter/jupiter-tokens/service.js";
import type {
  JupiterMintInformation,
  JupiterTokenCategory,
  JupiterTokenTag,
  JupiterTokenInterval,
} from "../../tools/solana-ecosystem/jupiter/jupiter-tokens/types.js";
import { jupiterMintInformationToMetadata } from "../../tools/solana-ecosystem/jupiter/jupiter-tokens/types.js";
import { cacheSolanaTokens } from "../../tools/solana-ecosystem/shared/solana-token-cache.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

type Category = "trending" | "top-traded" | "top-organic" | "recent" | "lst" | "verified";

const CATEGORY_CATEGORIES: Record<string, JupiterTokenCategory> = {
  trending: "toptrending",
  "top-traded": "toptraded",
  "top-organic": "toporganicscore",
};

const TAG_CATEGORIES: Record<string, JupiterTokenTag> = {
  lst: "lst",
  verified: "verified",
};

const ALL_CATEGORIES = new Set<string>([
  ...Object.keys(CATEGORY_CATEGORIES),
  ...Object.keys(TAG_CATEGORIES),
  "recent",
]);

function formatPrice(price?: number | null): string {
  if (price == null) return "-";
  if (price < 0.01) return `$${price.toFixed(8)}`;
  if (price < 1) return `$${price.toFixed(4)}`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatVolume(vol?: number | null): string {
  if (vol == null) return "-";
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

async function fetchTokens(
  cat: Category,
  interval: JupiterTokenInterval,
  limit: number,
): Promise<JupiterMintInformation[]> {
  if (cat in CATEGORY_CATEGORIES) {
    return getJupiterTokensByCategory({
      category: CATEGORY_CATEGORIES[cat],
      interval,
      limit,
    });
  }
  if (cat in TAG_CATEGORIES) {
    return getJupiterTokensByTag(TAG_CATEGORIES[cat]);
  }
  if (cat === "recent") {
    return getJupiterRecentTokens();
  }
  throw new EchoError(
    ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
    `Unknown category: ${cat}`,
    `Available: ${[...ALL_CATEGORIES].join(", ")}`,
  );
}

export function createBrowseSubcommand(): Command {
  return new Command("browse")
    .description("Browse trending and top Solana tokens (Jupiter)")
    .argument("[category]", "Category: trending | top-traded | top-organic | recent | lst | verified", "trending")
    .option("--interval <interval>", "Time window: 5m | 1h | 6h | 24h", "1h")
    .option("--limit <n>", "Number of results", "20")
    .exitOverride()
    .action(async (category: string, options: { interval: string; limit: string }) => {
      const cat = category as Category;
      if (!ALL_CATEGORIES.has(cat)) {
        throw new EchoError(
          ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
          `Unknown category: ${cat}`,
          `Available: ${[...ALL_CATEGORIES].join(", ")}`,
        );
      }

      const interval = options.interval as JupiterTokenInterval;
      const limit = Number(options.limit) || 20;

      const spin = spinner(`Fetching ${cat} tokens...`);
      spin.start();

      try {
        const tokens = await fetchTokens(cat, interval, limit);

        // Cache resolved tokens for use by swap/transfer commands
        cacheSolanaTokens(tokens.map(jupiterMintInformationToMetadata));

        spin.succeed(`Found ${tokens.length} ${cat} tokens`);

        if (isHeadless()) {
          writeJsonSuccess({ category: cat, interval, tokens });
          return;
        }

        if (tokens.length === 0) {
          process.stderr.write(colors.muted("  No tokens found for this category.\n"));
          return;
        }

        const getVolume = (t: JupiterMintInformation): number | undefined => {
          if (!t.stats24h) return undefined;
          return (t.stats24h.buyVolume ?? 0) + (t.stats24h.sellVolume ?? 0);
        };

        printTable(
          [
            { header: "#", width: 4 },
            { header: "Symbol", width: 10 },
            { header: "Name", width: 20 },
            { header: "Mint", width: 14 },
            { header: "Price", width: 14 },
            { header: "Volume 24h", width: 12 },
          ],
          tokens.map((t: JupiterMintInformation, i: number) => [
            String(i + 1),
            t.symbol,
            t.name.length > 18 ? `${t.name.slice(0, 17)}…` : t.name,
            `${t.id.slice(0, 4)}…${t.id.slice(-4)}`,
            formatPrice(t.usdPrice),
            formatVolume(getVolume(t)),
          ]),
        );
      } catch (err) {
        spin.fail("Failed to fetch tokens");
        if (err instanceof EchoError) throw err;
        throw new EchoError(
          ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
          `Failed to fetch ${cat} tokens: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
}
