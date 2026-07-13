import { Decimal } from "decimal.js";

import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import {
  ARBITRUM_NATIVE_USDC_ADDRESS,
  ARBITRUM_ONE_CHAIN_ID,
  HYPERLIQUID_BRIDGE2_MAINNET_ADDRESS,
  resolveHyperliquidNetwork,
} from "@tools/hyperliquid/constants.js";
import {
  executeHyperliquidBridge2Deposit,
  getHyperliquidBridge2DepositClients,
  parseHyperliquidBridge2DepositAmount,
} from "@tools/hyperliquid/deposit.js";
import type { HyperliquidTimeInForce } from "@tools/hyperliquid/types.js";
import type { ProtocolExecutionContext, ProtocolHandler } from "../types.js";
import { buildPositionProtectionSnapshot } from "./protection-snapshot.js";
import { builderForOrders } from "./builder-fee.js";
import {
  addressParam,
  auditCapture,
  buySell,
  decimal,
  exchangeOk,
  exchangeResult,
  fail,
  hyperliquidDepositCapture,
  infoClient,
  markForCoin,
  ok,
  positions,
  requiredBoolean,
  requiredNumber,
  requiredString,
  safeWireInteger,
  signingAddress,
  signingClients,
  string,
  usdMicros,
  withReadAddress,
} from "./handler-shared.js";

const TIME_IN_FORCE: ReadonlySet<HyperliquidTimeInForce> = new Set(["Gtc", "Ioc", "Alo", "FrontendMarket"]);

export const HYPERLIQUID_ACCOUNT_READ_HANDLERS: Record<string, ProtocolHandler> = {
  "hyperliquid.perp.markets": async () => {
    const info = infoClient();
    const [meta, contexts] = await Promise.all([info.meta(), info.metaAndAssetCtxs()]);
    return ok({ meta, contexts });
  },
  "hyperliquid.perp.positions": async (_params, context) => withReadAddress(context, async (address) => {
    const info = infoClient();
    const [state, orders, contexts] = await Promise.all([
      info.clearinghouseState(address),
      info.frontendOpenOrders(address),
      info.metaAndAssetCtxs(),
    ]);
    const positionViews = positions(state).map((position) => ({
      position,
      protection: buildPositionProtectionSnapshot(state, orders, string(position, "coin") ?? ""),
    }));
    const single = positionViews.length === 1 ? positionViews[0] : undefined;
    const coin = string(single?.position, "coin");
    const signedSize = string(single?.position, "szi");
    const markPx = coin === undefined ? undefined : markForCoin(contexts, coin);
    const display = coin !== undefined && signedSize !== undefined && markPx !== undefined
      ? {
          namespace: "hyperliquid" as const,
          kind: "position_summary" as const,
          coin,
          side: new Decimal(signedSize).gte(0) ? "long" as const : "short" as const,
          size: new Decimal(signedSize).abs().toFixed(),
          markPx,
          protectionState: single?.protection.state,
        }
      : undefined;
    return ok({
      address,
      positions: positionViews,
      ...(display === undefined ? {} : { _displayBlock: display }),
    });
  }),
  "hyperliquid.perp.orders": async (_params, context) => withReadAddress(
    context,
    async (address) => ok({ address, orders: await infoClient().frontendOpenOrders(address) }),
  ),
  "hyperliquid.perp.fills": async (params, context) => withReadAddress(context, async (address) => {
    const info = infoClient();
    const startTime = typeof params.startTime === "number" ? params.startTime : undefined;
    return ok({
      address,
      fills: startTime === undefined
        ? await info.userFills(address)
        : await info.userFillsByTime(address, startTime),
    });
  }),
  "hyperliquid.perp.funding": async (_params, context) => withReadAddress(
    context,
    async (address) => ok({ address, funding: await infoClient().userFunding(address) }),
  ),
  "hyperliquid.account.overview": async (_params, context) => withReadAddress(
    context,
    async (address) => ok({ address, account: await infoClient().clearinghouseState(address) }),
  ),
  "hyperliquid.spot.markets": async () => {
    const info = infoClient();
    const [meta, contexts] = await Promise.all([info.spotMeta(), info.spotMetaAndAssetCtxs()]);
    return ok({ meta, contexts });
  },
  "hyperliquid.spot.balances": async (_params, context) => withReadAddress(
    context,
    async (address) => ok({ address, balances: await infoClient().spotClearinghouseState(address) }),
  ),
  "hyperliquid.market.book": async (params) => {
    const coin = requiredString(params, "coin");
    return ok({ coin, book: await infoClient().l2Book(coin) });
  },
};

