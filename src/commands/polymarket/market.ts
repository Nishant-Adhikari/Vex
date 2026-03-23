/**
 * `echoclaw polymarket market/orderbook/price/history` — market data.
 */

import { Command } from "commander";
import { getPolyGammaClient } from "../../polymarket/gamma/client.js";
import { getPolyClobClient } from "../../polymarket/clob/client.js";
import { parseOutcomePrices, parseClobTokenIds, formatUsd, formatProbability } from "./helpers.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, infoBox, colors } from "../../utils/ui.js";

export function createMarketSubcommand(): Command {
  return new Command("market")
    .description("Get Polymarket market details with orderbook and prices")
    .argument("<id-or-slug>", "Market ID, condition ID, or slug")
    .exitOverride()
    .action(async (idOrSlug: string) => {
      const gamma = getPolyGammaClient();
      const spin = spinner("Fetching market...");
      spin.start();

      const isNumeric = /^\d+$/.test(idOrSlug);
      const market = isNumeric ? await gamma.getMarket(idOrSlug) : await gamma.getMarketBySlug(idOrSlug);
      spin.succeed("Market loaded");

      if (isHeadless()) {
        writeJsonSuccess({ market });
        return;
      }

      const prices = parseOutcomePrices(market.outcomePrices);
      const tokens = parseClobTokenIds(market.clobTokenIds);

      infoBox(`Market: ${market.question ?? idOrSlug}`, [
        `Condition ID: ${colors.muted(market.conditionId)}`,
        `Status: ${market.active ? colors.value("Active") : market.closed ? colors.error("Closed") : colors.muted("Inactive")}`,
        `Accepting Orders: ${market.acceptingOrders ? "Yes" : "No"}`,
        "",
        `YES: ${formatProbability(prices.yes)} | NO: ${formatProbability(prices.no)}`,
        `Best Bid: ${market.bestBid ?? "—"} | Best Ask: ${market.bestAsk ?? "—"} | Spread: ${market.spread?.toFixed(3) ?? "—"}`,
        `Last Trade: ${market.lastTradePrice ?? "—"} | 24h Change: ${market.oneDayPriceChange != null ? `${(market.oneDayPriceChange * 100).toFixed(1)}%` : "—"}`,
        "",
        `Volume: ${formatUsd(market.volumeNum)} | Liquidity: ${formatUsd(market.liquidityNum)}`,
        `Tick Size: ${market.orderPriceMinTickSize ?? "—"} | Min Order: ${market.orderMinSize ?? "—"}`,
        `Neg Risk: ${market.negRisk ? "Yes" : "No"}`,
        "",
        `Token YES: ${colors.muted(tokens.yes || "—")}`,
        `Token NO:  ${colors.muted(tokens.no || "—")}`,
      ].join("\n"));
    });
}

export function createOrderbookSubcommand(): Command {
  return new Command("orderbook")
    .description("Get full orderbook for a token")
    .argument("<token-id>", "CLOB token ID")
    .exitOverride()
    .action(async (tokenId: string) => {
      const clob = getPolyClobClient();
      const spin = spinner("Fetching orderbook...");
      spin.start();

      const book = await clob.getOrderBook(tokenId);
      spin.succeed("Orderbook loaded");

      if (isHeadless()) {
        writeJsonSuccess({ ...book });
        return;
      }

      const bids = book.bids.slice(0, 10).map(b => `  ${b.price.padEnd(8)} ${b.size}`).join("\n");
      const asks = book.asks.slice(0, 10).map(a => `  ${a.price.padEnd(8)} ${a.size}`).join("\n");

      infoBox("Orderbook", [
        `Market: ${book.market}`,
        `Last Trade: ${book.last_trade_price} | Tick: ${book.tick_size} | Min Size: ${book.min_order_size}`,
        "",
        colors.value("BIDS (Buy)"),
        `  ${"Price".padEnd(8)} Size`,
        bids || "  (empty)",
        "",
        colors.error("ASKS (Sell)"),
        `  ${"Price".padEnd(8)} Size`,
        asks || "  (empty)",
      ].join("\n"));
    });
}

export function createHistorySubcommand(): Command {
  return new Command("history")
    .description("Get price history for a market")
    .argument("<token-id>", "CLOB token ID or market asset ID")
    .option("--interval <interval>", "Time interval (1h|6h|1d|1w|1m|all)", "1d")
    .option("--fidelity <min>", "Fidelity in minutes")
    .exitOverride()
    .action(async (tokenId: string, options: { interval: string; fidelity?: string }) => {
      const clob = getPolyClobClient();
      const spin = spinner("Fetching price history...");
      spin.start();

      const history = await clob.getPriceHistory(tokenId, {
        interval: options.interval,
        fidelity: options.fidelity ? parseInt(options.fidelity, 10) : undefined,
      });

      spin.succeed(`Loaded ${history.history.length} data points`);

      if (isHeadless()) {
        writeJsonSuccess({ history: history.history });
        return;
      }

      if (history.history.length === 0) {
        infoBox("Price History", "No data available.");
        return;
      }

      const latest = history.history[history.history.length - 1];
      const oldest = history.history[0];
      infoBox("Price History", [
        `Points: ${history.history.length}`,
        `Range: ${new Date(oldest.t * 1000).toISOString().slice(0, 10)} → ${new Date(latest.t * 1000).toISOString().slice(0, 10)}`,
        `Latest Price: ${formatProbability(latest.p)}`,
      ].join("\n"));
    });
}
