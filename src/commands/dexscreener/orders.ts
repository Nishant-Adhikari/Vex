import { Command } from "commander";
import { getDexScreenerClient } from "../../dexscreener/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import type { TableColumn } from "../../utils/ui.js";

const ORDER_COLUMNS: TableColumn[] = [
  { header: "Type", width: 22 },
  { header: "Status", width: 14 },
  { header: "Payment Date", width: 24 },
];

export function createOrdersSubcommand(): Command {
  return new Command("orders")
    .description("Check paid orders for a token")
    .argument("<chainId>", "Chain identifier (e.g. solana, ethereum, bsc)")
    .argument("<tokenAddress>", "Token contract address")
    .action(async (chainId: string, tokenAddress: string) => {
      const client = getDexScreenerClient();
      const orders = await client.getOrders(chainId, tokenAddress);

      if (isHeadless()) {
        writeJsonSuccess({ orders, count: orders.length, chainId, tokenAddress });
        return;
      }

      if (orders.length === 0) {
        process.stderr.write(`No paid orders found for ${tokenAddress} on ${chainId}\n`);
        return;
      }

      process.stderr.write(colors.info(`Found ${orders.length} orders for ${tokenAddress} on ${chainId}\n\n`));

      const rows = orders.map(o => [
        o.type,
        o.status,
        new Date(o.paymentTimestamp * 1000).toISOString(),
      ]);

      printTable(ORDER_COLUMNS, rows);
    });
}