export const HYPERLIQUID_ACCOUNT_MUTATION_HANDLERS: Record<string, ProtocolHandler> = {
  "hyperliquid.spot.trade": spotTrade,
  "hyperliquid.deposit": deposit,
  "hyperliquid.transfer.usdClass": usdClassTransfer,
  "hyperliquid.withdraw": withdraw,
  "hyperliquid.transfer.send": send,
  "hyperliquid.vault.overview": vaultOverview,
  "hyperliquid.vault.transfer": vaultTransfer,
  "hyperliquid.staking.overview": stakingOverview,
  "hyperliquid.staking.delegate": stakingDelegate,
  "hyperliquid.staking.transfer": stakingTransfer,
  "hyperliquid.rewards.claim": claimRewards,
};

async function spotTrade(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const market = requiredString(params, "market"); const { info, meta, exchange } = await signingClients(context); const address = await signingAddress(context); const asset = (await meta.get()).spotByName.get(market); if (!asset) return fail(`Unknown Hyperliquid spot market "${market}".`);
  const tif = requiredString(params, "timeInForce") as HyperliquidTimeInForce; if (!TIME_IN_FORCE.has(tif)) return fail("timeInForce must be Gtc, Ioc, Alo, or FrontendMarket.");
  const price = decimal(params, "price"); const size = decimal(params, "size"); const side = buySell(params);
  const orderExchange = exchange.withBuilder(builderForOrders(info, exchange, address, context));
  const result = await orderExchange.spotOrder({ order: { a: asset.asset, b: side === "buy", p: price, s: size, r: false, t: { limit: { tif } } } });
  const capture = { type: "swap", chain: "hyperliquid", status: exchangeOk(result) ? "executed" : "failed", walletAddress: address, tradeSide: side, positionKey: `hyperliquid:spot:${market}:${address}`, instrumentKey: `hyperliquid:spot:${market}`, inputTokenAddress: "USDC", outputTokenAddress: market, inputAmount: size, outputAmount: size, inputValueUsd: new Decimal(price).mul(size).toFixed(), unitPriceUsd: price, valuationSource: "hyperliquid_order", meta: { market } };
  return exchangeResult(result, { market, _tradeCapture: capture });
}

async function deposit(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const network = resolveHyperliquidNetwork();
  if (network !== "mainnet") {
    return fail("hyperliquid.deposit is mainnet-only. The testnet Bridge2 deposit address is intentionally unsupported.");
  }
  const amountUsd = decimal(params, "amountUsd");
  // Validate the irreversible floor before resolving a signing key or opening
  // an RPC client. The executor repeats this invariant at its public boundary.
  parseHyperliquidBridge2DepositAmount(amountUsd);

  const wallet = await import("../../internal/wallet/resolve.js");
  let signer: ChainWallet;
  try {
    signer = wallet.resolveSigningWallet(context.walletResolution, context.walletPolicy, "eip155");
  } catch (error) {
    return wallet.walletScopeErrorToResult(error);
  }
  if (signer.family !== "eip155") return fail("Resolved wallet family mismatch.");

  const { txHash } = await executeHyperliquidBridge2Deposit(
    { network, amountUsd, owner: signer.address },
    getHyperliquidBridge2DepositClients(signer.privateKey),
  );
  return ok({
    amountUsd,
    txHash,
    chainId: ARBITRUM_ONE_CHAIN_ID,
    token: ARBITRUM_NATIVE_USDC_ADDRESS,
    bridge: HYPERLIQUID_BRIDGE2_MAINNET_ADDRESS,
    creditExpected: "less than 1 minute",
    verifyWith: "hyperliquid.account.overview",
    _tradeCapture: hyperliquidDepositCapture(signer.address, amountUsd, txHash),
  });
}

