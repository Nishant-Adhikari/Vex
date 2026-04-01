/**
 * Polymarket Bridge handlers — deposit, withdraw, quote, status.
 * All public, no auth.
 */

import { getPolyBridgeClient } from "@tools/polymarket/bridge/client.js";
import type { ProtocolHandler } from "../types.js";
import { str, ok, fail } from "../handler-helpers.js";

export const BRIDGE_HANDLERS: Record<string, ProtocolHandler> = {
  "polymarket.bridge.assets": async () => {
    const assets = await getPolyBridgeClient().getSupportedAssets();
    return ok({ count: assets.length, assets });
  },

  "polymarket.bridge.deposit": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    return ok(await getPolyBridgeClient().createDeposit(address));
  },

  "polymarket.bridge.withdraw": async (p) => {
    const address = str(p, "address"), toChainId = str(p, "toChainId");
    const toTokenAddress = str(p, "toTokenAddress"), recipientAddr = str(p, "recipientAddr");
    if (!address || !toChainId || !toTokenAddress || !recipientAddr)
      return fail("Missing required: address, toChainId, toTokenAddress, recipientAddr");
    return ok(await getPolyBridgeClient().createWithdraw({ address, toChainId, toTokenAddress, recipientAddr }));
  },

  "polymarket.bridge.quote": async (p) => {
    const fromAmountBaseUnit = str(p, "fromAmountBaseUnit"), fromChainId = str(p, "fromChainId");
    const fromTokenAddress = str(p, "fromTokenAddress"), recipientAddress = str(p, "recipientAddress");
    const toChainId = str(p, "toChainId"), toTokenAddress = str(p, "toTokenAddress");
    if (!fromAmountBaseUnit || !fromChainId || !fromTokenAddress || !recipientAddress || !toChainId || !toTokenAddress)
      return fail("Missing required: fromAmountBaseUnit, fromChainId, fromTokenAddress, recipientAddress, toChainId, toTokenAddress");
    return ok(await getPolyBridgeClient().getQuote({ fromAmountBaseUnit, fromChainId, fromTokenAddress, recipientAddress, toChainId, toTokenAddress }));
  },

  "polymarket.bridge.status": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const transactions = await getPolyBridgeClient().getStatus(address);
    return ok({ count: transactions.length, transactions });
  },
};
