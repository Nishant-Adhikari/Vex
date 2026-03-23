/**
 * `echoclaw polymarket buy/sell` — trading commands.
 */

import { Command } from "commander";
import type { Hex } from "viem";
import { getPolyGammaClient } from "../../polymarket/gamma/client.js";
import { getPolyClobClient } from "../../polymarket/clob/client.js";
import { buildClobOrder, signClobOrder } from "../../polymarket/clob/signing.js";
import { requirePolyClobCredentials } from "../../polymarket/auth.js";
import { USDC_E_DECIMALS } from "../../polymarket/constants.js";
import { requirePolyAuth, parseClobTokenIds, formatUsd, formatProbability } from "./helpers.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";

function usdcToBaseUnits(amount: number): string {
  return Math.round(amount * 10 ** USDC_E_DECIMALS).toString();
}

function calcAmounts(side: "BUY" | "SELL", amount: number, price: number): { makerAmount: string; takerAmount: string } {
  if (side === "BUY") {
    // Buying outcome tokens: pay USDC, receive tokens
    const usdcAmount = amount * price;
    return { makerAmount: usdcToBaseUnits(usdcAmount), takerAmount: usdcToBaseUnits(amount) };
  }
  // Selling tokens: pay tokens, receive USDC
  const usdcAmount = amount * price;
  return { makerAmount: usdcToBaseUnits(amount), takerAmount: usdcToBaseUnits(usdcAmount) };
}

export function createBuySubcommand(): Command {
  return new Command("buy")
    .description("Buy YES or NO shares on Polymarket")
    .argument("<condition-id>", "Market condition ID")
    .requiredOption("--outcome <outcome>", "Outcome: yes or no")
    .requiredOption("--amount <amount>", "Amount in USDC to spend")
    .option("--price <price>", "Limit price (0-1). Omit for market order at best ask.")
    .option("--type <type>", "Order type: GTC, FOK, GTD", "GTC")
    .option("--dry-run", "Show order preview without executing")
    .option("--yes", "Confirm execution")
    .exitOverride()
    .action(async (conditionId: string, options: {
      outcome: string; amount: string; price?: string; type: string;
      dryRun?: boolean; yes?: boolean;
    }) => {
      const outcome = options.outcome.toUpperCase() === "YES" ? "YES" : "NO";
      const amount = parseFloat(options.amount);
      if (Number.isNaN(amount) || amount <= 0) {
        throw new EchoError(ErrorCodes.INVALID_AMOUNT, "Amount must be a positive number");
      }

      // Get market to resolve token IDs
      const gamma = getPolyGammaClient();
      const spin = spinner("Loading market...");
      spin.start();

      const market = await gamma.getMarket(conditionId);
      const tokens = parseClobTokenIds(market.clobTokenIds);
      const tokenId = outcome === "YES" ? tokens.yes : tokens.no;
      if (!tokenId) throw new EchoError(ErrorCodes.POLYMARKET_MARKET_NOT_FOUND, `No ${outcome} token found for this market`);

      // Get price
      let price = options.price ? parseFloat(options.price) : null;
      if (price === null) {
        const clob = getPolyClobClient();
        const priceData = await clob.getPrice(tokenId, "BUY");
        price = priceData.price;
      }

      spin.succeed("Market loaded");

      const shares = amount / price;
      const orderInfo = [
        `Market: ${market.question}`,
        `Outcome: ${colors.value(outcome)}`,
        `Amount: ${formatUsd(amount)} USDC`,
        `Price: ${formatProbability(price)}`,
        `Est. Shares: ~${shares.toFixed(2)}`,
        `Order Type: ${options.type}`,
      ].join("\n");

      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({ dryRun: true, conditionId, outcome, amount, price, shares, tokenId, orderType: options.type });
        } else {
          infoBox("Buy Preview (Dry Run)", orderInfo);
        }
        return;
      }

      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
      }

      requirePolyAuth();
      const { address, privateKey } = requireWalletAndKeystore();
      const creds = requirePolyClobCredentials();
      const clob = getPolyClobClient();

      spin.start();
      spin.text = "Building and signing order...";

      const feeRate = await clob.getFeeRate(tokenId);
      const { makerAmount, takerAmount } = calcAmounts("BUY", shares, price);

      const orderData = buildClobOrder({
        maker: address,
        signer: address,
        tokenId,
        makerAmount,
        takerAmount,
        side: "BUY",
        feeRateBps: String(feeRate.base_fee),
      });

      const signature = await signClobOrder(privateKey as Hex, orderData, market.negRisk ?? false);

      spin.text = "Submitting order...";

      const result = await clob.postOrder({
        order: { ...orderData, signature },
        owner: creds.apiKey,
        orderType: options.type as "GTC" | "FOK" | "GTD",
      });

      spin.succeed(result.success ? "Order placed" : "Order submission completed");

      if (isHeadless()) {
        writeJsonSuccess({ ...result, conditionId, outcome, amount, price });
      } else {
        successBox("Order Placed", [
          orderInfo,
          "",
          `Order ID: ${colors.info(result.orderID)}`,
          `Status: ${result.status}`,
          result.errorMsg ? `Error: ${result.errorMsg}` : "",
        ].filter(Boolean).join("\n"));
      }
    });
}

