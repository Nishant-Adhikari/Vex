/**
 * `echoclaw kyberswap zap in` — add liquidity to concentrated LP position.
 */

import { Command } from "commander";
import type { Hex, Address } from "viem";
import { parseUnits } from "viem";
import { getKyberZaasClient } from "../../tools/kyberswap/zaas/client.js";
import { KS_ZAP_ROUTER_POSITION, NATIVE_TOKEN_ADDRESS } from "../../tools/kyberswap/constants.js";
import { getKyberEvmClients, ensureKyberAllowance, verifyRouterAddress, sendKyberTransaction } from "../../tools/kyberswap/evm-utils.js";
import { resolveChain, resolveTokenAddress, requireFeature, formatUsd } from "./helpers.js";
import { slugToChainId } from "../../tools/kyberswap/chains.js";
import { requireWalletAndKeystore } from "../../tools/wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe, validateSlippage } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";

export function createZapInAction(): Command {
  return new Command("in")
    .description("Add liquidity to a concentrated LP position via KyberSwap ZaaS")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .requiredOption("--dex <dex>", "DEX identifier (e.g. DEX_UNISWAPV3)")
    .requiredOption("--pool <address>", "Pool contract address")
    .requiredOption("--token-in <token>", "Token to zap with (address or symbol)")
    .requiredOption("--amount-in <amount>", "Amount to zap (human-readable)")
    .option("--tick-lower <tick>", "Lower tick for new position")
    .option("--tick-upper <tick>", "Upper tick for new position")
    .option("--position <id>", "Existing position ID to add to")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "100")
    .option("--dry-run", "Preview zap without executing")
    .option("--yes", "Confirm zap execution")
    .option("--approve-exact", "Approve exact amount")
    .exitOverride()
    .action(async (options: {
      chain: string; dex: string; pool: string; tokenIn: string; amountIn: string;
      tickLower?: string; tickUpper?: string; position?: string;
      slippageBps: string; dryRun?: boolean; yes?: boolean; approveExact?: boolean;
    }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "zaas");
      const chainId = slugToChainId(slug);
      const slippage = validateSlippage(parseIntSafe(options.slippageBps, "slippageBps"));

      const spin = spinner("Finding zap route...");
      spin.start();

      const tokenInAddr = await resolveTokenAddress(options.tokenIn, chainId);
      const amountInWei = parseUnits(options.amountIn, 18).toString();

      const zaasClient = getKyberZaasClient();
      const routeResponse = await zaasClient.getZapInRoute(slug, {
        dex: options.dex,
        "pool.id": options.pool,
        "position.id": options.position,
        "position.tickLower": options.tickLower ? parseInt(options.tickLower, 10) : undefined,
        "position.tickUpper": options.tickUpper ? parseInt(options.tickUpper, 10) : undefined,
        tokensIn: tokenInAddr,
        amountsIn: amountInWei,
        slippage,
      });

      spin.succeed("Zap route found");

      const routeData = routeResponse.data;

      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({
            dryRun: true, chain: slug, chainId, dex: options.dex, pool: options.pool,
            tokenIn: tokenInAddr, amountIn: amountInWei, routeData,
          });
        } else {
          infoBox("Zap In Preview (Dry Run)", [
            `Chain: ${slug} (${chainId})`,
            `DEX: ${options.dex}`,
            `Pool: ${options.pool}`,
            `Token In: ${options.tokenIn} (${tokenInAddr})`,
            `Amount: ${options.amountIn}`,
            `Slippage: ${(slippage / 100).toFixed(2)}%`,
          ].join("\n"));
        }
        return;
      }

      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
      }

      const { address, privateKey } = requireWalletAndKeystore();

      if (!routeData.route || !routeData.routerAddress) {
        throw new EchoError(ErrorCodes.KYBER_ZAP_BUILD_FAILED, "ZaaS route response missing route data or router address");
      }

      verifyRouterAddress(routeData.routerAddress, KS_ZAP_ROUTER_POSITION);
      const { publicClient, walletClient } = getKyberEvmClients(slug, privateKey as Hex);

      // Approve if non-native
      if (tokenInAddr.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
        const spinApprove = spinner("Checking allowance...");
        spinApprove.start();
        const result = await ensureKyberAllowance(
          publicClient, walletClient, tokenInAddr, routeData.routerAddress,
          BigInt(amountInWei), options.approveExact,
        );
        spinApprove.succeed(result ? "Token approved" : "Allowance sufficient");
      }

      // Build zap tx
      const spinBuild = spinner("Building zap transaction...");
      spinBuild.start();

      const buildResponse = await zaasClient.buildZapIn(slug, {
        sender: address,
        recipient: address,
        route: routeData.route,
      });

      spinBuild.succeed("Zap transaction built");

      // Send
      const spinSend = spinner("Sending zap transaction...");
      spinSend.start();

      const txHash = await sendKyberTransaction(publicClient, walletClient, {
        to: buildResponse.data.routerAddress,
        data: buildResponse.data.callData as Hex,
        value: BigInt(buildResponse.data.value),
      });

      spinSend.succeed("Liquidity added");

      if (isHeadless()) {
        writeJsonSuccess({
          txHash, chain: slug, chainId, dex: options.dex, pool: options.pool,
          tokenIn: tokenInAddr, amountIn: amountInWei,
        });
      } else {
        successBox("Liquidity Added (Zap In)", [
          `Pool: ${options.pool}`,
          `DEX: ${options.dex}`,
          `Amount: ${options.amountIn} ${options.tokenIn}`,
          `Tx: ${colors.info(txHash)}`,
        ].join("\n"));
      }
    });
}
