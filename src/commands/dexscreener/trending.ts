import { Command } from "commander";
import { getDexScreenerClient } from "../../tools/dexscreener/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import type { TableColumn } from "../../utils/ui.js";
import type { DexTrendingItem } from "../../tools/dexscreener/types.js";

const TRENDING_COLUMNS: TableColumn[] = [
  { header: "Chain", width: 12 },
  { header: "Address", width: 20 },
  { header: "Boost", width: 10 },
  { header: "Profile", width: 8 },
  { header: "Description", width: 40 },
];

export function createTrendingSubcommand(): Command {
  return new Command("trending")
    .description("Unified trending view (profiles + boosts combined)")
    .option("--limit <n>", "Max items to return", "50")
    .action(async (options: { limit: string }) => {
      const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
      const client = getDexScreenerClient();

      // Fetch profiles and boosts in parallel
      const [profiles, boosts] = await Promise.all([
        client.getProfiles(),
        client.getBoosts(),
      ]);

      // Build map keyed by chainId:tokenAddress
      const map = new Map<string, DexTrendingItem>();

      for (const b of boosts) {
        const key = `${b.chainId}:${b.tokenAddress}`;
        map.set(key, {
          chainId: b.chainId,
          tokenAddress: b.tokenAddress,
          url: b.url,
          icon: b.icon,
          header: b.header,
          description: b.description,
          links: b.links,
          boostAmount: b.amount,
          boostTotalAmount: b.totalAmount,
          hasProfile: false,
        });
      }

      for (const p of profiles) {
        const key = `${p.chainId}:${p.tokenAddress}`;
        const existing = map.get(key);
        if (existing) {
          existing.hasProfile = true;
          existing.icon = existing.icon ?? p.icon;
          existing.description = existing.description ?? p.description;
          existing.links = existing.links ?? p.links;
        } else {
          map.set(key, {
            chainId: p.chainId,
            tokenAddress: p.tokenAddress,
            url: p.url,
            icon: p.icon,
            header: p.header,
            description: p.description,
            links: p.links,
            boostAmount: 0,
            boostTotalAmount: 0,
            hasProfile: true,
          });
        }
      }

      // Sort: highest boost first, then profile presence
      const items = [...map.values()]
        .sort((a, b) => b.boostTotalAmount - a.boostTotalAmount || (b.hasProfile ? 1 : 0) - (a.hasProfile ? 1 : 0))
        .slice(0, limit);

      if (isHeadless()) {
        writeJsonSuccess({ items, count: items.length });
        return;
      }

      if (items.length === 0) {
        process.stderr.write("No trending tokens found\n");
        return;
      }

      process.stderr.write(colors.info(`Trending: ${items.length} tokens (profiles + boosts)\n\n`));

      const rows = items.slice(0, 30).map(item => [
        item.chainId,
        item.tokenAddress.slice(0, 18) + "...",
        item.boostTotalAmount > 0 ? String(item.boostTotalAmount) : "-",
        item.hasProfile ? colors.success("Yes") : colors.muted("No"),
        (item.description ?? "-").slice(0, 38),
      ]);

      printTable(TRENDING_COLUMNS, rows);
    });
}