async function usdClassTransfer(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const amount = decimal(params, "amount"); const toPerp = requiredBoolean(params, "toPerp");
  const result = await exchange.usdClassTransfer({ amount, toPerp });
  return exchangeResult(result, { amount, toPerp, _tradeCapture: auditCapture("account", result, address, { action: "usdClassTransfer", toPerp, amount }) });
}

async function withdraw(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const amount = decimal(params, "amount"); const destination = addressParam(params, "destination");
  const result = await exchange.withdraw3({ destination, amount });
  return exchangeResult(result, { amount, recipient: destination, _tradeCapture: auditCapture("transfer", result, address, { action: "withdraw3", destination, amount }) });
}

async function send(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const amount = decimal(params, "amount"); const destination = addressParam(params, "destination"); const assetType = requiredString(params, "assetType");
  const result = assetType === "usd"
    ? await exchange.usdSend({ destination, amount })
    : assetType === "spot"
      ? await exchange.spotSend({ destination, token: requiredString(params, "token"), amount })
      : (() => { throw new Error("assetType must be usd or spot"); })();
  return exchangeResult(result, { amount, recipient: destination, assetType, _tradeCapture: auditCapture("transfer", result, address, { action: `${assetType}Send`, destination, amount, ...(assetType === "spot" ? { token: requiredString(params, "token") } : {}) }) });
}

async function vaultOverview(_params: Record<string, unknown>, context: ProtocolExecutionContext) {
  return withReadAddress(context, async (address) => ok({ address, vaults: await infoClient().userVaultEquities(address) }));
}

async function vaultTransfer(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const amount = decimal(params, "amount"); const isDeposit = requiredBoolean(params, "isDeposit"); const vaultAddress = addressParam(params, "vaultAddress");
  const result = await exchange.vaultTransfer({ vaultAddress, isDeposit, usd: usdMicros(amount) });
  return exchangeResult(result, { amount, vaultAddress, isDeposit, _tradeCapture: auditCapture("lp", result, address, { action: "vaultTransfer", vaultAddress, isDeposit, amount }) });
}

async function stakingOverview(_params: Record<string, unknown>, context: ProtocolExecutionContext) {
  return withReadAddress(context, async (address) => ok({ address, staking: await infoClient().delegatorSummary(address) }));
}

async function stakingDelegate(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const validator = addressParam(params, "validator"); const wei = safeWireInteger(requiredString(params, "amountWei")); const isUndelegate = requiredBoolean(params, "isUndelegate");
  const result = await exchange.tokenDelegate({ validator, wei, isUndelegate });
  return exchangeResult(result, { validator, amountWei: String(wei), isUndelegate, _tradeCapture: auditCapture("stake", result, address, { action: "tokenDelegate", validator, wei: String(wei), isUndelegate }) });
}

async function stakingTransfer(params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const wei = safeWireInteger(requiredString(params, "amountWei")); const direction = requiredString(params, "direction");
  const result = direction === "deposit" ? await exchange.cDeposit({ wei }) : direction === "withdraw" ? await exchange.cWithdraw({ wei }) : (() => { throw new Error("direction must be deposit or withdraw"); })();
  return exchangeResult(result, { direction, amountWei: String(wei), _tradeCapture: auditCapture("stake", result, address, { action: `c${direction}`, wei: String(wei) }) });
}

async function claimRewards(_params: Record<string, unknown>, context: ProtocolExecutionContext) {
  const { exchange } = await signingClients(context); const address = await signingAddress(context);
  const result = await exchange.claimRewards();
  return exchangeResult(result, { _tradeCapture: auditCapture("reward", result, address, { action: "claimRewards" }) });
}


