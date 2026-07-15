/**
 * Uniswap swap handlers — quote (read) + sell/buy (mutating).
 *
 * Keyless on-chain quoting (QuoterV2 + V2 getAmountsOut, best route) and
 * broadcast (V2 Router02 / V3 SwapRouter02) via the uniswap substrate under
 * `@tools/uniswap`. The quote embeds a structural SAFETY block (factory
 * allowlist + DexScreener min-liquidity + FoT signal) that the prequote
 * extractor re-validates into the pass/fail/unknown doctrine.
 *
 * Tokens are ADDRESS-ONLY (or native ETH) — Uniswap has no symbol search, so a
 * bare symbol is rejected (resolve it with a discovery tool first). This mirrors
 * kyberswap's strict resolution and keeps the quote symmetric with the execute
 * (so the prequote match-hash collides).
 */

import { parseUnits, formatUnits, getAddress, isAddress, type Address, type Hex } from "viem";

import { resolveUniswapDeployment } from "@tools/uniswap/chains.js";
import { getUniswapPublicClient, getUniswapEvmClients } from "@tools/uniswap/evm-client.js";
import { readUniswapErc20Metadata } from "@tools/uniswap/erc20.js";
import { ensureUniswapAllowanceExact, ensureUniswapSufficientBalance, readUniswapErc20Balance } from "@tools/uniswap/erc20.js";
import { quoteBestRoute, applySlippage } from "@tools/uniswap/quote.js";
import { isImplausibleQuote } from "@tools/uniswap/plausibility.js";
import { resolveSellAmount, usesLiveBalanceSell } from "@tools/uniswap/sell-amount.js";
import { buildSwapTx, sendUniswapTransaction, NATIVE_TOKEN_ADDRESS } from "@tools/uniswap/execute.js";
import { checkRouteFactories, probeFotSignal, exitSafetyVeto, UNISWAP_MIN_LIQUIDITY_USD } from "@tools/uniswap/safety.js";
import type { UniswapDeployment } from "@tools/uniswap/deployments.js";
import type { UniswapToken, UniswapRoute } from "@tools/uniswap/types.js";
import { getDexScreenerClient } from "@tools/dexscreener/client.js";
import { getLocalChain } from "@tools/evm-chains/registry.js";
import { pinTrackedToken } from "@vex-agent/db/repos/tracked-tokens.js";

