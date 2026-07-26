/**
 * Regression: UNISWAP-VETO-SIDE-MISMATCH
 *
 * The exit-safety honeypot veto in the Uniswap swap handler was checking
 * `side === "buy"` (the raw tool parameter) instead of
 * `economicSide === "buy"` (the actual economic direction).
 *
 * A swap where `side = "sell"` but tokenIn is the native coin (ETH) is
 * economically a BUY — spending ETH to acquire a token. Under the old code the
 * veto was skipped for any call to `uniswap.swap.sell`, even when the native
 * coin was the input leg. Fix: the veto now gates on `economicSide`, which is
 * derived from which leg is native, not from which tool was invoked.
 *
 * Source-inspection test: pin the `economicSide === "buy"` pattern at the veto
 * gate so a future edit cannot silently regress to `side === "buy"`.
 *
 * Behavioral test: call `uniswap.swap.sell` with `tokenIn = "eth"` and confirm
 * the veto fires (result.success = false) when the reverse-route probe finds
 * no sell-back route. Under the old bug the call would proceed past the veto.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

// ── Mock deployment used for all behavioral tests ─────────────────────────────

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const TOKEN_OUT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // non-native ERC-20

const MOCK_DEPLOYMENT = {
  key: "ethereum",
  chainId: 1,
  name: "Ethereum",
  weth: WETH,
  v2: {
    factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    router02: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  },
  v3: {
    factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  },
};

// ── Module mocks (must be declared before any import of the handler) ──────────

vi.mock("@tools/uniswap/chains.js", () => ({
  resolveUniswapDeployment: (chain: string) =>
    chain === "ethereum" ? MOCK_DEPLOYMENT : null,
}));

// publicClient is reused for both the gas-reserve getBalance probe and the
// veto quoteBestRoute calls — the mock methods cover all call sites.
const mockPublicClient = {
  getBalance: vi.fn().mockResolvedValue(BigInt(1e18)), // 1 ETH balance
  readContract: vi.fn(),
};

vi.mock("@tools/uniswap/evm-client.js", () => ({
  getUniswapPublicClient: () => mockPublicClient,
  getUniswapEvmClients: () => ({
    publicClient: mockPublicClient,
    walletClient: {},
  }),
}));

const mockReadErc20Metadata = vi.fn(async (_client: unknown, address: string) => ({
  address,
  symbol: "TKN",
  decimals: 18,
}));

vi.mock("@tools/uniswap/erc20.js", () => ({
  readUniswapErc20Metadata: (...args: unknown[]) => mockReadErc20Metadata(...args),
  ensureUniswapAllowanceExact: vi.fn().mockResolvedValue(undefined),
  ensureUniswapSufficientBalance: vi.fn().mockResolvedValue(undefined),
  readUniswapErc20Balance: vi.fn().mockResolvedValue(BigInt(1e18)),
}));

// mockQuoteBestRoute is the key spy: the first call is the forward quote;
// the second call (if the veto check fires) is the sellback probe.
const mockQuoteBestRoute = vi.fn();

vi.mock("@tools/uniswap/quote.js", () => ({
  quoteBestRoute: (...args: unknown[]) => mockQuoteBestRoute(...args),
  // applySlippage is a pure arithmetic helper — provide a real implementation.
  applySlippage: (amount: bigint, bps: number) =>
    amount - (amount * BigInt(bps)) / 10_000n,
}));

vi.mock("@tools/uniswap/plausibility.js", () => ({
  isImplausibleQuote: () => null,
}));

vi.mock("@tools/uniswap/sell-amount.js", () => ({
  resolveSellAmount: vi.fn(),
  usesLiveBalanceSell: () => false, // numeric amountIn never triggers the sentinel
}));

vi.mock("@tools/uniswap/execute.js", () => ({
  buildSwapTx: vi.fn().mockReturnValue({}),
  sendUniswapTransaction: vi.fn().mockResolvedValue("0xtxhash"),
  NATIVE_TOKEN_ADDRESS: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
}));

// exitSafetyVeto is pure — provide the real behaviour inline so the handler's
// veto gate returns the expected string (not null) when sellBackRouteExists=false.
vi.mock("@tools/uniswap/safety.js", () => ({
  checkRouteFactories: vi.fn().mockResolvedValue({ checked: true, allowlisted: true }),
  probeFotSignal: vi.fn().mockResolvedValue(false),
  exitSafetyVeto: ({
    sellBackRouteExists,
    fotSuspected,
    tokenOutSymbol,
    tokenOutAddress,
    tokenInSymbol,
  }: {
    sellBackRouteExists: boolean;
    fotSuspected: boolean;
    tokenOutSymbol: string;
    tokenOutAddress: string;
    tokenInSymbol: string;
  }): string | null => {
    if (!sellBackRouteExists) {
      return (
        `Exit-safety veto: no sell route for ${tokenOutSymbol} ` +
        `(${tokenOutAddress}) back to ${tokenInSymbol}. ` +
        `A token that can be bought but not sold is a honeypot — buy blocked.`
      );
    }
    if (fotSuspected) {
      return (
        `Exit-safety veto: ${tokenOutSymbol} (${tokenOutAddress}) ` +
        `shows a fee-on-transfer signal — buy blocked.`
      );
    }
    return null;
  },
  UNISWAP_MIN_LIQUIDITY_USD: 5000,
}));

vi.mock("@tools/dexscreener/client.js", () => ({
  getDexScreenerClient: () => ({
    getTokens: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@tools/evm-chains/registry.js", () => ({
  getLocalChain: () => null,
}));

vi.mock("@tools/evm-chains/erc20-balance-guard.js", () => ({
  ensureErc20Balance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@vex-agent/db/repos/tracked-tokens.js", () => ({
  pinTrackedToken: vi.fn(),
}));

const mockResolveSelectedAddress = vi.fn(
  () => "0x1234567890abcdef1234567890abcdef12345678",
);
const mockResolveSigningWallet = vi.fn(() => ({
  family: "eip155" as const,
  address: "0x1234567890abcdef1234567890abcdef12345678",
  privateKey: ("0x" + "ab".repeat(32)) as `0x${string}`,
}));

vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSigningWallet: (...args: unknown[]) => mockResolveSigningWallet(...args),
  resolveSelectedAddress: (...args: unknown[]) => mockResolveSelectedAddress(...args),
  walletScopeErrorToResult: (err: unknown) => ({
    success: false,
    output: err instanceof Error ? err.message : String(err),
  }),
}));

vi.mock("@utils/logger.js", () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
  return { default: stub, logger: stub };
});

vi.mock("@vex-agent/sim/swap-sim.js", () => ({
  paperFillSwap: vi.fn(),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { UNISWAP_HANDLERS } from "@vex-agent/tools/protocols/uniswap/handlers.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ctx(over: Partial<ProtocolExecutionContext> = {}): ProtocolExecutionContext {
  return {
    sessionPermission: "full",
    approved: true,
    walletResolution: { source: "default" },
    walletPolicy: { kind: "none" },
    ...over,
  };
}

/** A realistic forward-quote return value (native → TOKEN_OUT). */
function fwdRoute() {
  return {
    route: {
      version: "v3" as const,
      path: [WETH, TOKEN_OUT],
      fees: [3000],
      amountOut: 1_000_000n, // 1 USDC (6 decimals)
      gasEstimate: 200_000n,
    },
    priceImpact: 0.1,
  };
}

