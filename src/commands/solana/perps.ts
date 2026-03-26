/**
 * Jupiter Perps commands — leveraged trading SOL/BTC/ETH.
 * Pattern: matches Jupiter CLI perps command structure.
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../tools/wallet/multi-auth.js";
import {
  getPerpsMarkets,
  getPerpsPositions,
  getPerpsHistory,
  openPerpsPosition,
  closePerpsPosition,
  closeAllPerpsPositions,
  updatePerpsLimitOrder,
  cancelPerpsLimitOrder,
  setPerpsTPSL,
  cancelPerpsTPSL,
} from "../../tools/chains/solana/perps-service.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, infoBox, spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

function fmtUsd(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function createPerpsSubcommand(): Command {
  const perps = new Command("perps")
    .description("Jupiter Perps — leveraged trading SOL/BTC/ETH")
    .exitOverride();

  // --- markets ---
  perps
    .command("markets")
    .description("View perps market stats (SOL, BTC, ETH)")
    .action(async () => {
      const spin = spinner("Loading markets...");
      spin.start();

      const markets = await getPerpsMarkets();
      spin.succeed("Markets loaded");

      if (isHeadless()) {
        writeJsonSuccess({
          markets: markets.map((m) => ({
            asset: m.asset,
            priceUsd: Number(m.price),
            changePct24h: Number(m.priceChange24H),
            highUsd24h: Number(m.priceHigh24H),
            lowUsd24h: Number(m.priceLow24H),
            volumeUsd24h: Number(m.volume),
          })),
        });
        return;
      }

      printTable(
        [
          { header: "Asset", width: 6 },
          { header: "Price", width: 14 },
          { header: "24h Change", width: 12 },
          { header: "24h High", width: 14 },
          { header: "24h Low", width: 14 },
          { header: "Volume", width: 16 },
        ],
        markets.map((m) => [
          m.asset,
          fmtUsd(m.price),
          fmtPct(m.priceChange24H),
          fmtUsd(m.priceHigh24H),
          fmtUsd(m.priceLow24H),
          fmtUsd(m.volume),
        ]),
      );
    });

  // --- positions ---
  perps
    .command("positions")
    .description("View open perps positions and limit orders")
    .option("--address <addr>", "Wallet address to look up")
    .action(async (options: { address?: string }) => {
      const address = options.address ?? requireSolanaWallet().address;
      const spin = spinner("Loading positions...");
      spin.start();

      const { positions, limitOrders } = await getPerpsPositions(address);
      spin.succeed(`${positions.length} position(s), ${limitOrders.length} limit order(s)`);

      if (isHeadless()) {
        writeJsonSuccess({
          positions: positions.map((p) => ({
            positionPubkey: p.positionPubkey,
            asset: p.asset,
            side: p.side,
            leverage: Number(p.leverage),
            sizeUsd: Number(p.sizeUsd),
            entryPriceUsd: Number(p.entryPriceUsd),
            markPriceUsd: Number(p.markPriceUsd),
            pnlUsd: Number(p.pnlAfterFeesUsd),
            pnlPct: Number(p.pnlAfterFeesPct),
            liquidationPriceUsd: Number(p.liquidationPriceUsd),
            tpsl: p.tpslRequests.map((t) => ({
              pubkey: t.positionRequestPubkey,
              type: t.requestType,
              triggerPriceUsd: t.triggerPriceUsd ? Number(t.triggerPriceUsd) : null,
            })),
          })),
          limitOrders: limitOrders.map((o) => ({
            orderPubkey: o.positionRequestPubkey,
            side: o.side,
            sizeUsd: Number(o.sizeUsdDelta),
            triggerPriceUsd: o.triggerPrice ? Number(o.triggerPrice) : null,
          })),
        });
        return;
      }

      if (positions.length > 0) {
        printTable(
          [
            { header: "Asset", width: 6 },
            { header: "Side", width: 6 },
            { header: "Size", width: 12 },
            { header: "Entry", width: 12 },
            { header: "Mark", width: 12 },
            { header: "PnL", width: 16 },
            { header: "Liq.", width: 12 },
            { header: "Position", width: 14 },
          ],
          positions.map((p) => [
            p.asset,
            p.side,
            fmtUsd(p.sizeUsd),
            fmtUsd(p.entryPriceUsd),
            fmtUsd(p.markPriceUsd),
            `${fmtUsd(p.pnlAfterFeesUsd)} (${fmtPct(p.pnlAfterFeesPct)})`,
            fmtUsd(p.liquidationPriceUsd),
            `${p.positionPubkey.slice(0, 4)}...${p.positionPubkey.slice(-4)}`,
          ]),
        );
      } else {
        process.stderr.write(colors.muted("  No open positions.\n"));
      }

      if (limitOrders.length > 0) {
        process.stderr.write("\n  Limit Orders:\n");
        printTable(
          [
            { header: "Side", width: 6 },
            { header: "Size", width: 12 },
            { header: "Trigger", width: 12 },
            { header: "Order", width: 14 },
          ],
          limitOrders.map((o) => [
            o.side,
            fmtUsd(o.sizeUsdDelta),
            o.triggerPrice ? fmtUsd(o.triggerPrice) : "-",
            `${o.positionRequestPubkey.slice(0, 4)}...${o.positionRequestPubkey.slice(-4)}`,
          ]),
        );
      }
    });

  // --- history ---
  perps
    .command("history")
    .description("View perps trade history")
    .option("--address <addr>", "Wallet address")
    .option("--asset <asset>", "Filter: SOL, BTC, ETH")
    .option("--side <side>", "Filter: long, short")
    .option("--limit <n>", "Max results", "20")
    .action(async (options: { address?: string; asset?: string; side?: string; limit: string }) => {
      const address = options.address ?? requireSolanaWallet().address;
      const spin = spinner("Loading history...");
      spin.start();

      const { count, trades } = await getPerpsHistory({
        walletAddress: address,
        asset: options.asset,
        side: options.side,
        limit: Number(options.limit),
      });
      spin.succeed(`${trades.length} trade(s) (${count} total)`);

      if (isHeadless()) {
        writeJsonSuccess({
          count,
          trades: trades.map((t) => ({
            time: new Date(t.createdTime * 1000).toISOString(),
            asset: t.mint,
            side: t.side,
            action: t.action,
            sizeUsd: Number(t.size),
            priceUsd: Number(t.price),
            pnlUsd: t.pnl ? Number(t.pnl) : null,
            pnlPct: t.pnlPercentage ? Number(t.pnlPercentage) : null,
            feeUsd: Number(t.fee),
            signature: t.txHash,
          })),
        });
        return;
      }

      if (trades.length === 0) {
        infoBox("Perps History", "No trades found.");
        return;
      }

      printTable(
        [
          { header: "Time", width: 18 },
          { header: "Side", width: 6 },
          { header: "Action", width: 10 },
          { header: "Size", width: 12 },
          { header: "Price", width: 12 },
          { header: "PnL", width: 14 },
          { header: "Tx", width: 14 },
        ],
        trades.map((t) => [
          new Date(t.createdTime * 1000).toLocaleDateString(),
          t.side,
          t.action,
          fmtUsd(t.size),
          fmtUsd(t.price),
          t.pnl ? `${fmtUsd(t.pnl)} (${fmtPct(t.pnlPercentage ?? "0")})` : colors.muted("-"),
          `${t.txHash.slice(0, 4)}...${t.txHash.slice(-4)}`,
        ]),
      );
    });

  // --- open ---
  perps
    .command("open")
    .description("Open a leveraged position (market or limit order)")
    .requiredOption("--asset <asset>", "Market: SOL, BTC, ETH")
    .requiredOption("--side <side>", "Side: long, short, buy, sell")
    .requiredOption("--amount <usd>", "Collateral amount in input token units")
    .option("--input <token>", "Collateral token (SOL, BTC, ETH, USDC)", "SOL")
    .option("--leverage <n>", "Position leverage (size = amount × leverage)")
    .option("--size <usd>", "Explicit position size in USD (alternative to leverage)")
    .option("--slippage <bps>", "Max slippage in basis points", "200")
    .option("--tp <price>", "Take-profit trigger price USD")
    .option("--sl <price>", "Stop-loss trigger price USD")
    .option("--limit <price>", "Limit order trigger price USD")
    .option("--yes", "Skip confirmation")
    .action(async (options) => {
      const wallet = requireSolanaWallet();

      if (options.leverage && options.size) {
        throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, "Only one of --leverage or --size can be provided.");
      }

      if (!options.yes && !isHeadless()) {
        const type = options.limit ? "Limit" : "Market";
        process.stderr.write(
          `\n  ${type}: ${colors.info(`${options.amount} ${options.input}`)} → ${options.asset} ${options.side}` +
          (options.leverage ? ` ${options.leverage}x` : "") +
          (options.limit ? ` @ $${options.limit}` : "") +
          (options.tp ? ` TP:$${options.tp}` : "") +
          (options.sl ? ` SL:$${options.sl}` : "") +
          `\n  Use ${colors.muted("--yes")} to execute.\n\n`,
        );
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Opening position...");
      spin.start();

      try {
        const result = await openPerpsPosition(wallet.secretKey, {
          asset: options.asset,
          side: options.side,
          amountUsd: Number(options.amount),
          inputToken: options.input,
          leverage: options.leverage ? Number(options.leverage) : undefined,
          sizeUsd: options.size ? Number(options.size) : undefined,
          slippageBps: Number(options.slippage),
          tp: options.tp ? Number(options.tp) : undefined,
          sl: options.sl ? Number(options.sl) : undefined,
          limitPrice: options.limit ? Number(options.limit) : undefined,
        });
        spin.succeed("Position opened");

        if (isHeadless()) {
          writeJsonSuccess({ ...result });
        } else {
          successBox("Position Opened",
            `Type: ${result.type}\n` +
            `Position: ${colors.muted(result.positionPubkey)}\n` +
            `Signature: ${colors.muted(result.signature)}`);
        }
      } catch (err) { spin.fail("Failed"); throw err; }
    });

  // --- close ---
  perps
    .command("close")
    .description("Close a position, partial close, or close all")
    .requiredOption("--position <pubkey>", "Position pubkey, or 'all'")
    .option("--size <usd>", "Partial close: reduce by this USD amount")
    .option("--receive <token>", "Receive token (SOL, BTC, ETH, USDC)", "SOL")
    .option("--slippage <bps>", "Max slippage", "200")
    .option("--yes", "Skip confirmation")
    .action(async (options) => {
      const wallet = requireSolanaWallet();

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Close position: ${colors.muted(options.position)}\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Closing position...");
      spin.start();

      try {
        if (options.position === "all") {
          const sigs = await closeAllPerpsPositions(wallet.secretKey);
          spin.succeed(`Closed ${sigs.length} position(s)`);
          if (isHeadless()) {
            writeJsonSuccess({ action: "close-all", signatures: sigs });
          } else {
            successBox("All Positions Closed", sigs.map((s) => `Signature: ${colors.muted(s)}`).join("\n"));
          }
        } else {
          const result = await closePerpsPosition(wallet.secretKey, {
            positionPubkey: options.position,
            receiveToken: options.receive,
            sizeUsd: options.size ? Number(options.size) : undefined,
            slippageBps: Number(options.slippage),
          });
          spin.succeed("Position closed");
          if (isHeadless()) {
            writeJsonSuccess({ action: options.size ? "decrease-position" : "close-position", ...result });
          } else {
            successBox("Position Closed", `Signature: ${colors.muted(result.signature)}`);
          }
        }
      } catch (err) { spin.fail("Failed"); throw err; }
    });

  // --- set (TP/SL or limit order update) ---
  perps
    .command("set")
    .description("Set/update TP/SL on a position or update a limit order trigger")
    .option("--position <pubkey>", "Position pubkey (for TP/SL)")
    .option("--order <pubkey>", "Limit order pubkey (for trigger price update)")
    .option("--tp <price>", "Take-profit USD price")
    .option("--sl <price>", "Stop-loss USD price")
    .option("--limit <price>", "New limit order trigger price")
    .option("--yes", "Skip confirmation")
    .action(async (options) => {
      const wallet = requireSolanaWallet();

      if (options.position && options.order) {
        throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, "Only one of --position or --order can be provided.");
      }

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Update: ${colors.muted(options.position ?? options.order)}\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Updating...");
      spin.start();

      try {
        if (options.order && options.limit) {
          const sig = await updatePerpsLimitOrder(wallet.secretKey, options.order, Number(options.limit));
          spin.succeed("Limit order updated");
          if (isHeadless()) {
            writeJsonSuccess({ action: "update-limit-order", triggerPriceUsd: Number(options.limit), signature: sig });
          } else {
            successBox("Limit Order Updated", `Trigger: $${options.limit}\nSignature: ${colors.muted(sig)}`);
          }
        } else if (options.position && (options.tp || options.sl)) {
          const result = await setPerpsTPSL(wallet.secretKey, options.position, {
            tp: options.tp ? Number(options.tp) : undefined,
            sl: options.sl ? Number(options.sl) : undefined,
          });
          spin.succeed("TP/SL set");
          if (isHeadless()) {
            writeJsonSuccess({ action: "set-tpsl", signatures: result.signatures });
          } else {
            successBox("TP/SL Set", result.signatures.map((s) => `Signature: ${colors.muted(s)}`).join("\n"));
          }
        } else {
          spin.fail("Invalid options");
          throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, "Use --position with --tp/--sl, or --order with --limit.");
        }
      } catch (err) { spin.fail("Failed"); throw err; }
    });

  // --- cancel ---
  perps
    .command("cancel")
    .description("Cancel a limit order or TP/SL")
    .option("--order <pubkey>", "Limit order pubkey to cancel")
    .option("--tpsl <pubkey>", "TP/SL pubkey to cancel")
    .option("--yes", "Skip confirmation")
    .action(async (options) => {
      const wallet = requireSolanaWallet();

      if (!options.order && !options.tpsl) {
        throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, "Provide --order or --tpsl to cancel.");
      }

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Cancel: ${colors.muted(options.order ?? options.tpsl)}\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Cancelling...");
      spin.start();

      try {
        if (options.order) {
          const sig = await cancelPerpsLimitOrder(wallet.secretKey, options.order);
          spin.succeed("Limit order cancelled");
          if (isHeadless()) {
            writeJsonSuccess({ action: "cancel-limit-order", signature: sig });
          } else {
            successBox("Cancelled", `Signature: ${colors.muted(sig)}`);
          }
        } else {
          const sig = await cancelPerpsTPSL(wallet.secretKey, options.tpsl!);
          spin.succeed("TP/SL cancelled");
          if (isHeadless()) {
            writeJsonSuccess({ action: "cancel-tpsl", signature: sig });
          } else {
            successBox("Cancelled", `Signature: ${colors.muted(sig)}`);
          }
        }
      } catch (err) { spin.fail("Failed"); throw err; }
    });

  return perps;
}