import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import { resolveSelectedAddress, resolveSigningWallet, walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";
import { VexError, ErrorCodes } from "../../../../../errors.js";
import logger from "@utils/logger.js";
import type { ToolResult } from "../../../types.js";
import type { ProtocolHandler, ProtocolExecutionContext } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_DEADLINE_SECONDS = 600; // ~10 min

/** Native symbol per chain (display only — the routed address is always WETH). */
const NATIVE_SYMBOL: Record<number, string> = { 137: "POL", 56: "BNB" };

function nativeSymbolFor(chainId: number): string {
  return NATIVE_SYMBOL[chainId] ?? "ETH";
}

function isNativeInput(input: string): boolean {
  const lower = input.toLowerCase();
  return lower === "native" || lower === "eth" || lower === NATIVE_TOKEN_ADDRESS.toLowerCase();
}

/**
 * Resolve a token leg. Native ("eth"/"native"/sentinel) routes as WETH; a hex
 * address reads metadata on-chain; a bare symbol is rejected (address-only).
 */
async function resolveUniswapToken(
  deployment: UniswapDeployment,
  input: string,
): Promise<UniswapToken> {
  if (isNativeInput(input)) {
    return { address: getAddress(deployment.weth), symbol: nativeSymbolFor(deployment.chainId), decimals: 18, isNative: true };
  }
  if (!isAddress(input)) {
    throw new VexError(
      ErrorCodes.KYBER_TOKEN_NOT_FOUND,
      `Token "${input}" is not a valid address. Uniswap has no symbol search — pass the exact contract address (resolve it with a discovery tool first) or native ETH.`,
    );
  }
  const client = getUniswapPublicClient(deployment);
  const meta = await readUniswapErc20Metadata(client, getAddress(input));
  return { address: meta.address, symbol: meta.symbol, decimals: meta.decimals, isNative: false };
}

/** Resolve the chain param to a deployment, or throw a clean error. */
function requireDeployment(chain: string): UniswapDeployment {
  const deployment = resolveUniswapDeployment(chain);
  if (!deployment) {
    throw new VexError(
      ErrorCodes.KYBER_UNSUPPORTED_CHAIN,
      `Uniswap has no verified deployment for chain "${chain}".`,
      "Uniswap is available on Robinhood Chain and the major EVM chains; use kyberswap where it is supported.",
    );
  }
  return deployment;
}

// ── Safety block (embedded in the quote result; re-validated by the extractor) ──

type UniswapSafetyBlock = {
  factory: { checked: true; allowlisted: boolean } | { checkFailed: true };
  liquidity:
    | { checked: true; usd: number | null; aboveThreshold: boolean }
    | { checkFailed: true; reason: string };
  fot: { suspected: boolean };
};

async function checkOutputLiquidity(
  deployment: UniswapDeployment,
  tokenOut: UniswapToken,
): Promise<UniswapSafetyBlock["liquidity"]> {
  // Native output → WETH: liquidity is not a scam signal for the native wrapper.
  if (tokenOut.isNative) return { checked: true, usd: null, aboveThreshold: true };
  try {
    const pairs = await getDexScreenerClient().getTokens(deployment.key, tokenOut.address);
    let bestUsd: number | null = null;
    for (const pair of pairs) {
      if (pair.baseToken?.address?.toLowerCase() !== tokenOut.address.toLowerCase()) continue;
      const usd = pair.liquidity?.usd ?? null;
      if (usd !== null && (bestUsd === null || usd > bestUsd)) bestUsd = usd;
    }
    return { checked: true, usd: bestUsd, aboveThreshold: bestUsd !== null && bestUsd >= UNISWAP_MIN_LIQUIDITY_USD };
  } catch {
    return { checkFailed: true, reason: "unavailable" };
  }
}

interface QuotedRoute {
  route: UniswapRoute;
  amountOut: bigint;
  minAmountOut: bigint;
  priceImpact?: number;
  slippageBps: number;
}

async function computeQuote(
  deployment: UniswapDeployment,
  tokenIn: UniswapToken,
  tokenOut: UniswapToken,
  amountIn: bigint,
  slippageBps: number,
): Promise<QuotedRoute> {
  const client = getUniswapPublicClient(deployment);
  const best = await quoteBestRoute(client, { deployment, tokenIn, tokenOut, amountIn });
  if (!best) {
    throw new VexError(
      ErrorCodes.KYBER_ROUTE_NOT_FOUND,
      `No Uniswap route found for ${tokenIn.symbol} → ${tokenOut.symbol} on ${deployment.name}.`,
      "The pair may have no liquidity on this chain.",
    );
  }
  return {
    route: best.route,
    amountOut: best.route.amountOut,
    minAmountOut: applySlippage(best.route.amountOut, slippageBps),
    ...(best.priceImpact !== undefined ? { priceImpact: best.priceImpact } : {}),
    slippageBps,
  };
}

function routerFor(deployment: UniswapDeployment, route: UniswapRoute): Address {
  const router = route.version === "v2" ? deployment.v2?.router02 : deployment.v3?.swapRouter02;
  if (!router) throw new VexError(ErrorCodes.SWAP_FAILED, `No ${route.version} router on ${deployment.name}.`);
  return getAddress(router);
}

// ── Quote handler (read-only) ────────────────────────────────────────────────

async function uniswapSwapQuote(p: Record<string, unknown>): Promise<ToolResult> {
  const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
  if (!chain || !tokenInRaw || !tokenOutRaw || !amountInRaw) return fail("Missing required: chain, tokenIn, tokenOut, amountIn");

  const deployment = requireDeployment(chain);
  const tokenIn = await resolveUniswapToken(deployment, tokenInRaw);
  const tokenOut = await resolveUniswapToken(deployment, tokenOutRaw);
  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase() && tokenIn.isNative === tokenOut.isNative) {
    return fail("tokenIn and tokenOut resolve to the same token.");
  }
  const amountIn = parseUnits(amountInRaw, tokenIn.decimals);
  const slippageBps = num(p, "slippageBps") ?? DEFAULT_SLIPPAGE_BPS;

  const quoted = await computeQuote(deployment, tokenIn, tokenOut, amountIn, slippageBps);

  // Safety signals (LOCKED #5): factory allowlist + min-liquidity + FoT — never gate here.
  const client = getUniswapPublicClient(deployment);
  const [factory, liquidity, fotSuspected] = await Promise.all([
    checkRouteFactories(client, deployment, quoted.route),
    checkOutputLiquidity(deployment, tokenOut),
    tokenOut.isNative ? Promise.resolve(false) : probeFotSignal(client, deployment, tokenOut.address),
  ]);
  const safety: UniswapSafetyBlock = { factory, liquidity, fot: { suspected: fotSuspected } };

  // Plausibility guard (LOCKED — ADDITIVE, advisory only): flag a quote whose
  // amountIn is likely raw wei mistaken for human units, or whose price impact is
  // extreme / pool-draining. NEVER blocks — a new optional `warning` field.
  const warning = isImplausibleQuote({
    amountInRaw,
    tokenInDecimals: tokenIn.decimals,
    priceImpact: quoted.priceImpact ?? null,
  });

  return ok({
    chain: deployment.key,
    chainId: deployment.chainId,
    tokenIn: { address: tokenIn.address, symbol: tokenIn.symbol, decimals: tokenIn.decimals, isNative: tokenIn.isNative },
    tokenOut: { address: tokenOut.address, symbol: tokenOut.symbol, decimals: tokenOut.decimals, isNative: tokenOut.isNative },
    route: { version: quoted.route.version, path: quoted.route.path, fees: quoted.route.fees ?? null },
    amountIn: amountInRaw,
    amountInRaw: amountIn.toString(),
    amountOut: formatUnits(quoted.amountOut, tokenOut.decimals),
    amountOutRaw: quoted.amountOut.toString(),
    minAmountOut: formatUnits(quoted.minAmountOut, tokenOut.decimals),
    minAmountOutRaw: quoted.minAmountOut.toString(),
    slippageBps,
    priceImpact: quoted.priceImpact ?? null,
    gasEstimate: quoted.route.gasEstimate?.toString() ?? null,
    router: routerFor(deployment, quoted.route),
    spender: tokenIn.isNative ? null : routerFor(deployment, quoted.route),
    safety,
    ...(warning ? { warning } : {}),
  });
}

