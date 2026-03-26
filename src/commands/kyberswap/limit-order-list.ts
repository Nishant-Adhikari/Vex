/**
 * `echoclaw kyberswap limit-order list` — list your limit orders.
 */

import { Command } from "commander";
import { getKyberLimitOrderClient } from "../../tools/kyberswap/limit-order/client.js";
import { resolveChain, requireFeature } from "./helpers.js";
import { slugToChainId } from "../../tools/kyberswap/chains.js";
import { requireWalletAndKeystore } from "../../tools/wallet/auth.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, infoBox, colors } from "../../utils/ui.js";

export function createLimitOrderListAction(): Command {
  return new Command("list")
    .description("List your KyberSwap limit orders")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .option("--status <status>", "Filter by status (active, filled, cancelled, expired)")
    .exitOverride()
    .action(async (options: { chain: string; status?: string }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "limitOrder");
      const chainId = slugToChainId(slug);

      const { address } = requireWalletAndKeystore();
      const client = getKyberLimitOrderClient();

      const spin = spinner("Fetching orders...");
      spin.start();

      const orders = await client.getOrders({
        chainId: String(chainId),
        maker: address,
        status: options.status,
      });

      spin.succeed(`Found ${orders.length} order(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ orders, chain: slug, chainId });
        return;
      }

      if (orders.length === 0) {
        infoBox("Limit Orders", `No orders found on ${slug}`);
        return;
      }

      const lines = orders.map((o) => {
        const statusColor = o.status === "active" ? colors.value : o.status === "filled" ? colors.info : colors.muted;
        return [
          `#${o.id} ${statusColor(o.status)}`,
          `  Sell: ${o.makingAmount} ${o.makerAssetSymbol ?? o.makerAsset}`,
          `  For:  ${o.takingAmount} ${o.takerAssetSymbol ?? o.takerAsset}`,
          `  Filled: ${o.filledMakingAmount}/${o.makingAmount}`,
          `  Expires: ${new Date(o.expiredAt * 1000).toISOString()}`,
        ].join("\n");
      });

      infoBox(`Limit Orders on ${slug}`, lines.join("\n\n"));
    });
}
