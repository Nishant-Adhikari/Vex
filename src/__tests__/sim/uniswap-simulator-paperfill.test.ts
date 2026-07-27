/**
 * LAYER A safety + behaviour proof: under a simulator mission run the Uniswap
 * swap handler PAPER-FILLS from the live quote — it records a shadow trade and
 * returns a real-shaped success result WITHOUT resolving a signer, building a
 * tx, or broadcasting. The `sendUniswapTransaction` + `resolveSigningWallet`
 * spies assert no key is decrypted and nothing reaches the wire.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

const TOKEN_OUT = "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

const sendUniswapTransaction = vi.fn(async () => `0x${"ab".repeat(32)}`);
const buildSwapTx = vi.fn();
const resolveSigningWallet = vi.fn(() => {
  throw new Error("resolveSigningWallet must NOT be called under simulator mode");
});
const recordSimFill = vi.fn(async () => ({
  trade: { id: "sim-trade-1" },
  position: { qty: 1000, costNative: 1, realizedPnlNative: 0 },
  realizedDelta: 0,
  closed: false,
}));

vi.mock("@tools/uniswap/chains.js", () => ({
  resolveUniswapDeployment: vi.fn(() => ({
    key: "robinhood", name: "Robinhood Chain", chainId: 4663, weth: WETH,
    v2: { router02: "0x89e5db8b5aa49aa85ac63f691524311aeb649eba" },
  })),
}));
vi.mock("@tools/uniswap/evm-client.js", () => ({
  getUniswapPublicClient: vi.fn(() => ({})),
  getUniswapEvmClients: vi.fn(() => ({ publicClient: {}, walletClient: {} })),
}));
vi.mock("@tools/uniswap/erc20.js", () => ({
  readUniswapErc20Metadata: vi.fn(async (_c: unknown, address: string) => ({ address, symbol: "TKN", decimals: 18, isNative: false })),
  ensureUniswapAllowanceExact: vi.fn(),
  ensureUniswapSufficientBalance: vi.fn(),
  readUniswapErc20Balance: vi.fn(),
}));
vi.mock("@tools/evm-chains/erc20-balance-guard.js", () => ({ ensureErc20Balance: vi.fn() }));
vi.mock("@tools/uniswap/quote.js", () => ({
  quoteBestRoute: vi.fn(async () => ({ route: { version: "v2", path: [WETH, TOKEN_OUT], amountOut: 1000n }, priceImpact: 0.02 })),
  applySlippage: vi.fn((amount: bigint) => amount),
}));
vi.mock("@tools/uniswap/plausibility.js", () => ({ isImplausibleQuote: vi.fn(() => null) }));
vi.mock("@tools/uniswap/sell-amount.js", () => ({ resolveSellAmount: vi.fn(), usesLiveBalanceSell: vi.fn(() => false) }));
vi.mock("@tools/uniswap/execute.js", () => ({
  NATIVE_TOKEN_ADDRESS: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  buildSwapTx: (...a: unknown[]) => buildSwapTx(...a),
  sendUniswapTransaction: (...a: unknown[]) => sendUniswapTransaction(...a),
}));
vi.mock("@tools/uniswap/safety.js", () => ({
  checkRouteFactories: vi.fn(async () => ({ checked: true, allowlisted: true })),
  probeFotSignal: vi.fn(async () => false),
  exitSafetyVeto: vi.fn(() => null),
  UNISWAP_MIN_LIQUIDITY_USD: 5000,
}));
vi.mock("@tools/dexscreener/client.js", () => ({ getDexScreenerClient: vi.fn(() => ({ getTokens: vi.fn(async () => []) })) }));
vi.mock("@tools/evm-chains/registry.js", () => ({ getLocalChain: vi.fn(() => undefined) }));
vi.mock("@vex-agent/db/repos/tracked-tokens.js", () => ({ pinTrackedToken: vi.fn() }));
vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSigningWallet: (...a: unknown[]) => resolveSigningWallet(...a),
  resolveSelectedAddress: vi.fn(),
  walletScopeErrorToResult: vi.fn(),
}));
vi.mock("@vex-agent/db/repos/sim-ledger.js", () => ({
  recordSimFill: (...a: unknown[]) => recordSimFill(...a),
}));
vi.mock("@utils/logger.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const { UNISWAP_SWAP_HANDLERS } = await import("@vex-agent/tools/protocols/uniswap/handlers/swap.js");

const simContext = {
  missionMode: "simulator",
  missionRunId: "run-1",
  sessionId: "sess-1",
  sessionPermission: "full",
  approved: true,
  walletResolution: { source: "default" },
  walletPolicy: { kind: "none" },
} as unknown as ProtocolExecutionContext;

describe("Uniswap simulator paper-fill (layer A)", () => {
  beforeEach(() => {
    sendUniswapTransaction.mockClear();
    buildSwapTx.mockClear();
    resolveSigningWallet.mockClear();
    recordSimFill.mockClear();
  });

  it("a simulator BUY paper-fills: no signer, no build, no broadcast", async () => {
    const result = await UNISWAP_SWAP_HANDLERS["uniswap.swap.buy"]!(
      { chain: "robinhood", tokenIn: "eth", tokenOut: TOKEN_OUT, amountIn: "1" },
      simContext,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('"simulated": true');
    // NO real-money path was touched.
    expect(resolveSigningWallet).not.toHaveBeenCalled();
    expect(buildSwapTx).not.toHaveBeenCalled();
    expect(sendUniswapTransaction).not.toHaveBeenCalled();
    // The shadow ledger recorded the fill with the expected shape.
    expect(recordSimFill).toHaveBeenCalledTimes(1);
    const arg = recordSimFill.mock.calls[0]![0] as { missionRunId: string; fill: { side: string; tokenAddress: string; nativeValue: number } };
    expect(arg.missionRunId).toBe("run-1");
    expect(arg.fill.side).toBe("buy");
    expect(arg.fill.tokenAddress.toLowerCase()).toBe(TOKEN_OUT.toLowerCase());
    expect(arg.fill.nativeValue).toBe(1); // native spent on the buy
    // No real trade capture leaks into the real PnL projections.
    expect((result.data as { _tradeCapture?: unknown })?._tradeCapture).toBeUndefined();
  });

  it("a simulator SELL records the disposed token as the position", async () => {
    await UNISWAP_SWAP_HANDLERS["uniswap.swap.sell"]!(
      { chain: "robinhood", tokenIn: TOKEN_OUT, tokenOut: "eth", amountIn: "500" },
      simContext,
    );
    expect(sendUniswapTransaction).not.toHaveBeenCalled();
    const arg = recordSimFill.mock.calls[0]![0] as { fill: { side: string; tokenAddress: string } };
    expect(arg.fill.side).toBe("sell");
    expect(arg.fill.tokenAddress.toLowerCase()).toBe(TOKEN_OUT.toLowerCase());
  });
});