// ── Economic-side classification ──────────────────────────────────────────────

/**
 * Classify a swap by its ECONOMIC direction, independent of WHICH tool routed it.
 * The agent buys a token by calling `uniswap.swap.sell(WETH → TOKEN)` (and vice
 * versa), so the tool's own `side` mislabels those legs. Derive from the token
 * legs instead: native-in → BUY (spending ETH), native-out → SELL (realizing ETH),
 * and a token↔token swap (neither leg native) falls back to the tool's declared
 * `side`. Used ONLY for classification/labeling, the exit-safety veto gate, and
 * what gets RECORDED — never for routing/quoting/execution.
 *
 * A leg counts as native either when it is the `eth`/`native` sentinel
 * (`isNative`) OR when the caller passed the chain's wrapped-native (WETH) ERC-20
 * address directly — the manifest documents `tokenIn` as "CONTRACT ADDRESS or
 * native ETH", so a WETH-funded buy arrives as a plain ERC-20 leg with
 * `isNative:false`. Spending WETH is economically identical to spending ETH, so
 * both forms must classify the same way; otherwise a WETH→TOKEN buy routed via
 * `uniswap.swap.sell` is recorded as a sell and the buy-side veto is skipped.
 */
export function classifyEconomicSide(args: {
  readonly tokenIn: { readonly address: string; readonly isNative: boolean };
  readonly tokenOut: { readonly address: string; readonly isNative: boolean };
  readonly wrappedNative: string;
  readonly side: "buy" | "sell";
}): "buy" | "sell" {
  const eqAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const inNative = args.tokenIn.isNative || eqAddr(args.tokenIn.address, args.wrappedNative);
  const outNative = args.tokenOut.isNative || eqAddr(args.tokenOut.address, args.wrappedNative);
  if (inNative) return "buy";
  if (outNative) return "sell";
  return args.side;
}

// ── Execute (sell + buy share routing; differ only in trade side) ─────────────

