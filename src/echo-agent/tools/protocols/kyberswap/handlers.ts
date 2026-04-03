/**
 * KyberSwap protocol handlers — direct TS client calls.
 *
 * All handlers import from @tools/kyberswap/ clients.
 * Execution helpers from @commands/kyberswap/helpers.ts.
 * No CLI spawning. Wallet via @tools/wallet/multi-auth.
 */

import { getKyberAggregatorClient } from "@tools/kyberswap/aggregator/client.js";
import { getKyberTokenApiClient } from "@tools/kyberswap/token-api/client.js";
import { getKyberLimitOrderClient } from "@tools/kyberswap/limit-order/client.js";
import { getKyberLimitOrderTakerClient } from "@tools/kyberswap/limit-order/taker-client.js";
import { signEip712Message } from "@tools/kyberswap/limit-order/signing.js";
import { getKyberZaasClient } from "@tools/kyberswap/zaas/client.js";
import { getKyberCommonClient } from "@tools/kyberswap/common/client.js";
import { getKyberChains, resolveChainSlug, slugToChainId, chainSupportsFeature } from "@tools/kyberswap/chains.js";
import {
  getKyberEvmClients,
  ensureKyberAllowance,
  sendKyberTransaction,
  sendKyberTransactionWithReceipt,
  extractMintedNftId,
  extractErc1155Position,
  ensureErc721Approval,
  ensureErc1155ApprovalForAll,
  verifyRouterAddress,
} from "@tools/kyberswap/evm-utils.js";
import { META_AGGREGATION_ROUTER_V2, DSLO_PROTOCOL, KS_ZAP_ROUTER_POSITION, NATIVE_TOKEN_ADDRESS } from "@tools/kyberswap/constants.js";
import { resolveTokenMetadata, resolveTokenMetadataStrict, resolveTokenAddress, requireFeature, resolveChainWithId } from "@commands/kyberswap/helpers.js";
import type { ZapDexEntry } from "@tools/kyberswap/zaas/zap-dexes/types.js";
import type { ZapRouteResponse } from "@tools/kyberswap/zaas/types.js";
import { EchoError, ErrorCodes } from "../../../../errors.js";
import logger from "@utils/logger.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";

import { isAddress, parseUnits, formatUnits, getAddress, maxUint256, type Address, type Hex } from "viem";
import type { ToolResult } from "../../types.js";
import type { ProtocolHandler } from "../types.js";
import { str, num, ok, fail } from "../handler-helpers.js";

// ── Approval target resolution (R1: approvalTargetKind → concrete address) ──

function resolveZapApprovalTarget(
  entry: ZapDexEntry, pool: string, routeResp?: ZapRouteResponse,
): Address {
  switch (entry.approvalTargetKind) {
    case "poolAddress":
      return getAddress(pool);
    case "positionManager":
      // NFT Position Manager — ZaaS API doesn't reliably return PM address.
      // For known NFT DEXes the pool param IS the position manager contract.
      // This is correct for UniV3/V4 NFPM, Algebra NFPM, etc.
      // If ZaaS ever returns a distinct PM address, prefer that.
      return getAddress(pool);
    case "vaultShare": {
      // Vault share address MUST come from ZaaS poolDetails, not from pool param
      const vaultAddr = routeResp?.data?.poolDetails?.address;
      if (vaultAddr) return getAddress(vaultAddr);
      // Fail loud — approving wrong contract for vault family is a funds risk
      throw new EchoError(
        ErrorCodes.KYBER_API_ERROR,
        `Vault share address not available from ZaaS API for DEX ${entry.id}. Cannot determine approval target.`,
        "This DEX requires poolDetails.address from the route response.",
      );
    }
    case "binManager":
      return getAddress(pool);
    case "lpToken":
      return getAddress(pool);
    case "none":
      // Should not reach here — caller guards against "none"
      return getAddress(pool);
  }
}

// ── Position key builder (per-family strategy, R5: vault fail-loud) ──

function buildPositionKey(
  entry: ZapDexEntry, chain: string, pool: string, wallet: string,
  ref?: string, vaultAddress?: string,
): string | undefined {
  switch (entry.positionKeyStrategy) {
    case "nftTokenId": return ref;
    case "chainPoolWallet": return `${chain}:lp:${pool}:${wallet}`;
    case "chainVaultWallet": {
      if (!vaultAddress) {
        logger.warn("sync.lp.vault_address_unknown", { chain, pool, dex: entry.id });
      }
      const vault = vaultAddress ?? pool;
      return `${chain}:vault:${vault}:${wallet}`;
    }
    case "erc1155TokenId": return ref;
    case "none": return undefined;
  }
}

// ── Shared swap execution (sell + buy use same routing, differ in trade_side) ──

