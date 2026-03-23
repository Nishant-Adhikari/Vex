/**
 * `echoclaw kyberswap limit-order cancel` — gasless cancel
 * `echoclaw kyberswap limit-order hard-cancel` — on-chain cancel
 */

import { Command } from "commander";
import type { Hex, Address } from "viem";
import { getKyberLimitOrderClient } from "../../kyberswap/limit-order/client.js";
import { signEip712Message } from "../../kyberswap/limit-order/signing.js";
import { DSLO_PROTOCOL } from "../../kyberswap/constants.js";
import { getKyberEvmClients, sendKyberTransaction } from "../../kyberswap/evm-utils.js";
import { resolveChain, requireFeature } from "./helpers.js";
import { slugToChainId } from "../../kyberswap/chains.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, colors } from "../../utils/ui.js";

export function createLimitOrderCancelAction(): Command {
  return new Command("cancel")
    .description("Cancel limit order (gasless, up to 5min for signature to lapse)")
    .argument("<orderId>", "Order ID to cancel")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .option("--yes", "Confirm cancellation")
    .exitOverride()
    .action(async (orderIdStr: string, options: { chain: string; yes?: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm cancellation");
      }

      const slug = resolveChain(options.chain);
      requireFeature(slug, "limitOrder");
      const chainId = slugToChainId(slug);
      const orderId = parseIntSafe(orderIdStr, "orderId");

      const { address, privateKey } = requireWalletAndKeystore();
      const client = getKyberLimitOrderClient();

      const spin = spinner("Preparing gasless cancel...");
      spin.start();

      const eip712 = await client.getCancelSignMessage({
        chainId: String(chainId),
        maker: address,
        orderIds: [orderId],
      });

      const signature = await signEip712Message(privateKey as Hex, eip712);

      spin.text = "Submitting cancel...";
      await client.cancelOrders({ ...eip712, signature });

      spin.succeed("Order cancel submitted (gasless)");

      if (isHeadless()) {
        writeJsonSuccess({ orderId, chain: slug, method: "gasless" });
      } else {
        successBox("Order Cancelled (Gasless)", `Order #${orderId} cancel submitted.\nOperator signature will lapse within ~5 minutes.`);
      }
    });
}

export function createLimitOrderHardCancelAction(): Command {
  return new Command("hard-cancel")
    .description("Cancel limit order on-chain (immediate, costs gas)")
    .argument("<orderId>", "Order ID to cancel")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .option("--yes", "Confirm on-chain cancellation")
    .exitOverride()
    .action(async (orderIdStr: string, options: { chain: string; yes?: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm on-chain cancellation (costs gas)");
      }

      const slug = resolveChain(options.chain);
      requireFeature(slug, "limitOrder");
      const chainId = slugToChainId(slug);
      const orderId = parseIntSafe(orderIdStr, "orderId");

      const { privateKey } = requireWalletAndKeystore();
      const client = getKyberLimitOrderClient();

      const spin = spinner("Encoding cancel transaction...");
      spin.start();

      const { encodedData } = await client.encodeCancelBatch([orderId]);

      const { publicClient, walletClient } = getKyberEvmClients(slug, privateKey as Hex);

      spin.text = "Sending cancel transaction...";
      const txHash = await sendKyberTransaction(publicClient, walletClient, {
        to: DSLO_PROTOCOL,
        data: encodedData as Hex,
      });

      spin.succeed("Order cancelled on-chain");

      if (isHeadless()) {
        writeJsonSuccess({ orderId, chain: slug, method: "hard-cancel", txHash });
      } else {
        successBox("Order Cancelled (On-Chain)", `Order #${orderId} cancelled.\nTx: ${colors.info(txHash)}`);
      }
    });
}
