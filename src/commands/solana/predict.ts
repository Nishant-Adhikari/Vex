/**
 * Jupiter Prediction Markets commands.
 * Binary predictions on real-world events. Geo-restricted: US/KR blocked.
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../tools/wallet/multi-auth.js";
import {
  getJupiterPredictionEvents,
  searchJupiterPredictionEvents,
  getJupiterPredictionMarket,
  getJupiterPredictionEvent,
  getJupiterPredictionPosition,
  getJupiterPredictionPositions,
  getJupiterPredictionHistory,
  executeJupiterPredictionCreateOrder,
  executeJupiterPredictionClaimPosition,
  executeJupiterPredictionClosePosition,
  executeJupiterPredictionCloseAllPositions,
} from "../../tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.js";
import { JUPITER_PREDICTION_USDC_MINT } from "../../tools/solana-ecosystem/jupiter/jupiter-prediction/constants.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, infoBox, spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

export function createPredictSubcommand(): Command {
  const predict = new Command("predict")
    .description("Jupiter Prediction Markets — trade YES/NO on real-world events")
    .exitOverride();

  predict
    .command("list")
    .description("Browse prediction events")
    .argument("[category]", "Category: crypto, sports, politics, culture, economics, tech")
    .option("--filter <f>", "Filter: trending | live | new")
    .action(async (category?: string, options?: { filter?: string }) => {
      const spin = spinner("Loading events...");
      spin.start();

      const result = await getJupiterPredictionEvents({
        category: category as any || undefined,
        filter: options?.filter as any || undefined,
        includeMarkets: true,
      });
      const events = result.data;
      spin.succeed(`${events.length} event(s)`);

      if (isHeadless()) { writeJsonSuccess({ events }); return; }
      if (events.length === 0) { infoBox("Predictions", "No events found."); return; }

      printTable(
        [{ header: "ID", width: 14 }, { header: "Title", width: 40 }, { header: "Category", width: 12 }, { header: "Status", width: 10 }],
        events.map((e) => [e.eventId, (e.metadata?.title ?? "").slice(0, 38), e.category, e.isLive ? "live" : e.isActive ? "active" : "closed"]),
      );
    });

  predict
    .command("search <query>")
    .description("Search prediction events")
    .action(async (query: string) => {
      const spin = spinner(`Searching: ${query}...`);
      spin.start();

      const result = await searchJupiterPredictionEvents({ query });
      const events = result.data;
      spin.succeed(`${events.length} result(s)`);

      if (isHeadless()) { writeJsonSuccess({ events }); return; }
      if (events.length === 0) { infoBox("Search", "No events found."); return; }

      printTable(
        [{ header: "ID", width: 14 }, { header: "Title", width: 40 }, { header: "Status", width: 10 }],
        events.map((e) => [e.eventId, (e.metadata?.title ?? "").slice(0, 38), e.isLive ? "live" : e.isActive ? "active" : "closed"]),
      );
    });

  predict
    .command("market <marketId>")
    .description("Market details with prices")
    .action(async (marketId: string) => {
      const spin = spinner("Loading market...");
      spin.start();

      const market = await getJupiterPredictionMarket(marketId);
      spin.succeed("Market loaded");

      if (isHeadless()) { writeJsonSuccess({ market }); return; }

      const title = market.metadata?.title ?? marketId;
      const yesPrice = market.pricing?.buyYesPriceUsd ?? 0;
      const noPrice = market.pricing?.buyNoPriceUsd ?? 0;
      const volume = market.pricing?.volume ?? 0;

      infoBox("Prediction Market",
        `${colors.bold(title)}\n` +
        `Status: ${market.status} | Result: ${market.result || "pending"}\n` +
        `YES: ${colors.info(`$${yesPrice.toFixed(2)}`)} | NO: ${colors.info(`$${noPrice.toFixed(2)}`)}\n` +
        `Volume: $${volume.toLocaleString()}`);
    });

  predict
    .command("buy <marketId>")
    .description("Buy prediction contracts")
    .requiredOption("--side <side>", "Side: yes | no")
    .requiredOption("--amount <usdc>", "Amount in USDC")
    .option("--yes", "Skip confirmation")
    .action(async (marketId: string, options: { side: string; amount: string; yes?: boolean }) => {
      const wallet = requireSolanaWallet();
      const isYes = options.side.toLowerCase() === "yes";
      const amount = Number(options.amount);
      const depositAmount = Math.round(amount * 1_000_000);

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Buy ${colors.info(isYes ? "YES" : "NO")} on ${marketId} for ${colors.info(`$${amount}`)}\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Placing prediction order...");
      spin.start();

      try {
        const result = await executeJupiterPredictionCreateOrder(wallet.secretKey, {
          marketId,
          isYes,
          isBuy: true,
          depositAmount,
          depositMint: JUPITER_PREDICTION_USDC_MINT,
        });
        spin.succeed("Order placed");

        const positionPubkey = result.raw.order.positionPubkey;
        if (isHeadless()) {
          writeJsonSuccess({ action: "predict-buy", marketId, side: isYes ? "yes" : "no", amount, signature: result.signature, positionPubkey, raw: result.raw });
        } else {
          successBox("Prediction Order", `Side: ${colors.info(isYes ? "YES" : "NO")}\nAmount: ${colors.info(`$${amount}`)}\nPosition: ${colors.muted(positionPubkey)}\nSignature: ${colors.muted(result.signature)}`);
        }
      } catch (err) { spin.fail("Order failed"); throw err; }
    });

  predict
    .command("positions")
    .description("Your prediction positions")
    .action(async () => {
      const wallet = requireSolanaWallet();
      const spin = spinner("Loading positions...");
      spin.start();

      const result = await getJupiterPredictionPositions({ ownerPubkey: wallet.address });
      const positions = result.data;
      spin.succeed(`${positions.length} position(s)`);

      if (isHeadless()) { writeJsonSuccess({ positions }); return; }
      if (positions.length === 0) { infoBox("Positions", "No prediction positions."); return; }

      printTable(
        [
          { header: "Position", width: 14 },
          { header: "Side", width: 6 },
          { header: "Contracts", width: 10 },
          { header: "Cost", width: 10 },
          { header: "Value", width: 10 },
          { header: "P&L", width: 12 },
        ],
        positions.map((p) => {
          const cost = Number(p.totalCostUsd);
          const value = Number(p.valueUsd ?? 0);
          const pnl = Number(p.pnlUsd ?? 0);
          const pnlPct = p.pnlUsdPercent ?? 0;
          return [
            `${p.pubkey.slice(0, 4)}...${p.pubkey.slice(-4)}`,
            p.isYes ? "YES" : "NO",
            p.contracts,
            `$${cost.toFixed(2)}`,
            `$${value.toFixed(2)}`,
            `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`,
          ];
        }),
      );
    });

  predict
    .command("claim <positionPubkey>")
    .description("Claim winnings from resolved market")
    .option("--yes", "Skip confirmation")
    .action(async (positionPubkey: string, options: { yes?: boolean }) => {
      requireSolanaWallet();
      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Claim position ${colors.muted(positionPubkey.slice(0, 8))}...\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Claiming...");
      spin.start();

      try {
        const wallet = requireSolanaWallet();
        const result = await executeJupiterPredictionClaimPosition(wallet.secretKey, positionPubkey);
        spin.succeed("Claimed");
        if (isHeadless()) { writeJsonSuccess({ action: "predict-claim", signature: result.signature, explorerUrl: result.explorerUrl, raw: result.raw }); }
        else { successBox("Claimed", `Signature: ${colors.muted(result.signature)}\nExplorer: ${colors.muted(result.explorerUrl)}`); }
      } catch (err) { spin.fail("Claim failed"); throw err; }
    });

  predict
    .command("sell <positionPubkey>")
    .description("Close/sell a prediction position")
    .option("--yes", "Skip confirmation")
    .action(async (positionPubkey: string, options: { yes?: boolean }) => {
      requireSolanaWallet();
      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Sell position ${colors.muted(positionPubkey.slice(0, 8))}...\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Selling position...");
      spin.start();

      try {
        const wallet = requireSolanaWallet();
        const result = await executeJupiterPredictionClosePosition(wallet.secretKey, positionPubkey);
        spin.succeed("Position closed");
        if (isHeadless()) { writeJsonSuccess({ action: "predict-sell", signature: result.signature, explorerUrl: result.explorerUrl, raw: result.raw }); }
        else { successBox("Position Closed", `Signature: ${colors.muted(result.signature)}\nExplorer: ${colors.muted(result.explorerUrl)}`); }
      } catch (err) { spin.fail("Sell failed"); throw err; }
    });

  predict
    .command("close-all")
    .description("Close all open prediction positions")
    .option("--yes", "Skip confirmation")
    .action(async (options: { yes?: boolean }) => {
      requireSolanaWallet();
      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Close ALL prediction positions\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Closing all positions...");
      spin.start();

      try {
        const wallet = requireSolanaWallet();
        const result = await executeJupiterPredictionCloseAllPositions(wallet.secretKey);
        spin.succeed(`Closed ${result.results.length} position(s)`);
        if (isHeadless()) {
          writeJsonSuccess({ action: "predict-close-all", results: result.results, raw: result.raw });
        } else {
          successBox("All Positions Closed", result.results.map((r) => `Signature: ${colors.muted(r.signature)}`).join("\n") || "No positions to close.");
        }
      } catch (err) { spin.fail("Failed"); throw err; }
    });

  predict
    .command("history")
    .description("View prediction trading history")
    .option("--limit <n>", "Max results", "10")
    .option("--offset <n>", "Pagination offset", "0")
    .action(async (options: { limit: string; offset: string }) => {
      const wallet = requireSolanaWallet();
      const spin = spinner("Loading history...");
      spin.start();

      const start = Number(options.offset);
      const end = start + Number(options.limit);
      const result = await getJupiterPredictionHistory({
        ownerPubkey: wallet.address,
        start,
        end,
      });
      const history = result.data;
      const hasNext = result.pagination?.hasNext ?? false;
      spin.succeed(`${history.length} event(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ history, hasNext });
        return;
      }

      if (history.length === 0) {
        infoBox("History", "No prediction history.");
        return;
      }

      printTable(
        [
          { header: "Time", width: 12 },
          { header: "Type", width: 14 },
          { header: "Side", width: 6 },
          { header: "Contracts", width: 10 },
          { header: "Price", width: 10 },
          { header: "PnL", width: 12 },
          { header: "Tx", width: 14 },
        ],
        history.map((h) => [
          new Date(h.timestamp * 1000).toLocaleDateString(),
          h.eventType,
          h.isYes ? "yes" : "no",
          h.filledContracts,
          `$${Number(h.avgFillPriceUsd).toFixed(2)}`,
          h.realizedPnl != null ? `$${Number(h.realizedPnl).toFixed(2)}` : colors.muted("-"),
          `${h.signature.slice(0, 4)}...${h.signature.slice(-4)}`,
        ]),
      );

      if (hasNext) {
        process.stderr.write(`\n  Next: --offset ${end}\n`);
      }
    });

  predict
    .command("event <eventId>")
    .description("Look up a single event by ID")
    .action(async (eventId: string) => {
      const spin = spinner("Loading event...");
      spin.start();

      const event = await getJupiterPredictionEvent({ eventId, includeMarkets: true });
      spin.succeed("Event loaded");

      if (isHeadless()) { writeJsonSuccess({ event }); return; }

      const title = event.metadata?.title ?? eventId;
      const status = event.isLive ? "live" : event.isActive ? "active" : "closed";
      infoBox("Prediction Event",
        `${colors.bold(title)}\n` +
        `Category: ${event.category} | Status: ${status}`);

      if (event.markets && event.markets.length > 0) {
        printTable(
          [{ header: "Market", width: 14 }, { header: "Title", width: 30 }, { header: "YES", width: 10 }, { header: "NO", width: 10 }, { header: "Volume", width: 14 }],
          event.markets.map((m) => [
            m.marketId,
            (m.metadata?.title ?? "").slice(0, 28),
            `$${(m.pricing?.buyYesPriceUsd ?? 0).toFixed(2)}`,
            `$${(m.pricing?.buyNoPriceUsd ?? 0).toFixed(2)}`,
            `$${(m.pricing?.volume ?? 0).toLocaleString()}`,
          ]),
        );
      }
    });

  predict
    .command("position <positionPubkey>")
    .description("Look up a single prediction position by pubkey")
    .action(async (positionPubkey: string) => {
      const spin = spinner("Loading position...");
      spin.start();

      const position = await getJupiterPredictionPosition(positionPubkey);
      spin.succeed("Position loaded");

      if (isHeadless()) { writeJsonSuccess({ position }); return; }

      const cost = Number(position.totalCostUsd);
      const value = Number(position.valueUsd ?? 0);
      const pnl = Number(position.pnlUsd ?? 0);
      const pnlPct = position.pnlUsdPercent ?? 0;

      infoBox("Prediction Position",
        `Position: ${colors.muted(position.pubkey)}\n` +
        `Market: ${position.marketId}\n` +
        `Side: ${colors.info(position.isYes ? "YES" : "NO")}\n` +
        `Contracts: ${position.contracts}\n` +
        `Cost: $${cost.toFixed(2)} | Value: $${value.toFixed(2)}\n` +
        `P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)\n` +
        `Claimable: ${position.claimable ? colors.info("YES") : "no"}`);
    });

  return predict;
}