// ── Source-inspection tests ───────────────────────────────────────────────────

describe("UNISWAP-VETO-SIDE-MISMATCH — source inspection", () => {
  it("exit-safety veto gates on economicSide, not the raw side param", () => {
    const src = readFileSync(
      path.resolve("src/vex-agent/tools/protocols/uniswap/handlers/swap.ts"),
      "utf-8",
    );
    // The fixed pattern must be present.
    expect(src).toMatch(/economicSide\s*===\s*["']buy["']/);
  });

  it("economicSide is derived from classifyEconomicSide (not the side param directly)", () => {
    const src = readFileSync(
      path.resolve("src/vex-agent/tools/protocols/uniswap/handlers/swap.ts"),
      "utf-8",
    );
    expect(src).toMatch(/classifyEconomicSide/);
    // economicSide must be assigned from the classifier, not from side.
    expect(src).toMatch(/economicSide\s*=\s*classifyEconomicSide/);
  });
});

// ── Behavioral tests ──────────────────────────────────────────────────────────

describe("UNISWAP-VETO-SIDE-MISMATCH — behavior", () => {
  beforeEach(() => {
    mockQuoteBestRoute.mockReset();
    mockReadErc20Metadata.mockReset();
    mockReadErc20Metadata.mockImplementation(async (_client: unknown, address: string) => ({
      address,
      symbol: "TKN",
      decimals: 18,
    }));
    mockResolveSelectedAddress.mockReturnValue(
      "0x1234567890abcdef1234567890abcdef12345678",
    );
  });

  it(
    "UNISWAP-VETO-SIDE-MISMATCH: veto fires when uniswap.swap.sell is used with native tokenIn " +
      "(economicSide=buy, raw side=sell, no sellback route → honeypot)",
    async () => {
      // First call: forward quote (ETH → TOKEN_OUT) — must succeed.
      // Second call: sellback probe (TOKEN_OUT → ETH) — null means no exit route.
      mockQuoteBestRoute
        .mockResolvedValueOnce(fwdRoute()) // forward quote
        .mockResolvedValueOnce(null);      // sellback probe: honeypot (no exit)

      const result = await UNISWAP_HANDLERS["uniswap.swap.sell"]!(
        {
          chain: "ethereum",
          tokenIn: "eth",   // native — economicSide will be "buy"
          tokenOut: TOKEN_OUT,
          amountIn: "0.001",
          // No dryRun: the veto is after the dryRun gate and must run.
        },
        ctx(),
      );

      // Under the bug (side === "buy"), the 'sell' tool would skip the veto
      // and proceed to key decryption. With the fix the veto must fire here.
      expect(result.success).toBe(false);
      expect(result.output).toMatch(/veto|honeypot|buy blocked/i);

      // quoteBestRoute called twice: once for the forward quote, once for the probe.
      expect(mockQuoteBestRoute).toHaveBeenCalledTimes(2);

      // The second (probe) call must have swapped the legs: tokenIn=TOKEN_OUT.
      const probeCallArgs = mockQuoteBestRoute.mock.calls[1] as [
        unknown,
        { tokenIn: { address: string }; tokenOut: { address: string } },
      ];
      expect(probeCallArgs[1].tokenIn.address.toLowerCase()).toBe(
        TOKEN_OUT.toLowerCase(),
      );
    },
  );

  it(
    "UNISWAP-VETO-SIDE-MISMATCH: when a valid sellback route exists, " +
      "uniswap.swap.sell with native tokenIn proceeds past the veto",
    async () => {
      // Both forward and sellback routes are present → veto allows the buy.
      mockQuoteBestRoute
        .mockResolvedValueOnce(fwdRoute()) // forward
        .mockResolvedValueOnce(fwdRoute()); // sellback probe: route exists → not a honeypot

      const result = await UNISWAP_HANDLERS["uniswap.swap.sell"]!(
        {
          chain: "ethereum",
          tokenIn: "eth",
          tokenOut: TOKEN_OUT,
          amountIn: "0.001",
          dryRun: true, // stop before key decryption; veto check is before dryRun
        },
        ctx(),
      );

      // dryRun is after the veto gate; if the veto fired we'd have success=false.
      // The veto is satisfied (sellback exists) so we reach the dryRun return.
      expect(result.success).toBe(true);
      const out = JSON.parse(result.output) as { dryRun: boolean };
      expect(out.dryRun).toBe(true);
    },
  );

  it(
    "UNISWAP-VETO-SIDE-MISMATCH: uniswap.swap.buy with non-native tokenIn " +
      "does NOT trigger the veto (sell path, no native spend)",
    async () => {
      // TOKEN_OUT is the tokenIn here (non-native), so economicSide = "sell".
      // The veto must not fire — only buys (native spend) are checked.
      mockQuoteBestRoute.mockResolvedValueOnce(fwdRoute());

      const result = await UNISWAP_HANDLERS["uniswap.swap.buy"]!(
        {
          chain: "ethereum",
          tokenIn: TOKEN_OUT, // non-native ERC-20
          tokenOut: TOKEN_OUT, // same address — would fail, but veto must not fire
          amountIn: "1",
          dryRun: true,
        },
        ctx(),
      );

      // Same-token swap fails for a different reason (same address check), but
      // the sellback probe must NOT have been called (only 1 quoteBestRoute call).
      // Even if the result is an error, it must not be the veto message.
      if (!result.success) {
        expect(result.output).not.toMatch(/veto/i);
      }
      // The probe (second quoteBestRoute call) must not have happened.
      expect(mockQuoteBestRoute).not.toHaveBeenCalledTimes(2);
    },
  );
});
