/**
 * Regression: KYBER-FOT-WARN-NOT-VETO and KYBER-NO-SELLBACK-PROBE
 *
 * KYBER-FOT-WARN-NOT-VETO: Fee-on-Transfer tokens with sell tax > 20% were
 * only logged as a warning — the buy still proceeded. Fix: hard fail() veto
 * when outCheck.tax > FOT_VETO_TAX_THRESHOLD (20).
 *
 * KYBER-NO-SELLBACK-PROBE: Before a KyberSwap buy there was no reverse-route
 * probe to detect honeypots. Fix: getRoute() is called with swapped legs before
 * every buy; a missing routeSummary in the response is a hard veto.
 *
 * Source-inspection tests pin both constants and the structural patterns; the
 * mock-based behavioral tests prove the hard-veto code path is actually reached
 * (not just present in the text).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

// ── Wallet resolver mock ─────────────────────────────────────────────────────

const SESSION_EVM = {
  family: "eip155" as const,
  address: "0x1234567890abcdef1234567890abcdef12345678",
  privateKey: ("0x" + "ab".repeat(32)) as `0x${string}`,
};
const mockResolveSigningWallet = vi.fn(() => SESSION_EVM);
const mockResolveSelectedAddress = vi.fn(() => SESSION_EVM.address);

vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSigningWallet: (...args: unknown[]) => mockResolveSigningWallet(...args),
  resolveSelectedAddress: (...args: unknown[]) => mockResolveSelectedAddress(...args),
  walletScopeErrorToResult: (err: unknown) => ({
    success: false,
    output: err instanceof Error ? err.message : String(err),
  }),
}));

// ── EVM clients mock (KyberSwap) ─────────────────────────────────────────────

const mockReadErc20Metadata = vi.fn(async (_slug: string, address: string) => ({
  address,
  symbol: "TKN",
  name: "Token",
  decimals: 18,
  isNative: false as const,
}));

vi.mock("@tools/kyberswap/evm-utils.js", () => ({
  getKyberEvmClients: () => ({ publicClient: {}, walletClient: {} }),
  getKyberPublicClient: () => ({}),
  ensureKyberAllowance: vi.fn().mockResolvedValue(undefined),
  sendKyberTransaction: vi.fn().mockResolvedValue("0xtxhash"),
  verifyRouterAddress: vi.fn(),
  readErc20Metadata: (...args: [string, string]) => mockReadErc20Metadata(...args),
}));

// ── ERC-20 balance guard mock ─────────────────────────────────────────────────

vi.mock("@tools/evm-chains/erc20-balance-guard.js", () => ({
  ensureErc20Balance: vi.fn().mockResolvedValue(undefined),
}));

// ── Token API (honeypot/FoT) mock ─────────────────────────────────────────────
// Shared spy — individual tests drive the scenario.

const mockGetHoneypotFotInfo = vi.fn().mockResolvedValue({
  isHoneypot: false,
  isFOT: false,
  tax: 0,
});

vi.mock("@tools/kyberswap/token-api/client.js", () => ({
  getKyberTokenApiClient: () => ({
    searchTokens: vi.fn().mockResolvedValue([]),
    getHoneypotFotInfo: (...args: [number, string]) => mockGetHoneypotFotInfo(...args),
  }),
}));

// ── Aggregator (route) mock ───────────────────────────────────────────────────

const mockGetRoute = vi.fn();

vi.mock("@tools/kyberswap/aggregator/client.js", () => ({
  getKyberAggregatorClient: () => ({
    getRoute: (...args: unknown[]) => mockGetRoute(...args),
    buildRoute: vi.fn().mockResolvedValue({
      data: {
        routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
        data: "0xbuilddata",
        transactionValue: "0",
        amountIn: "1000000000000000000",
        amountOut: "999000000000000000",
        amountInUsd: "1.0",
        amountOutUsd: "0.999",
        gasUsd: "0.001",
      },
    }),
  }),
}));

// ── Logger mock (quiet) ───────────────────────────────────────────────────────

const mockLoggerWarn = vi.fn();

vi.mock("@utils/logger.js", () => {
  const stub = {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
  return { default: stub, logger: stub };
});

// ── Benchmark import mock (dynamic import inside handler) ─────────────────────

vi.mock("@vex-agent/sync/benchmark.js", () => ({
  resolveChainBenchmark: vi.fn().mockReturnValue("eth"),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { KYBERSWAP_HANDLERS } from "@vex-agent/tools/protocols/kyberswap/handlers.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

function ctx(over: Partial<ProtocolExecutionContext> = {}): ProtocolExecutionContext {
  return {
    sessionPermission: "full",
    approved: true,
    walletResolution: { source: "default" },
    walletPolicy: { kind: "none" },
    ...over,
  };
}

// ERC-20 addresses that are NOT the chain's native/wrapped-native (so
// isEconomicallyNativeLeg returns false for both, and the declared side
// drives the economicSide for token→token swaps).
const TOKEN_A = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC-like
const TOKEN_B = "0xdAC17F958D2ee523a2206206994597C13D831ec7"; // USDT-like

const FORWARD_ROUTE_RESPONSE = {
  data: {
    routeSummary: {
      amountIn: "1000000000000000000",
      amountOut: "999000000000000000",
      gasUsd: "0.5",
    },
    routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
  },
};

// ── Source-inspection tests ───────────────────────────────────────────────────

describe("KYBER-FOT-WARN-NOT-VETO — source inspection", () => {
  it("FOT_VETO_TAX_THRESHOLD constant is declared in the KyberSwap swap handler", () => {
    const src = readFileSync(
      path.resolve("src/vex-agent/tools/protocols/kyberswap/handlers/swap.ts"),
      "utf-8",
    );
    expect(src).toMatch(/FOT_VETO_TAX_THRESHOLD/);
  });

  it("a fail() veto is issued when outCheck.tax exceeds the threshold", () => {
    const src = readFileSync(
      path.resolve("src/vex-agent/tools/protocols/kyberswap/handlers/swap.ts"),
      "utf-8",
    );
    // The veto must be a hard return fail(...), not just a warn.
    // Pattern: the threshold check is followed by a return fail call.
    expect(src).toMatch(/FOT_VETO_TAX_THRESHOLD[\s\S]{0,200}return fail\(/);
  });
});

describe("KYBER-NO-SELLBACK-PROBE — source inspection", () => {
  it("getKyberAggregatorClient is called for the reverse-route probe before every buy", () => {
    const src = readFileSync(
      path.resolve("src/vex-agent/tools/protocols/kyberswap/handlers/swap.ts"),
      "utf-8",
    );
    // The reverse probe reuses the aggregator client — confirms the call is present.
    expect(src).toMatch(/getKyberAggregatorClient/);
  });

  it("routeSummary absence in reverse response triggers a hard veto", () => {
    const src = readFileSync(
      path.resolve("src/vex-agent/tools/protocols/kyberswap/handlers/swap.ts"),
      "utf-8",
    );
    // The handler checks reverseResp?.data?.routeSummary and returns fail if missing.
    expect(src).toMatch(/routeSummary/);
    expect(src).toMatch(/honeypot.*Buy vetoed|Buy vetoed.*honeypot/i);
  });
});

// ── Behavioral tests ──────────────────────────────────────────────────────────

describe("KYBER-FOT-WARN-NOT-VETO — behavior", () => {
  beforeEach(() => {
    mockGetHoneypotFotInfo.mockReset();
    mockGetHoneypotFotInfo.mockResolvedValue({ isHoneypot: false, isFOT: false, tax: 0 });
    mockGetRoute.mockReset();
    mockGetRoute.mockResolvedValue(FORWARD_ROUTE_RESPONSE);
    mockReadErc20Metadata.mockReset();
    mockReadErc20Metadata.mockImplementation(async (_slug: string, address: string) => ({
      address,
      symbol: "TKN",
      name: "Token",
      decimals: 18,
      isNative: false as const,
    }));
    mockLoggerWarn.mockClear();
  });

  it("KYBER-FOT-WARN-NOT-VETO: tokenOut with tax > 20 (FoT) returns fail, not warn-only", async () => {
    // tokenOut has a 25% sell tax — exceeds the 20% veto threshold.
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_B.toLowerCase()) {
        return { isHoneypot: false, isFOT: true, tax: 25 };
      }
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.sell"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1", dryRun: true },
      ctx(),
    );

    // Must be a hard veto (success: false), not a warning that lets the swap proceed.
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/sell tax|FoT|Buy vetoed/i);

    // The aggregator route must NOT have been fetched — veto fires before routing.
    expect(mockGetRoute).not.toHaveBeenCalled();

    // Must NOT have emitted a warn-only log and continued (the old buggy path).
    const fotWarn = mockLoggerWarn.mock.calls.find(
      (c) => c[0] === "kyberswap.swap.fot_warning",
    );
    expect(fotWarn).toBeUndefined();
  });

  it("KYBER-FOT-WARN-NOT-VETO: tokenOut with tax exactly at threshold (20) warns but does NOT veto", async () => {
    // Boundary: exactly at the threshold must NOT veto (> not >=).
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_B.toLowerCase()) {
        return { isHoneypot: false, isFOT: true, tax: 20 };
      }
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.sell"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1", dryRun: true },
      ctx(),
    );

    // Should reach the route step (dryRun returns ok with dryRun: true).
    expect(result.success).toBe(true);
    expect(JSON.parse(result.output).dryRun).toBe(true);
  });

  it("KYBER-FOT-WARN-NOT-VETO: tokenIn with high FoT is warn-only (no veto for tokenIn FoT)", async () => {
    // High-tax tokenIn (selling it for TOKEN_B): no veto for the input leg.
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_A.toLowerCase()) {
        return { isHoneypot: false, isFOT: true, tax: 60 };
      }
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.sell"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1", dryRun: true },
      ctx(),
    );

    // tokenIn FoT is warn-only — the swap must reach the route step.
    expect(result.success).toBe(true);
    expect(JSON.parse(result.output).dryRun).toBe(true);
    expect(mockGetRoute).toHaveBeenCalledTimes(1);
  });
});

describe("KYBER-NO-SELLBACK-PROBE — behavior", () => {
  beforeEach(() => {
    mockGetHoneypotFotInfo.mockReset();
    mockGetHoneypotFotInfo.mockResolvedValue({ isHoneypot: false, isFOT: false, tax: 0 });
    mockGetRoute.mockReset();
    mockGetRoute.mockResolvedValue(FORWARD_ROUTE_RESPONSE);
    mockReadErc20Metadata.mockReset();
    mockReadErc20Metadata.mockImplementation(async (_slug: string, address: string) => ({
      address,
      symbol: "TKN",
      name: "Token",
      decimals: 18,
      isNative: false as const,
    }));
    mockLoggerWarn.mockClear();
  });

  it("KYBER-NO-SELLBACK-PROBE: missing routeSummary in reverse-route response vetoes the buy", async () => {
    // Forward route succeeds; sellback probe returns a response with no routeSummary
    // (the aggregator can't find a reverse path → potential honeypot).
    mockGetRoute
      .mockResolvedValueOnce(FORWARD_ROUTE_RESPONSE) // forward: ETH/TOKEN→TOKEN
      .mockResolvedValueOnce({                        // reverse probe: no route
        data: { routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" },
        // routeSummary is absent
      });

    // kyberswap.swap.buy with side="buy" and both tokens non-native:
    // economicSide = "buy" (falls to declared side), so the probe fires.
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.buy"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1" },
      ctx(),
    );

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/honeypot|sell route/i);

    // Both forward and reverse routes were fetched.
    expect(mockGetRoute).toHaveBeenCalledTimes(2);
    // Second call is the reverse probe (swapped legs).
    const [, reverseArgs] = mockGetRoute.mock.calls[1] as [string, { tokenIn: string; tokenOut: string }];
    expect(reverseArgs.tokenIn.toLowerCase()).toBe(TOKEN_B.toLowerCase());
    expect(reverseArgs.tokenOut.toLowerCase()).toBe(TOKEN_A.toLowerCase());
  });

  it("KYBER-NO-SELLBACK-PROBE: present reverse route allows the buy to proceed", async () => {
    // Both forward and sellback routes return a valid routeSummary.
    mockGetRoute
      .mockResolvedValueOnce(FORWARD_ROUTE_RESPONSE) // forward
      .mockResolvedValueOnce({                        // sellback probe: route exists
        data: {
          routeSummary: { amountIn: "999000000000000000", amountOut: "1000000000000000000" },
          routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
        },
      });

    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.buy"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1", dryRun: true },
      ctx(),
    );

    // Probe passed — the swap reached the dryRun return.
    expect(result.success).toBe(true);
    expect(JSON.parse(result.output).dryRun).toBe(true);
    expect(mockGetRoute).toHaveBeenCalledTimes(2);
  });

  it("KYBER-NO-SELLBACK-PROBE: probe API failure is fail-soft (does not block the buy)", async () => {
    // Forward route ok; probe throws (network error) → fail-soft, proceed.
    mockGetRoute
      .mockResolvedValueOnce(FORWARD_ROUTE_RESPONSE)
      .mockRejectedValueOnce(new Error("Rate limited"));

    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.buy"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1", dryRun: true },
      ctx(),
    );

    // Transient API failure must not abort a legit buy.
    expect(result.success).toBe(true);
    expect(JSON.parse(result.output).dryRun).toBe(true);
    // A bounded warn must have been emitted.
    const probeWarn = mockLoggerWarn.mock.calls.find(
      (c) => c[0] === "kyberswap.swap.sellback_probe_failed",
    );
    expect(probeWarn).toBeDefined();
  });
});
