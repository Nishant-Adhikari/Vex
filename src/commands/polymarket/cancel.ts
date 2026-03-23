/**
 * `echoclaw polymarket cancel/cancel-all` — order cancellation.
 */

import { Command } from "commander";
import { getPolyClobClient } from "../../polymarket/clob/client.js";
import { requirePolyAuth } from "./helpers.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, colors } from "../../utils/ui.js";

export function createCancelSubcommand(): Command {
  return new Command("cancel")
    .description("Cancel a Polymarket order")
    .argument("<orderId>", "Order ID to cancel")
    .option("--yes", "Confirm cancellation")
    .exitOverride()
    .action(async (orderId: string, options: { yes?: boolean }) => {
      if (!options.yes) throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      requirePolyAuth();

      const clob = getPolyClobClient();
      const spin = spinner("Cancelling order...");
      spin.start();

      const result = await clob.cancelOrder(orderId);
      spin.succeed("Cancel processed");

      if (isHeadless()) {
        writeJsonSuccess({ canceled: result.canceled, not_canceled: result.not_canceled });
      } else {
        const cancelled = result.canceled.length > 0;
        const fn = cancelled ? successBox : spinner("").fail.bind(spinner(""));
        successBox("Cancel Result", [
          cancelled ? `Cancelled: ${colors.info(result.canceled.join(", "))}` : "No orders cancelled",
          Object.keys(result.not_canceled).length > 0
            ? `Not cancelled: ${Object.entries(result.not_canceled).map(([id, reason]) => `${id}: ${reason}`).join(", ")}`
            : "",
        ].filter(Boolean).join("\n"));
      }
    });
}

export function createCancelAllSubcommand(): Command {
  return new Command("cancel-all")
    .description("Cancel all open Polymarket orders")
    .option("--yes", "Confirm cancellation")
    .exitOverride()
    .action(async (options: { yes?: boolean }) => {
      if (!options.yes) throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to cancel all orders");
      requirePolyAuth();

      const clob = getPolyClobClient();
      const spin = spinner("Cancelling all orders...");
      spin.start();

      const result = await clob.cancelAll();
      spin.succeed(`Cancelled ${result.canceled.length} order(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ canceled: result.canceled, not_canceled: result.not_canceled });
      } else {
        successBox("Cancel All", `Cancelled: ${result.canceled.length} order(s)\nNot cancelled: ${Object.keys(result.not_canceled).length}`);
      }
    });
}

export function createCancelMarketSubcommand(): Command {
  return new Command("cancel-market")
    .description("Cancel all orders in a specific market")
    .argument("<condition-id>", "Market condition ID")
    .argument("<asset-id>", "Asset ID (token ID)")
    .option("--yes", "Confirm cancellation")
    .exitOverride()
    .action(async (conditionId: string, assetId: string, options: { yes?: boolean }) => {
      if (!options.yes) throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      requirePolyAuth();

      const clob = getPolyClobClient();
      const spin = spinner("Cancelling market orders...");
      spin.start();

      const result = await clob.cancelMarketOrders(conditionId, assetId);
      spin.succeed(`Cancelled ${result.canceled.length} order(s) for market`);

      if (isHeadless()) writeJsonSuccess({ canceled: result.canceled, not_canceled: result.not_canceled });
      else successBox("Cancel Market Orders", `Cancelled: ${result.canceled.length}`);
    });
}