export function createSellSubcommand(): Command {
  return new Command("sell")
    .description("Sell YES or NO shares on Polymarket")
    .argument("<condition-id>", "Market condition ID")
    .requiredOption("--outcome <outcome>", "Outcome: yes or no")
    .requiredOption("--amount <amount>", "Number of shares to sell")
    .option("--price <price>", "Limit price (0-1). Omit for market order at best bid.")
    .option("--dry-run", "Show order preview without executing")
    .option("--yes", "Confirm execution")
    .exitOverride()
    .action(async (conditionId: string, options: {
      outcome: string; amount: string; price?: string; dryRun?: boolean; yes?: boolean;
    }) => {
      const outcome = options.outcome.toUpperCase() === "YES" ? "YES" : "NO";
      const shares = parseFloat(options.amount);
      if (Number.isNaN(shares) || shares <= 0) {
        throw new EchoError(ErrorCodes.INVALID_AMOUNT, "Amount must be a positive number");
      }

      const gamma = getPolyGammaClient();
      const spin = spinner("Loading market...");
      spin.start();

      const market = await gamma.getMarket(conditionId);
      const tokens = parseClobTokenIds(market.clobTokenIds);
      const tokenId = outcome === "YES" ? tokens.yes : tokens.no;
      if (!tokenId) throw new EchoError(ErrorCodes.POLYMARKET_MARKET_NOT_FOUND, `No ${outcome} token`);

      let price = options.price ? parseFloat(options.price) : null;
      if (price === null) {
        const clob = getPolyClobClient();
        const priceData = await clob.getPrice(tokenId, "SELL");
        price = priceData.price;
      }

      spin.succeed("Market loaded");

      const usdcValue = shares * price;
      const orderInfo = `Market: ${market.question}\nOutcome: ${outcome}\nShares: ${shares}\nPrice: ${formatProbability(price)}\nEst. Value: ${formatUsd(usdcValue)} USDC`;

      if (options.dryRun) {
        if (isHeadless()) writeJsonSuccess({ dryRun: true, conditionId, outcome, shares, price, usdcValue, tokenId });
        else infoBox("Sell Preview (Dry Run)", orderInfo);
        return;
      }

      if (!options.yes) throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");

      requirePolyAuth();
      const { address, privateKey } = requireWalletAndKeystore();
      const creds = requirePolyClobCredentials();
      const clob = getPolyClobClient();

      spin.start();
      spin.text = "Building and signing sell order...";

      const feeRate = await clob.getFeeRate(tokenId);
      const { makerAmount, takerAmount } = calcAmounts("SELL", shares, price);

      const orderData = buildClobOrder({
        maker: address, signer: address, tokenId,
        makerAmount, takerAmount, side: "SELL",
        feeRateBps: String(feeRate.base_fee),
      });

      const signature = await signClobOrder(privateKey as Hex, orderData, market.negRisk ?? false);

      spin.text = "Submitting sell order...";
      const result = await clob.postOrder({ order: { ...orderData, signature }, owner: creds.apiKey, orderType: "GTC" });
      spin.succeed(result.success ? "Sell order placed" : "Order submitted");

      if (isHeadless()) writeJsonSuccess({ ...result, conditionId, outcome, shares, price });
      else successBox("Sell Order Placed", `${orderInfo}\n\nOrder ID: ${colors.info(result.orderID)}\nStatus: ${result.status}`);
    });
}