async function executeKyberSwap(p: Record<string, unknown>, side: "buy" | "sell"): Promise<ToolResult> {
  const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
  if (!chain || !tokenInRaw || !tokenOutRaw || !amountInRaw) return fail("Missing required: chain, tokenIn, tokenOut, amountIn");

  const slug = resolveChainSlug(chain);
  requireFeature(slug, "aggregator");
  const chainId = slugToChainId(slug);
  const wallet = requireEvmWallet();
  // Strict: address-only for mutating swaps — symbols rejected
  const tokenIn = await resolveTokenMetadataStrict(tokenInRaw, chainId);
  const tokenOut = await resolveTokenMetadataStrict(tokenOutRaw, chainId);

  // Token safety gate — check honeypot + FoT/tax for non-native tokens (R8)
  if (!tokenIn.isNative) {
    const inCheck = await getKyberTokenApiClient().getHoneypotFotInfo(chainId, tokenIn.address);
    if (inCheck.isHoneypot) return fail(`Token ${tokenIn.symbol} (${tokenIn.address}) flagged as honeypot. Aborting swap.`);
    if (inCheck.isFOT && inCheck.tax > 50) return fail(`Token ${tokenIn.symbol} has ${inCheck.tax}% fee-on-transfer tax — likely a scam. Aborting.`);
    if (inCheck.isFOT && inCheck.tax > 0) logger.warn("kyberswap.swap.fot_warning", { token: tokenIn.symbol, address: tokenIn.address, tax: inCheck.tax });
  }
  if (!tokenOut.isNative) {
    const outCheck = await getKyberTokenApiClient().getHoneypotFotInfo(chainId, tokenOut.address);
    if (outCheck.isHoneypot) return fail(`Token ${tokenOut.symbol} (${tokenOut.address}) flagged as honeypot. Aborting swap.`);
    if (outCheck.isFOT && outCheck.tax > 50) return fail(`Token ${tokenOut.symbol} has ${outCheck.tax}% fee-on-transfer tax — likely a scam. Aborting.`);
    if (outCheck.isFOT && outCheck.tax > 0) logger.warn("kyberswap.swap.fot_warning", { token: tokenOut.symbol, address: tokenOut.address, tax: outCheck.tax });
  }
  const amountIn = parseUnits(amountInRaw, tokenIn.decimals);

  const routeResp = await getKyberAggregatorClient().getRoute(slug, {
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    amountIn: amountIn.toString(),
  });
  const { routeSummary, routerAddress } = routeResp.data;
  verifyRouterAddress(routerAddress, META_AGGREGATION_ROUTER_V2);

  if (p.dryRun === true) {
    return ok({ dryRun: true, side, chain: slug, routeSummary, routerAddress });
  }

  const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
  if (tokenIn.address.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
    await ensureKyberAllowance(publicClient, walletClient, tokenIn.address, routerAddress, amountIn, p.approveExact === true);
  }

  const slippage = num(p, "slippageBps") ?? 50;
  const buildResp = await getKyberAggregatorClient().buildRoute(slug, {
    routeSummary,
    sender: wallet.address,
    recipient: (str(p, "recipient") || wallet.address) as Address,
    slippageTolerance: slippage,
  });

  const txHash = await sendKyberTransaction(publicClient, walletClient, {
    to: getAddress(buildResp.data.routerAddress),
    data: buildResp.data.data as Hex,
    value: BigInt(buildResp.data.transactionValue),
  });

  const inputIsNative = tokenIn.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
  const outputIsNative = tokenOut.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
  const hasNativeLeg = inputIsNative || outputIsNative;

  // Benchmark: only when native token is one leg
  const { resolveChainBenchmark } = await import("@echo-agent/sync/benchmark.js");
  const benchmarkAssetKey = hasNativeLeg ? resolveChainBenchmark(slug) : undefined;

  return {
    success: true,
    output: JSON.stringify({ txHash, side, chain: slug, tokenIn: tokenIn.symbol, tokenOut: tokenOut.symbol, amountIn: buildResp.data.amountIn, amountOut: buildResp.data.amountOut, amountInUsd: buildResp.data.amountInUsd, amountOutUsd: buildResp.data.amountOutUsd }, null, 2),
    data: { txHash, _tradeCapture: {
      type: "swap", chain: slug, status: "executed",
      inputToken: tokenIn.symbol, outputToken: tokenOut.symbol,
      inputTokenAddress: tokenIn.address, outputTokenAddress: tokenOut.address,
      inputAmount: buildResp.data.amountIn, outputAmount: buildResp.data.amountOut,
      signature: txHash, walletAddress: wallet.address, tradeSide: side,
      instrumentKey: `${slug}:${side === "buy" ? tokenOut.address : tokenIn.address}`,
      inputValueUsd: buildResp.data.amountInUsd, outputValueUsd: buildResp.data.amountOutUsd,
      feeValueUsd: buildResp.data.gasUsd, valuationSource: "kyberswap_exact",
      benchmarkAssetKey: benchmarkAssetKey ?? undefined,
      settlementAssetKey: side === "buy" ? tokenIn.symbol : tokenOut.symbol,
      inputValueNative: inputIsNative ? formatUnits(amountIn, tokenIn.decimals) : undefined,
      outputValueNative: outputIsNative ? formatUnits(BigInt(buildResp.data.amountOut), tokenOut.decimals) : undefined,
      meta: { dex: "kyberswap", side },
    } },
  };
}