async function executeUniswapSwap(
  p: Record<string, unknown>,
  side: "buy" | "sell",
  context: ProtocolExecutionContext,
): Promise<ToolResult> {
  const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
  if (!chain || !tokenInRaw || !tokenOutRaw || !amountInRaw) return fail("Missing required: chain, tokenIn, tokenOut, amountIn");

  const deployment = requireDeployment(chain);
  const tokenIn = await resolveUniswapToken(deployment, tokenInRaw);
  const tokenOut = await resolveUniswapToken(deployment, tokenOutRaw);
  // Economic direction of the trade (native-in → buy, native-out → sell, else the
  // tool's `side`). The recorded side + the exit-safety veto key off THIS, not the
  // tool name, so a `uniswap.swap.sell(WETH → TOKEN)` is correctly a BUY. Routing/
  // quoting/execution below still key off `side`/the token legs, unchanged.
  const economicSide = classifyEconomicSide({
    tokenIn: { address: tokenIn.address, isNative: tokenIn.isNative },
    tokenOut: { address: tokenOut.address, isNative: tokenOut.isNative },
    wrappedNative: deployment.weth,
    side,
  });
  const slippageBps = num(p, "slippageBps") ?? DEFAULT_SLIPPAGE_BPS;
  const sellFraction = num(p, "sellFraction");

  // Sell-live-balance resolution (exit-guards Fix #2): the sentinel amountIn:"max"
  // (or a sellFraction) sells the EXACT live on-chain balance, killing the drift/
  // re-quote churn. Supported ONLY on the SELL path for a non-native tokenIn. The
  // owner ADDRESS is resolved WITHOUT decrypting a key (mirrors the dryRun
  // invariant), and the balance is read with the keyless public client — the same
  // read `ensureUniswapSufficientBalance` uses below. A normal numeric amountIn is
  // parsed exactly as before.
  // SECURITY (Codex PR #3, P1 — money-binding). The "max" / sellFraction
  // live-balance resolver overrode amountIn at execute time, but the prequote gate
  // binds its identity on the QUOTED amountIn — so a quote for a small amount could
  // authorize selling the ENTIRE live balance (far more than was previewed). Until
  // the gate binds the RESOLVED amount, refuse the sentinels: callers pass an
  // explicit numeric amountIn with a matching fresh quote.
  // TODO(exit-engine, before execute-mode): bind resolveSellAmount's resolved
  // amount into the prequote identity/hash, then re-enable "max"/sellFraction.
  if (usesLiveBalanceSell(amountInRaw, sellFraction)) {
    return fail(
      'amountIn "max" / sellFraction is temporarily disabled pending prequote-gate binding (money-safety). Pass an explicit numeric amountIn with a fresh matching quote.',
    );
  }
  const amountIn = parseUnits(amountInRaw, tokenIn.decimals);

  const quoted = await computeQuote(deployment, tokenIn, tokenOut, amountIn, slippageBps);

  if (p.dryRun === true) {
    return ok({
      dryRun: true, side: economicSide, chain: deployment.key,
      route: { version: quoted.route.version, path: quoted.route.path, fees: quoted.route.fees ?? null },
      amountOut: formatUnits(quoted.amountOut, tokenOut.decimals),
      minAmountOut: formatUnits(quoted.minAmountOut, tokenOut.decimals),
      router: routerFor(deployment, quoted.route),
    });
  }

  // Exit-safety veto (buys only): before spending ETH on a token, prove it can
  // be sold back. Simulate the reverse leg (token→input) via QuoterV2 — a null
  // route means every sell reverts (honeypot) — and probe the fee-on-transfer
  // signal. Read-only + keyless, and BEFORE signer resolution so no key is
  // decrypted for a doomed buy. Sells and native-out swaps are exits already.
  // Keys off the ECONOMIC side so a native→token BUY routed via `uniswap.swap.sell`
  // is still gated (the bug this fixes: the veto was skipped for such buys).
  if (economicSide === "buy" && !tokenOut.isNative) {
    const probeClient = getUniswapPublicClient(deployment);
    const [sellBack, fotSuspected] = await Promise.all([
      quoteBestRoute(probeClient, {
        deployment,
        tokenIn: tokenOut,
        tokenOut: tokenIn,
        amountIn: quoted.amountOut,
      }),
      probeFotSignal(probeClient, deployment, tokenOut.address),
    ]);
    const veto = exitSafetyVeto({
      sellBackRouteExists: sellBack !== null,
      fotSuspected,
      tokenOutSymbol: tokenOut.symbol,
      tokenOutAddress: tokenOut.address,
      tokenInSymbol: tokenIn.symbol,
    });
    if (veto !== null) {
      logger.info("uniswap.swap.exit_safety_veto", {
        chain: deployment.key, token: tokenOut.address,
        sellBackRoute: sellBack !== null, fotSuspected,
      });
      return fail(veto);
    }
  }

  // Per-session signing wallet — resolved AFTER dryRun so a preview never decrypts a key.
  let signer: ChainWallet;
  try {
    signer = resolveSigningWallet(context.walletResolution, context.walletPolicy, "eip155");
  } catch (err) {
    return walletScopeErrorToResult(err);
  }
  if (signer.family !== "eip155") return fail("Resolved wallet family mismatch.");

  const { publicClient, walletClient } = getUniswapEvmClients(deployment, signer.privateKey as Hex);
  const router = routerFor(deployment, quoted.route);

  // Non-native input (a sell): guard balance BEFORE approving/swapping, then set
  // the EXACT-amount allowance to the allowlisted router. Over-balance amounts
  // otherwise revert at the router's transferFrom with an opaque STF /
  // TRANSFER_FROM_FAILED that mimics a missing allowance. Native input needs
  // neither (the tx value carries the ETH).
  if (!tokenIn.isNative) {
    await ensureUniswapSufficientBalance(publicClient, tokenIn.address, getAddress(signer.address), amountIn, tokenIn.symbol, tokenIn.decimals);
    await ensureUniswapAllowanceExact(publicClient, walletClient, tokenIn.address, router, amountIn);
  }

  const recipientParam = str(p, "recipient");
  const recipient = recipientParam && isAddress(recipientParam) ? getAddress(recipientParam) : getAddress(signer.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS);

  const tx = buildSwapTx({
    deployment,
    route: quoted.route,
    amountIn,
    minAmountOut: quoted.minAmountOut,
    recipient,
    deadline,
    tokenInIsNative: tokenIn.isNative,
    tokenOutIsNative: tokenOut.isNative,
  });

  const txHash = await sendUniswapTransaction(publicClient, walletClient, tx);
  const amountOutHuman = formatUnits(quoted.amountOut, tokenOut.decimals);
  // amountInRaw is the caller's explicit human amount (the "max"/sellFraction
  // sentinels are rejected earlier pending prequote-gate binding).
  const amountInHuman = amountInRaw;

  logger.info("uniswap.swap.executed", { chain: deployment.key, version: quoted.route.version, side, economicSide });

  // Auto-pin (fail-soft): non-native legs of a swap on a LOCAL chain join the
  // tracked_tokens set (seed ∪ pins) so balance scans and the portfolio keep
  // seeing them. A DB bookmark — never allowed to fail the swap result.
  if (getLocalChain(deployment.chainId)) {
    for (const leg of [tokenIn, tokenOut]) {
      if (leg.isNative) continue;
      try {
        await pinTrackedToken({
          walletAddress: signer.address,
          chainId: deployment.chainId,
          tokenAddress: leg.address,
          source: "swap",
        });
      } catch (err) {
        logger.warn("uniswap.swap.auto_pin_failed", {
          chain: deployment.key,
          error: err instanceof Error ? err.name : "unknown",
        });
      }
    }
  }

  return {
    success: true,
    output: JSON.stringify({
      txHash, side: economicSide, chain: deployment.key,
      tokenIn: tokenIn.symbol, tokenOut: tokenOut.symbol,
      amountIn: amountInHuman, amountOut: amountOutHuman,
      route: { version: quoted.route.version, path: quoted.route.path },
    }, null, 2),
    data: {
      txHash,
      _tradeCapture: {
        type: "swap",
        chain: deployment.key, // aligned with tools/evm-chains activityChainKeys ("robinhood")
        status: "executed",
        inputToken: tokenIn.symbol,
        outputToken: tokenOut.symbol,
        inputTokenAddress: tokenIn.address,
        outputTokenAddress: tokenOut.address,
        inputAmount: amountInHuman,
        outputAmount: amountOutHuman,
        signature: txHash,
        walletAddress: signer.address,
        // Recorded by ECONOMIC direction (native-in buy / native-out sell), so the
        // exit engine's cost-basis + the MOVES label match reality regardless of
        // which tool name (`uniswap.swap.buy`/`.sell`) routed the trade.
        tradeSide: economicSide,
        instrumentKey: `${deployment.key}:${economicSide === "buy" ? tokenOut.address : tokenIn.address}`,
        valuationSource: "none",
        settlementAssetKey: economicSide === "buy" ? tokenIn.symbol : tokenOut.symbol,
        meta: { dex: "uniswap", version: quoted.route.version, side: economicSide },
      },
    },
  };
}

// ── Handler map ──────────────────────────────────────────────────────────────

export const UNISWAP_SWAP_HANDLERS: Record<string, ProtocolHandler> = {
  "uniswap.swap.quote": (p) => uniswapSwapQuote(p),
  "uniswap.swap.sell": (p, ctx) => executeUniswapSwap(p, "sell", ctx),
  "uniswap.swap.buy": (p, ctx) => executeUniswapSwap(p, "buy", ctx),
};
