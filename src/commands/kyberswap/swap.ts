/**
 * `echoclaw kyberswap swap` — sell and quote via KyberSwap Aggregator.
 *
 * KyberSwap only supports exact-input (amountIn). No swap buy.
 * Execution model: --dry-run (quote only) or --yes (execute).
 */

import { Command } from "commander";
import { formatUnits, parseUnits, type Hex, type Address } from "viem";
import { getKyberAggregatorClient } from "../../kyberswap/aggregator/client.js";
import { META_AGGREGATION_ROUTER_V2, NATIVE_TOKEN_ADDRESS } from "../../kyberswap/constants.js";
import { getKyberEvmClients, ensureKyberAllowance, verifyRouterAddress, sendKyberTransaction } from "../../kyberswap/evm-utils.js";
import { resolveChain, resolveTokenAddress, formatUsd, formatGas, requireFeature } from "./helpers.js";
import { slugToChainId } from "../../kyberswap/chains.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe, validateSlippage } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";

export function createSwapSubcommand(): Command {
  const swap = new Command("swap")
    .description("Token swap via KyberSwap Aggregator (18 chains, 400+ DEXs)")
    .exitOverride();

  // ── swap sell ─────────────────────────────────────────────────────

  swap
    .command("sell <tokenIn> <tokenOut>")
    .description("Sell exact amount of tokenIn for tokenOut")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .requiredOption("--amount-in <amount>", "Amount of tokenIn to sell (human-readable)")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "50")
    .option("--recipient <address>", "Recipient address (defaults to wallet)")
    .option("--dry-run", "Show quote without executing")
    .option("--yes", "Confirm the transaction")
    .option("--approve-exact", "Approve exact amount instead of unlimited")
    .action(async (tokenIn: string, tokenOut: string, options: {
      chain: string; amountIn: string; slippageBps: string;
      recipient?: string; dryRun?: boolean; yes?: boolean; approveExact?: boolean;
    }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "aggregator");
      const chainId = slugToChainId(slug);
      const slippageBps = validateSlippage(parseIntSafe(options.slippageBps, "slippageBps"));

      // Resolve token addresses
      const spin = spinner("Resolving tokens...");
      spin.start();

      const tokenInAddr = await resolveTokenAddress(tokenIn, chainId);
      const tokenOutAddr = await resolveTokenAddress(tokenOut, chainId);

      // For amount parsing: assume 18 decimals for native, use Token API for ERC-20
      // Simplified: parse as 18 decimals (most common), API accepts wei strings
      const amountInWei = parseUnits(options.amountIn, 18).toString();

      spin.text = "Finding best route...";

      const client = getKyberAggregatorClient();
      const routeResponse = await client.getRoute(slug, {
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        amountIn: amountInWei,
      });

      const { routeSummary, routerAddress } = routeResponse.data;
      spin.succeed("Route found");

      // Display quote
      const quoteInfo =
        `Sell: ${colors.value(options.amountIn)} ${tokenIn}\n` +
        `Receive: ~${colors.value(routeSummary.amountOut)} wei ${tokenOut}\n` +
        `Value: ${formatUsd(routeSummary.amountInUsd)} → ${formatUsd(routeSummary.amountOutUsd)}\n` +
        `Gas: ${formatGas(routeSummary.gas, routeSummary.gasUsd)}\n` +
        `Route: ${routeSummary.route.length} path(s) via ${routeSummary.route.flat().map(s => s.exchange).filter((v, i, a) => a.indexOf(v) === i).join(", ")}\n` +
        `Router: ${routerAddress}\n` +
        `Slippage: ${(slippageBps / 100).toFixed(2)}%`;

      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({
            dryRun: true, chain: slug, chainId, tokenIn: tokenInAddr, tokenOut: tokenOutAddr,
            amountIn: routeSummary.amountIn, amountOut: routeSummary.amountOut,
            amountInUsd: routeSummary.amountInUsd, amountOutUsd: routeSummary.amountOutUsd,
            gas: routeSummary.gas, gasUsd: routeSummary.gasUsd,
            routerAddress, routeID: routeSummary.routeID,
          });
        } else {
          infoBox("Swap Quote (Dry Run)", quoteInfo);
        }
        return;
      }

      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
      }

      // Execute swap
      const { address, privateKey } = requireWalletAndKeystore();
      verifyRouterAddress(routerAddress, META_AGGREGATION_ROUTER_V2);

      const { publicClient, walletClient } = getKyberEvmClients(slug, privateKey as Hex);

      const recipient = options.recipient ? (options.recipient as Address) : address;

      // Approve if non-native token
      if (tokenInAddr.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
        const spinApprove = spinner("Checking allowance...");
        spinApprove.start();
        const approvalResult = await ensureKyberAllowance(
          publicClient, walletClient,
          tokenInAddr, routerAddress,
          BigInt(routeSummary.amountIn),
          options.approveExact,
        );
        spinApprove.succeed(approvalResult ? "Token approved" : "Allowance sufficient");
      }

      // Build encoded tx
      const spinBuild = spinner("Building transaction...");
      spinBuild.start();

      const buildResponse = await client.buildRoute(slug, {
        routeSummary,
        sender: address,
        recipient,
        slippageTolerance: slippageBps,
      });

      spinBuild.succeed("Transaction built");

      // Send
      const spinSend = spinner("Sending transaction...");
      spinSend.start();

      const txHash = await sendKyberTransaction(publicClient, walletClient, {
        to: buildResponse.data.routerAddress,
        data: buildResponse.data.data as Hex,
        value: BigInt(buildResponse.data.transactionValue),
      });

      spinSend.succeed("Swap executed");

      if (isHeadless()) {
        writeJsonSuccess({
          txHash, chain: slug, chainId, tokenIn: tokenInAddr, tokenOut: tokenOutAddr,
          amountIn: buildResponse.data.amountIn, amountOut: buildResponse.data.amountOut,
          amountInUsd: buildResponse.data.amountInUsd, amountOutUsd: buildResponse.data.amountOutUsd,
          routerAddress: buildResponse.data.routerAddress, recipient,
        });
      } else {
        successBox("Swap Executed", `${quoteInfo}\nTx: ${colors.info(txHash)}`);
      }
    });

  // ── swap quote ────────────────────────────────────────────────────

  swap
    .command("quote <tokenIn> <tokenOut>")
    .description("Quote swap route (read-only, no wallet needed)")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .requiredOption("--amount-in <amount>", "Amount of tokenIn (human-readable)")
    .action(async (tokenIn: string, tokenOut: string, options: { chain: string; amountIn: string }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "aggregator");
      const chainId = slugToChainId(slug);

      const spin = spinner("Finding best route...");
      spin.start();

      const tokenInAddr = await resolveTokenAddress(tokenIn, chainId);
      const tokenOutAddr = await resolveTokenAddress(tokenOut, chainId);
      const amountInWei = parseUnits(options.amountIn, 18).toString();

      const client = getKyberAggregatorClient();
      const routeResponse = await client.getRoute(slug, {
        tokenIn: tokenInAddr, tokenOut: tokenOutAddr, amountIn: amountInWei,
      });

      const { routeSummary, routerAddress } = routeResponse.data;
      spin.succeed("Route found");

      if (isHeadless()) {
        writeJsonSuccess({
          chain: slug, chainId, tokenIn: tokenInAddr, tokenOut: tokenOutAddr,
          amountIn: routeSummary.amountIn, amountOut: routeSummary.amountOut,
          amountInUsd: routeSummary.amountInUsd, amountOutUsd: routeSummary.amountOutUsd,
          gas: routeSummary.gas, gasUsd: routeSummary.gasUsd,
          routerAddress, routeID: routeSummary.routeID,
          exchanges: routeSummary.route.flat().map(s => s.exchange).filter((v, i, a) => a.indexOf(v) === i),
        });
      } else {
        const exchanges = routeSummary.route.flat().map(s => s.exchange).filter((v, i, a) => a.indexOf(v) === i);
        infoBox("Swap Quote", [
          `Sell: ${colors.value(options.amountIn)} ${tokenIn}`,
          `Receive: ~${colors.value(routeSummary.amountOut)} wei ${tokenOut}`,
          `Value: ${formatUsd(routeSummary.amountInUsd)} → ${formatUsd(routeSummary.amountOutUsd)}`,
          `Gas: ${formatGas(routeSummary.gas, routeSummary.gasUsd)}`,
          `Route: ${routeSummary.route.length} path(s) via ${exchanges.join(", ")}`,
          `Router: ${routerAddress}`,
        ].join("\n"));
      }
    });

  return swap;
}