// ── Handler map ──────────────────────────────────────────────────

export const KYBERSWAP_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Chains ───────────────────────────────────────────────────────
  "kyberswap.chains": async () => ok(getKyberChains()),
  "kyberswap.chains.supported": async () => ok(await getKyberCommonClient().getSupportedChains()),

  // ── Tokens ───────────────────────────────────────────────────────
  "kyberswap.tokens.search": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { chainId } = resolveChainWithId(chain);
    const tokens = await getKyberTokenApiClient().searchTokens(String(chainId), {
      name: str(p, "query") || undefined,
      isWhitelisted: p.whitelisted === true ? true : undefined,
      pageSize: num(p, "limit"),
    });
    return ok({ chain, chainId, count: tokens.length, tokens });
  },
  "kyberswap.tokens.check": async (p) => {
    const chain = str(p, "chain"), address = str(p, "address");
    if (!chain || !address) return fail("Missing required: chain, address");
    const { chainId } = resolveChainWithId(chain);
    const info = await getKyberTokenApiClient().getHoneypotFotInfo(chainId, address);
    return ok({ chain, chainId, address, ...info });
  },

  // ── Swap ─────────────────────────────────────────────────────────
  "kyberswap.swap.quote": async (p) => {
    const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
    if (!chain || !tokenInRaw || !tokenOutRaw || !amountInRaw) return fail("Missing required: chain, tokenIn, tokenOut, amountIn");

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "aggregator");
    const chainId = slugToChainId(slug);
    const tokenIn = await resolveTokenMetadata(tokenInRaw, chainId);
    const tokenOut = await resolveTokenMetadata(tokenOutRaw, chainId);
    const amountIn = parseUnits(amountInRaw, tokenIn.decimals).toString();

    const response = await getKyberAggregatorClient().getRoute(slug, {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn,
    });

    return ok({
      chain: slug, chainId,
      tokenIn: { address: tokenIn.address, symbol: tokenIn.symbol, decimals: tokenIn.decimals },
      tokenOut: { address: tokenOut.address, symbol: tokenOut.symbol, decimals: tokenOut.decimals },
      routeSummary: response.data.routeSummary,
      routerAddress: response.data.routerAddress,
    });
  },

  "kyberswap.swap.sell": (p) => executeKyberSwap(p, "sell"),
  "kyberswap.swap.buy": (p) => executeKyberSwap(p, "buy"),

  // ── Limit Orders (Maker) ─────────────────────────────────────────
  "kyberswap.limitOrder.list": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { slug, chainId } = resolveChainWithId(chain);
    requireFeature(slug, "limitOrder");
    const wallet = requireEvmWallet();
    const orders = await getKyberLimitOrderClient().getOrders({
      chainId: String(chainId),
      maker: wallet.address,
      status: str(p, "status") || undefined,
    });
    return ok({ chain: slug, count: orders.length, orders });
  },

  "kyberswap.limitOrder.activeMakingAmount": async (p) => {
    const chain = str(p, "chain"), makerAsset = str(p, "makerAsset");
    if (!chain || !makerAsset) return fail("Missing required: chain, makerAsset");
    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();
    const amount = await getKyberLimitOrderClient().getActiveMakingAmount(String(chainId), makerAsset, wallet.address);
    return ok({ chain: slug, makerAsset, activeMakingAmount: amount });
  },

  "kyberswap.limitOrder.create": async (p) => {
    const chain = str(p, "chain"), makerAssetRaw = str(p, "makerAsset"), takerAssetRaw = str(p, "takerAsset");
    const makingAmountRaw = str(p, "makingAmount"), takingAmountRaw = str(p, "takingAmount"), expires = str(p, "expires");
    if (!chain || !makerAssetRaw || !takerAssetRaw || !makingAmountRaw || !takingAmountRaw || !expires)
      return fail("Missing required: chain, makerAsset, takerAsset, makingAmount, takingAmount, expires");

    const { slug, chainId } = resolveChainWithId(chain);
    requireFeature(slug, "limitOrder");
    const wallet = requireEvmWallet();
    // Strict: address-only for mutating limit orders
    const makerToken = await resolveTokenMetadataStrict(makerAssetRaw, chainId);
    const takerToken = await resolveTokenMetadataStrict(takerAssetRaw, chainId);
    const makingAmount = parseUnits(makingAmountRaw, makerToken.decimals).toString();
    const takingAmount = parseUnits(takingAmountRaw, takerToken.decimals).toString();

    const expiresSeconds = parseDuration(expires);
    const expiredAt = Math.floor(Date.now() / 1000) + expiresSeconds;

    // Get unsigned EIP-712
    const eip712 = await getKyberLimitOrderClient().getSignMessage({
      chainId: String(chainId),
      makerAsset: makerToken.address,
      takerAsset: takerToken.address,
      maker: wallet.address,
      makingAmount,
      takingAmount,
      expiredAt,
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, makerAsset: makerToken.symbol, takerAsset: takerToken.symbol, makingAmount, takingAmount, expiredAt, salt: eip712.message.salt });
    }

    // Sign
    const signature = await signEip712Message(wallet.privateKey, eip712);

    // Create
    const result = await getKyberLimitOrderClient().createOrder({
      chainId: String(chainId),
      makerAsset: makerToken.address,
      takerAsset: takerToken.address,
      maker: wallet.address,
      makingAmount,
      takingAmount,
      expiredAt,
      salt: eip712.message.salt,
      signature,
    });

    return {
      success: true,
      output: JSON.stringify({ chain: slug, orderId: result.orderId, makerAsset: makerToken.symbol, takerAsset: takerToken.symbol, makingAmount, takingAmount, expiredAt }, null, 2),
      data: {
        orderId: result.orderId,
        _tradeCapture: {
          type: "order", chain: slug, status: "open",
          walletAddress: wallet.address,
          positionKey: String(result.orderId),
          instrumentKey: `${slug}:lo:${makerToken.address}:${takerToken.address}`,
          inputTokenAddress: makerToken.address, inputToken: makerToken.symbol,
          outputTokenAddress: takerToken.address, outputToken: takerToken.symbol,
          inputAmount: makingAmount, outputAmount: takingAmount,
          meta: { orderType: "limitOrder", expiredAt },
        },
      },
    };
  },

  "kyberswap.limitOrder.cancel": async (p) => {
    const chain = str(p, "chain"), orderId = num(p, "orderId");
    if (!chain || orderId == null) return fail("Missing required: chain, orderId");
    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();

    const eip712 = await getKyberLimitOrderClient().getCancelSignMessage({
      chainId: String(chainId),
      maker: wallet.address,
      orderIds: [orderId],
    });
    const signature = await signEip712Message(wallet.privateKey, eip712);
    await getKyberLimitOrderClient().cancelOrders({ ...eip712, signature });

    return { success: true, output: JSON.stringify({ chain: slug, orderId, method: "gasless", status: "cancelled" }, null, 2), data: { orderId: String(orderId), _tradeCapture: { type: "order", chain: slug, status: "cancelled", walletAddress: wallet.address, positionKey: String(orderId), meta: { orderType: "limitOrder", method: "gasless" } } } };
  },

  "kyberswap.limitOrder.hardCancel": async (p) => {
    const chain = str(p, "chain"), orderId = num(p, "orderId");
    if (!chain || orderId == null) return fail("Missing required: chain, orderId");
    const { slug } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();

    const encoded = await getKyberLimitOrderClient().encodeCancelBatch([orderId]);
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const txHash = await sendKyberTransaction(publicClient, walletClient, {
      to: DSLO_PROTOCOL,
      data: encoded.encodedData as Hex,
    });

    return { success: true, output: JSON.stringify({ chain: slug, orderId, txHash, method: "hard-cancel" }, null, 2), data: { txHash, orderId: String(orderId), _tradeCapture: { type: "order", chain: slug, status: "cancelled", walletAddress: wallet.address, positionKey: String(orderId), signature: txHash, meta: { orderType: "limitOrder", method: "hard-cancel" } } } };
  },

  // ── Limit Orders (Taker) ─────────────────────────────────────────
  "kyberswap.limitOrder.pairs": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { slug, chainId } = resolveChainWithId(chain);
    const pairs = await getKyberLimitOrderTakerClient().getTradingPairs(String(chainId));
    return ok({ chain: slug, count: pairs.length, pairs });
  },

  "kyberswap.limitOrder.takerOrders": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { slug, chainId } = resolveChainWithId(chain);
    const orders = await getKyberLimitOrderTakerClient().getTakerOrders({
      chainId: String(chainId),
      makerAsset: str(p, "makerAsset") || undefined,
      takerAsset: str(p, "takerAsset") || undefined,
    });
    return ok({ chain: slug, count: orders.length, orders });
  },

  "kyberswap.limitOrder.fill": async (p) => {
    const chain = str(p, "chain"), orderId = num(p, "orderId");
    const takingAmount = str(p, "takingAmount"), thresholdAmount = str(p, "thresholdAmount");
    if (!chain || orderId == null || !takingAmount || !thresholdAmount)
      return fail("Missing required: chain, orderId, takingAmount, thresholdAmount");

    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();

    const opSig = await getKyberLimitOrderTakerClient().getOperatorSignature(String(chainId), [orderId]);
    if (!opSig.operatorSignatures[0]) return fail("No operator signature returned");

    const encoded = await getKyberLimitOrderTakerClient().encodeFillOrder({
      orderId,
      takingAmount,
      thresholdAmount,
      target: wallet.address,
      operatorSignature: opSig.operatorSignatures[0],
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, orderId, encodedData: encoded.encodedData.slice(0, 50) + "..." });
    }

    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const to = encoded.routerAddress ? getAddress(encoded.routerAddress) : DSLO_PROTOCOL;
    const txHash = await sendKyberTransaction(publicClient, walletClient, { to, data: encoded.encodedData as Hex });

    return { success: true, output: JSON.stringify({ chain: slug, orderId, txHash }, null, 2), data: { txHash, orderId: String(orderId), _tradeCapture: { type: "order", chain: slug, status: "filled", walletAddress: wallet.address, positionKey: String(orderId), signature: txHash, tradeSide: "buy", meta: { orderType: "limitOrder", action: "fill" } } } };
  },

  "kyberswap.limitOrder.batchFill": async (p) => {
    const chain = str(p, "chain");
    const orderIdsRaw = str(p, "orderIds"), takingAmountsRaw = str(p, "takingAmounts"), thresholdAmount = str(p, "thresholdAmount");
    if (!chain || !orderIdsRaw || !takingAmountsRaw || !thresholdAmount)
      return fail("Missing required: chain, orderIds, takingAmounts, thresholdAmount");

    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();
    const orderIds = orderIdsRaw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
    const takingAmounts = takingAmountsRaw.split(",").map(s => s.trim()).filter(Boolean);

    if (orderIds.length === 0) return fail("No valid order IDs provided");
    if (orderIds.length !== takingAmounts.length) return fail("orderIds and takingAmounts must have same length");

    const opSig = await getKyberLimitOrderTakerClient().getOperatorSignature(String(chainId), orderIds);
    if (opSig.operatorSignatures.length !== orderIds.length) return fail("Operator signature count mismatch");

    const encoded = await getKyberLimitOrderTakerClient().encodeFillBatchOrders({
      orderIds,
      takingAmounts,
      thresholdAmount,
      target: wallet.address,
      operatorSignatures: opSig.operatorSignatures,
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, orderIds, encodedData: encoded.encodedData.slice(0, 50) + "..." });
    }

    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const to = encoded.routerAddress ? getAddress(encoded.routerAddress) : DSLO_PROTOCOL;
    const txHash = await sendKyberTransaction(publicClient, walletClient, { to, data: encoded.encodedData as Hex });

    const captureItems = orderIds.map(id => ({
      type: "order" as const, chain: slug, status: "filled" as const,
      walletAddress: wallet.address, positionKey: String(id),
      signature: txHash, tradeSide: "buy" as const,
      meta: { orderType: "limitOrder", action: "fill" },
    }));

    return { success: true, output: JSON.stringify({ chain: slug, orderIds, txHash }, null, 2), data: { txHash, _tradeCapture: captureItems[0] ?? { type: "order", chain: slug, status: "filled", walletAddress: wallet.address, signature: txHash, meta: { orderType: "limitOrder", action: "batchFill", orderIds } }, _tradeCaptureItems: captureItems } };
  },

  "kyberswap.limitOrder.cancelAll": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();

    // Prefetch active orders BEFORE nonce increase for per-order itemization.
    // Race condition: orders may fill between list and cancel — acceptable,
    // fill would have its own capture. Prefetch is best-effort.
    const loClient = getKyberLimitOrderClient();
    const activeOrders = await loClient.getOrders({
      chainId: String(chainId), maker: wallet.address, status: "active",
    });

    const encoded = await loClient.encodeIncreaseNonce(String(chainId));
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const txHash = await sendKyberTransaction(publicClient, walletClient, {
      to: DSLO_PROTOCOL,
      data: encoded.encodedData as Hex,
    });

    const captureItems = activeOrders.map(order => ({
      type: "order" as const, chain: slug, status: "cancelled" as const,
      walletAddress: wallet.address, positionKey: String(order.id),
      signature: txHash,
      meta: { orderType: "limitOrder", action: "cancelAll" },
    }));

    return { success: true, output: JSON.stringify({ chain: slug, txHash, method: "increase-nonce", cancelledCount: captureItems.length }, null, 2), data: { txHash, _tradeCapture: captureItems[0] ?? { type: "order", chain: slug, status: "cancelled", walletAddress: wallet.address, signature: txHash, meta: { orderType: "limitOrder", action: "cancelAll" } }, _tradeCaptureItems: captureItems.length > 0 ? captureItems : undefined } };
  },

  // ── Zap ──────────────────────────────────────────────────────────
  "kyberswap.zap.in": async (p) => {
    const chain = str(p, "chain"), dex = str(p, "dex"), pool = str(p, "pool");
    const tokenIn = str(p, "tokenIn"), amountIn = str(p, "amountIn");
    if (!chain || !dex || !pool || !tokenIn || !amountIn) return fail("Missing required: chain, dex, pool, tokenIn, amountIn");

    // Validate tokenIn is a properly formatted address
    if (tokenIn.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase() && !isAddress(tokenIn)) {
      return fail(`Invalid tokenIn address: "${tokenIn}". Resolve via khalani.tokens.search first.`);
    }

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "zaas");

    // Validate DEX is known and supports zap-in
    const { getZapDexConfig } = await import("@tools/kyberswap/zaas/zap-dexes/index.js");
    const zapDexConfig = getZapDexConfig(slug);
    const zapDexEntry = zapDexConfig?.dexes.find(d => d.id === dex);
    if (!zapDexEntry) return fail(`Unknown DEX "${dex}" on ${slug}. Query kyberswap.zap.list for supported DEXes.`);
    if (zapDexEntry.verification === "tbd") return fail(`DEX ${dex} classified as TBD — not yet safe for automated execution. Report to maintainers.`);
    if (!zapDexEntry.supports.includes("zap-in")) return fail(`DEX ${dex} on ${slug} is source-only — cannot be used as zap-in destination.`);

    const wallet = requireEvmWallet();

    const routeResp = await getKyberZaasClient().getZapInRoute(slug, {
      dex,
      "pool.id": pool,
      tokensIn: tokenIn,
      amountsIn: amountIn,
      slippage: num(p, "slippageBps"),
      "position.id": str(p, "positionRef") || undefined,
      "position.tickLower": num(p, "tickLower"),
      "position.tickUpper": num(p, "tickUpper"),
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, zapDetails: routeResp.data.zapDetails, routerAddress: routeResp.data.routerAddress });
    }

    if (!routeResp.data.route || !routeResp.data.routerAddress) return fail("No zap route returned");
    verifyRouterAddress(routeResp.data.routerAddress, KS_ZAP_ROUTER_POSITION);

    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    if (tokenIn.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
      await ensureKyberAllowance(publicClient, walletClient, getAddress(tokenIn), routeResp.data.routerAddress, BigInt(amountIn), p.approveExact === true);
    }

    const buildResp = await getKyberZaasClient().buildZapIn(slug, { sender: wallet.address, recipient: wallet.address, route: routeResp.data.route });
    const { hash: txHash, receipt } = await sendKyberTransactionWithReceipt(publicClient, walletClient, { to: getAddress(buildResp.data.routerAddress), data: buildResp.data.callData as Hex, value: BigInt(buildResp.data.value) });

    // Capture position ref from receipt based on DEX family (R11: reuse zapDexEntry from above)
    let positionRef = str(p, "positionRef") || undefined;
    if (!positionRef) {
      switch (zapDexEntry.captureKind) {
        case "receiptNftMint":
          positionRef = extractMintedNftId(receipt.logs, wallet.address, pool) ?? undefined;
          break;
        case "receiptErc1155":
          positionRef = extractErc1155Position(receipt.logs, wallet.address) ?? undefined;
          break;
        case "shareBalance":
        case "none":
          break;
      }
    }

    const zapDetails = routeResp.data.zapDetails;
    const vaultAddr = routeResp.data.poolDetails?.address;
    const positionKey = buildPositionKey(zapDexEntry, slug, pool, wallet.address, positionRef, vaultAddr);

    return { success: true, output: JSON.stringify({ txHash, chain: slug, dex, pool, positionRef, positionKey }, null, 2), data: { txHash, _tradeCapture: {
      type: "lp", chain: slug, status: "executed", walletAddress: wallet.address,
      positionKey, instrumentKey: `${slug}:lp:${pool}`,
      inputValueUsd: zapDetails?.initialAmountUsd,
      valuationSource: zapDetails?.initialAmountUsd ? "zaas_estimate" : "none",
      meta: { dex, pool, action: "zap-in", positionRef, zapDetails },
    } } };
  },

  "kyberswap.zap.out": async (p) => {
    const chain = str(p, "chain"), dex = str(p, "dex"), pool = str(p, "pool");
    const positionRef = str(p, "positionRef"), tokenOut = str(p, "tokenOut");
    if (!chain || !dex || !pool || !positionRef || !tokenOut) return fail("Missing required: chain, dex, pool, positionRef, tokenOut");

    // Validate tokenOut is a properly formatted address
    if (tokenOut.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase() && !isAddress(tokenOut)) {
      return fail(`Invalid tokenOut address: "${tokenOut}". Resolve via khalani.tokens.search first.`);
    }

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "zaas");
    const wallet = requireEvmWallet();

    // Lookup DEX family for approval routing
    const { getZapDexConfig } = await import("@tools/kyberswap/zaas/zap-dexes/index.js");
    const dexConfig = getZapDexConfig(slug);
    const dexEntry = dexConfig?.dexes.find(d => d.id === dex);
    if (!dexEntry) return fail(`Unknown DEX "${dex}" on ${slug}. Query kyberswap.zap.list for supported DEXes.`);
    if (dexEntry.verification === "tbd") return fail(`DEX ${dex} classified as TBD — not yet safe for automated execution. Report to maintainers.`);
    if (!dexEntry.supports.includes("zap-out")) return fail(`DEX ${dex} on ${slug} does not support zap-out.`);

    const collectFee = p.collectFee !== false; // default true
    const routeResp = await getKyberZaasClient().getZapOutRoute(slug, {
      dexFrom: dex,
      "poolFrom.id": pool,
      "positionFrom.id": positionRef,
      tokenOut,
      collectFee,
      liquidityOut: str(p, "liquidity") || undefined,
      slippage: num(p, "slippageBps"),
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, zapDetails: routeResp.data.zapDetails });
    }

    if (!routeResp.data.route || !routeResp.data.routerAddress) return fail("No zap route returned");
    const routerAddress = routeResp.data.routerAddress;
    verifyRouterAddress(routerAddress, KS_ZAP_ROUTER_POSITION);
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);

    // Family-aware approval — resolve target from approvalTargetKind (R1)
    const approvalTarget = resolveZapApprovalTarget(dexEntry, pool, routeResp);
    switch (dexEntry.approvalStandard) {
      case "erc721":
        await ensureErc721Approval(publicClient, walletClient, approvalTarget, BigInt(positionRef), routerAddress);
        break;
      case "erc20":
        await ensureKyberAllowance(publicClient, walletClient, approvalTarget, routerAddress, maxUint256);
        break;
      case "erc1155":
        await ensureErc1155ApprovalForAll(publicClient, walletClient, approvalTarget, routerAddress);
        break;
      case "none":
        break;
    }

    const buildResp = await getKyberZaasClient().buildZapOut(slug, { sender: wallet.address, recipient: wallet.address, route: routeResp.data.route });
    const txHash = await sendKyberTransaction(publicClient, walletClient, { to: getAddress(buildResp.data.routerAddress), data: buildResp.data.callData as Hex, value: BigInt(buildResp.data.value) });

    const zapDetails = routeResp.data.zapDetails;
    const outVaultAddr = routeResp.data.poolDetails?.address;
    const positionKey = buildPositionKey(dexEntry, slug, pool, wallet.address, positionRef, outVaultAddr);
    return { success: true, output: JSON.stringify({ txHash, chain: slug, positionRef, positionKey, collectFee }, null, 2), data: { txHash, _tradeCapture: {
      type: "lp", chain: slug, status: "executed", walletAddress: wallet.address,
      positionKey, instrumentKey: `${slug}:lp:${pool}`,
      outputValueUsd: zapDetails?.finalAmountUsd,
      valuationSource: zapDetails?.finalAmountUsd ? "zaas_estimate" : "none",
      meta: { dex, pool, action: "zap-out", positionRef, collectFee, zapDetails },
    } } };
  },

  "kyberswap.zap.migrate": async (p) => {
    const chain = str(p, "chain"), dexFrom = str(p, "dexFrom"), dexTo = str(p, "dexTo");
    const poolFrom = str(p, "poolFrom"), poolTo = str(p, "poolTo"), sourcePositionRef = str(p, "sourcePositionRef");
    if (!chain || !dexFrom || !dexTo || !poolFrom || !poolTo || !sourcePositionRef)
      return fail("Missing required: chain, dexFrom, dexTo, poolFrom, poolTo, sourcePositionRef");

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "zaas");
    const wallet = requireEvmWallet();

    // Validate source and destination DEXes
    const { getZapDexConfig } = await import("@tools/kyberswap/zaas/zap-dexes/index.js");
    const dexConfig = getZapDexConfig(slug);
    const srcEntry = dexConfig?.dexes.find(d => d.id === dexFrom);
    const dstEntry = dexConfig?.dexes.find(d => d.id === dexTo);
    if (!srcEntry) return fail(`Unknown source DEX "${dexFrom}" on ${slug}. Query kyberswap.zap.list for supported DEXes.`);
    if (!dstEntry) return fail(`Unknown destination DEX "${dexTo}" on ${slug}. Query kyberswap.zap.list for supported DEXes.`);
    if (srcEntry.verification === "tbd") return fail(`DEX ${dexFrom} classified as TBD — not yet safe for automated execution.`);
    if (dstEntry.verification === "tbd") return fail(`DEX ${dexTo} classified as TBD — not yet safe for automated execution.`);
    if (!srcEntry.supports.includes("zap-migrate-source")) return fail(`DEX ${dexFrom} does not support zap-migrate-source.`);
    if (!dstEntry.supports.includes("zap-migrate-destination")) return fail(`DEX ${dexTo} does not support zap-migrate-destination.`);

    const collectFee = p.collectFee !== false; // default true
    const routeResp = await getKyberZaasClient().getZapMigrateRoute(slug, {
      dexFrom,
      dexTo,
      "poolFrom.id": poolFrom,
      "poolTo.id": poolTo,
      "positionFrom.id": sourcePositionRef,
      "positionTo.tickLower": num(p, "tickLower"),
      "positionTo.tickUpper": num(p, "tickUpper"),
      liquidityOut: str(p, "liquidity") || undefined,
      collectFee,
      slippage: num(p, "slippageBps"),
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, zapDetails: routeResp.data.zapDetails });
    }

    if (!routeResp.data.route || !routeResp.data.routerAddress) return fail("No zap route returned");
    const routerAddress = routeResp.data.routerAddress;
    verifyRouterAddress(routerAddress, KS_ZAP_ROUTER_POSITION);
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);

    // Family-aware approval for source position — resolve target from approvalTargetKind (R1)
    const srcApprovalTarget = resolveZapApprovalTarget(srcEntry, poolFrom, routeResp);
    switch (srcEntry.approvalStandard) {
      case "erc721":
        await ensureErc721Approval(publicClient, walletClient, srcApprovalTarget, BigInt(sourcePositionRef), routerAddress);
        break;
      case "erc20":
        await ensureKyberAllowance(publicClient, walletClient, srcApprovalTarget, routerAddress, maxUint256);
        break;
      case "erc1155":
        await ensureErc1155ApprovalForAll(publicClient, walletClient, srcApprovalTarget, routerAddress);
        break;
      case "none":
        break;
    }

    const buildResp = await getKyberZaasClient().buildZapMigrate(slug, { sender: wallet.address, recipient: wallet.address, route: routeResp.data.route });
    const { hash: txHash, receipt } = await sendKyberTransactionWithReceipt(publicClient, walletClient, { to: getAddress(buildResp.data.routerAddress), data: buildResp.data.callData as Hex, value: BigInt(buildResp.data.value) });

    // Capture new position ref from receipt for destination DEX
    let newPositionRef: string | undefined;
    if (dstEntry.captureKind === "receiptNftMint") {
      newPositionRef = extractMintedNftId(receipt.logs, wallet.address) ?? undefined;
    } else if (dstEntry.captureKind === "receiptErc1155") {
      newPositionRef = extractErc1155Position(receipt.logs, wallet.address) ?? undefined;
    }

    const zapDetails = routeResp.data.zapDetails;
    const sourcePositionKey = buildPositionKey(srcEntry, slug, poolFrom, wallet.address, sourcePositionRef);
    const dstVaultAddr = routeResp.data.poolDetails?.address;
    const newPositionKey = buildPositionKey(dstEntry, slug, poolTo, wallet.address, newPositionRef, dstVaultAddr);

    // R6: Emit two capture items — close source + open destination
    const closeCapture = {
      type: "lp" as const, chain: slug, status: "executed" as const, walletAddress: wallet.address,
      positionKey: sourcePositionKey, instrumentKey: `${slug}:lp:${poolFrom}`,
      valuationSource: "none" as const,
      meta: { dex: dexFrom, pool: poolFrom, action: "zap-out", positionRef: sourcePositionRef, collectFee, zapDetails },
    };
    const openCapture = {
      type: "lp" as const, chain: slug, status: "executed" as const, walletAddress: wallet.address,
      positionKey: newPositionKey, instrumentKey: `${slug}:lp:${poolTo}`,
      inputValueUsd: zapDetails?.finalAmountUsd,
      valuationSource: (zapDetails?.finalAmountUsd ? "zaas_estimate" : "none") as string,
      meta: { dex: dexTo, pool: poolTo, action: "zap-in", positionRef: newPositionRef, zapDetails },
    };

    return { success: true, output: JSON.stringify({ txHash, chain: slug, sourcePositionRef, newPositionRef, sourcePositionKey, newPositionKey, from: poolFrom, to: poolTo, collectFee }, null, 2), data: { txHash, _tradeCapture: closeCapture, _tradeCaptureItems: [closeCapture, openCapture] } };
  },

  // ── Zap list (supported DEXes per chain — structured catalog) ───
  "kyberswap.zap.list": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const slug = resolveChainSlug(chain);

    const { getZapDexConfig } = await import("@tools/kyberswap/zaas/zap-dexes/index.js");
    const config = getZapDexConfig(slug);

    if (!config || config.dexes.length === 0) {
      return ok({ chain: slug, count: 0, dexes: [], note: `No ZaaS DEXes configured for ${slug}. Check KyberSwap ZaaS docs for supported chains.` });
    }

    return ok({
      chain: slug,
      lastVerified: config.lastVerified,
      count: config.dexes.length,
      dexes: config.dexes.map(d => ({
        id: d.id,
        name: d.name,
        supports: d.supports,
        verification: d.verification,
        positionRefKind: d.positionRefKind,
        approvalStandard: d.approvalStandard,
        approvalTargetKind: d.approvalTargetKind,
        captureKind: d.captureKind,
        positionKeyStrategy: d.positionKeyStrategy,
        dexscreenerIds: d.dexscreenerIds,
        dexscreenerLabels: d.dexscreenerLabels,
      })),
    });
  },
};

// ── Duration parser ──────────────────────────────────────────────

function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid duration: ${input}. Use: 1h, 24h, 7d, 30d`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 3600;
  if (unit === "d") return value * 86400;
  throw new Error(`Invalid duration unit: ${unit}`);
}
