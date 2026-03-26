/**
 * `echoclaw kyberswap zap migrate` — migrate LP position between pools/DEXes.
 */

import { Command } from "commander";
import type { Hex } from "viem";
import { getKyberZaasClient } from "../../tools/kyberswap/zaas/client.js";
import { KS_ZAP_ROUTER_POSITION } from "../../tools/kyberswap/constants.js";
import { getKyberEvmClients, verifyRouterAddress, sendKyberTransaction } from "../../tools/kyberswap/evm-utils.js";
import { resolveChain, requireFeature } from "./helpers.js";
import { slugToChainId } from "../../tools/kyberswap/chains.js";
import { requireWalletAndKeystore } from "../../tools/wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe, validateSlippage } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";

export function createZapMigrateAction(): Command {
  return new Command("migrate")
    .description("Migrate LP position between pools or DEXes via KyberSwap ZaaS")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .requiredOption("--dex-from <dex>", "Source DEX identifier")
    .requiredOption("--dex-to <dex>", "Destination DEX identifier")
    .requiredOption("--pool-from <address>", "Source pool address")
    .requiredOption("--pool-to <address>", "Destination pool address")
    .requiredOption("--position <id>", "Source position ID")
    .option("--tick-lower <tick>", "Lower tick for new position")
    .option("--tick-upper <tick>", "Upper tick for new position")
    .option("--liquidity <amount>", "Liquidity to migrate (0 or empty = all)")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "100")
    .option("--dry-run", "Preview without executing")
    .option("--yes", "Confirm execution")
    .exitOverride()
    .action(async (options: {
      chain: string; dexFrom: string; dexTo: string; poolFrom: string; poolTo: string;
      position: string; tickLower?: string; tickUpper?: string; liquidity?: string;
      slippageBps: string; dryRun?: boolean; yes?: boolean;
    }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "zaas");
      const chainId = slugToChainId(slug);
      const slippage = validateSlippage(parseIntSafe(options.slippageBps, "slippageBps"));

      const spin = spinner("Finding migration route...");
      spin.start();

      const zaasClient = getKyberZaasClient();
      const routeResponse = await zaasClient.getZapMigrateRoute(slug, {
        dexFrom: options.dexFrom,
        dexTo: options.dexTo,
        "poolFrom.id": options.poolFrom,
        "poolTo.id": options.poolTo,
        "positionFrom.id": options.position,
        "positionTo.tickLower": options.tickLower ? parseInt(options.tickLower, 10) : undefined,
        "positionTo.tickUpper": options.tickUpper ? parseInt(options.tickUpper, 10) : undefined,
        liquidityOut: options.liquidity,
        slippage,
      });

      spin.succeed("Migration route found");

      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({ dryRun: true, chain: slug, chainId, ...routeResponse.data });
        } else {
          infoBox("Zap Migrate Preview (Dry Run)", [
            `Chain: ${slug}`, `From: ${options.dexFrom} / ${options.poolFrom}`,
            `To: ${options.dexTo} / ${options.poolTo}`, `Position: ${options.position}`,
          ].join("\n"));
        }
        return;
      }

      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
      }

      const { address, privateKey } = requireWalletAndKeystore();
      const routeData = routeResponse.data;

      if (!routeData.route || !routeData.routerAddress) {
        throw new EchoError(ErrorCodes.KYBER_ZAP_BUILD_FAILED, "ZaaS migrate route missing data");
      }

      verifyRouterAddress(routeData.routerAddress, KS_ZAP_ROUTER_POSITION);
      const { publicClient, walletClient } = getKyberEvmClients(slug, privateKey as Hex);

      const spinBuild = spinner("Building migrate transaction...");
      spinBuild.start();

      const buildResponse = await zaasClient.buildZapMigrate(slug, {
        sender: address, recipient: address, route: routeData.route,
      });

      spinBuild.succeed("Transaction built");

      const spinSend = spinner("Sending transaction...");
      spinSend.start();

      const txHash = await sendKyberTransaction(publicClient, walletClient, {
        to: buildResponse.data.routerAddress,
        data: buildResponse.data.callData as Hex,
        value: BigInt(buildResponse.data.value),
      });

      spinSend.succeed("Position migrated");

      if (isHeadless()) {
        writeJsonSuccess({ txHash, chain: slug, chainId, position: options.position });
      } else {
        successBox("Position Migrated", `From: ${options.poolFrom}\nTo: ${options.poolTo}\nTx: ${colors.info(txHash)}`);
      }
    });
}
