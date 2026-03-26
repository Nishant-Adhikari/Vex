/**
 * `echoclaw kyberswap zap out` — remove liquidity from LP position.
 */

import { Command } from "commander";
import type { Hex } from "viem";
import { getKyberZaasClient } from "../../tools/kyberswap/zaas/client.js";
import { KS_ZAP_ROUTER_POSITION } from "../../tools/kyberswap/constants.js";
import { getKyberEvmClients, verifyRouterAddress, sendKyberTransaction } from "../../tools/kyberswap/evm-utils.js";
import { resolveChain, resolveTokenAddress, requireFeature } from "./helpers.js";
import { slugToChainId } from "../../tools/kyberswap/chains.js";
import { requireWalletAndKeystore } from "../../tools/wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe, validateSlippage } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";

export function createZapOutAction(): Command {
  return new Command("out")
    .description("Remove liquidity from LP position via KyberSwap ZaaS")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .requiredOption("--dex <dex>", "DEX identifier (e.g. DEX_UNISWAPV3)")
    .requiredOption("--pool <address>", "Pool contract address")
    .requiredOption("--position <id>", "Position ID to withdraw from")
    .requiredOption("--token-out <token>", "Token to receive (address or symbol)")
    .option("--liquidity <amount>", "Liquidity amount to withdraw (0 or empty = all)")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "100")
    .option("--dry-run", "Preview without executing")
    .option("--yes", "Confirm execution")
    .exitOverride()
    .action(async (options: {
      chain: string; dex: string; pool: string; position: string; tokenOut: string;
      liquidity?: string; slippageBps: string; dryRun?: boolean; yes?: boolean;
    }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "zaas");
      const chainId = slugToChainId(slug);
      const slippage = validateSlippage(parseIntSafe(options.slippageBps, "slippageBps"));

      const spin = spinner("Finding zap-out route...");
      spin.start();

      const tokenOutAddr = await resolveTokenAddress(options.tokenOut, chainId);

      const zaasClient = getKyberZaasClient();
      const routeResponse = await zaasClient.getZapOutRoute(slug, {
        dexFrom: options.dex,
        "poolFrom.id": options.pool,
        "positionFrom.id": options.position,
        liquidityOut: options.liquidity,
        tokenOut: tokenOutAddr,
        slippage,
      });

      spin.succeed("Zap-out route found");

      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({ dryRun: true, chain: slug, chainId, ...routeResponse.data });
        } else {
          infoBox("Zap Out Preview (Dry Run)", [
            `Chain: ${slug}`, `DEX: ${options.dex}`, `Pool: ${options.pool}`,
            `Position: ${options.position}`, `Token Out: ${options.tokenOut}`,
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
        throw new EchoError(ErrorCodes.KYBER_ZAP_BUILD_FAILED, "ZaaS route response missing route data");
      }

      verifyRouterAddress(routeData.routerAddress, KS_ZAP_ROUTER_POSITION);
      const { publicClient, walletClient } = getKyberEvmClients(slug, privateKey as Hex);

      const spinBuild = spinner("Building zap-out transaction...");
      spinBuild.start();

      const buildResponse = await zaasClient.buildZapOut(slug, {
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

      spinSend.succeed("Liquidity removed");

      if (isHeadless()) {
        writeJsonSuccess({ txHash, chain: slug, chainId, position: options.position, tokenOut: tokenOutAddr });
      } else {
        successBox("Liquidity Removed (Zap Out)", `Position: ${options.position}\nTx: ${colors.info(txHash)}`);
      }
    });
}
