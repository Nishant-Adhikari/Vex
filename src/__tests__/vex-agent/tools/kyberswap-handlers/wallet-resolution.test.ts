import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

// ── Per-session wallet resolution mock (5D-protocols p1) ──────────
// Handlers now resolve the session wallet via resolve.js (NOT the zero-arg
// requireEvmWallet primary). Spy on the resolvers to assert the session wallet
// is used and that preview/dryRun never decrypts a signing key.

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

/** Type-complete ProtocolExecutionContext for handler tests. */
function ctx(over: Partial<ProtocolExecutionContext> = {}): ProtocolExecutionContext {
  return {
    sessionPermission: "full",
    approved: true,
    walletResolution: { source: "default" },
    walletPolicy: { kind: "none" },
    ...over,
  };
}

const mockGetZapInRoute = vi.fn();
const mockBuildZapIn = vi.fn();
const mockGetZapOutRoute = vi.fn();
const mockBuildZapOut = vi.fn();
const mockGetZapMigrateRoute = vi.fn();
const mockBuildZapMigrate = vi.fn();

vi.mock("@tools/kyberswap/zaas/client.js", () => ({
  getKyberZaasClient: () => ({
    getZapInRoute: (...args: unknown[]) => mockGetZapInRoute(...args),
    buildZapIn: (...args: unknown[]) => mockBuildZapIn(...args),
    getZapOutRoute: (...args: unknown[]) => mockGetZapOutRoute(...args),
    buildZapOut: (...args: unknown[]) => mockBuildZapOut(...args),
    getZapMigrateRoute: (...args: unknown[]) => mockGetZapMigrateRoute(...args),
    buildZapMigrate: (...args: unknown[]) => mockBuildZapMigrate(...args),
  }),
}));

const mockExtractMintedNftId = vi.fn();
const mockExtractErc1155Position = vi.fn();

// readErc20Metadata is used by resolveTokenMetadataStrict for address inputs
// (the quote path is now strict/address-only, matching execute).
// Default: return plain ERC-20 metadata so non-native token addresses resolve
// without an on-chain read. Tests override per-case where needed.
const mockReadErc20Metadata = vi.fn(async (_slug: string, address: string) => ({
  address,
  symbol: "TKN",
  name: "Token",
  decimals: 18,
  isNative: false as const,
}));

vi.mock("@tools/kyberswap/evm-utils.js", () => ({
  getKyberEvmClients: () => ({
    publicClient: {},
    walletClient: {},
  }),
  ensureKyberAllowance: vi.fn().mockResolvedValue(undefined),
  ensureErc721Approval: vi.fn().mockResolvedValue(null),
  ensureErc1155ApprovalForAll: vi.fn().mockResolvedValue(null),
  sendKyberTransaction: vi.fn().mockResolvedValue("0xmockhash"),
  sendKyberTransactionWithReceipt: vi.fn().mockResolvedValue({
    hash: "0xzaphash",
    receipt: { logs: [{ topics: ["0xddf252ad"], data: "0x" }] },
  }),
  extractMintedNftId: (...args: unknown[]) => mockExtractMintedNftId(...args),
  extractErc1155Position: (...args: unknown[]) => mockExtractErc1155Position(...args),
  readErc20Metadata: (...args: [string, string]) => mockReadErc20Metadata(...args),
  verifyRouterAddress: vi.fn(),
}));

// Mock token API for safety gate + quote-time safety surfacing (Stage 6b).
// Shared spy so individual tests can drive honeypot/FoT/check-failed scenarios.
const mockGetHoneypotFotInfo = vi.fn().mockResolvedValue({ isHoneypot: false, isFOT: false, tax: 0 });

vi.mock("@tools/kyberswap/token-api/client.js", () => ({
  getKyberTokenApiClient: () => ({
    searchTokens: vi.fn().mockResolvedValue([]),
    getHoneypotFotInfo: (...args: [number, string]) => mockGetHoneypotFotInfo(...args),
  }),
}));

// Mock aggregator client so the read-only quote can fetch a route hermetically.
const mockGetRoute = vi.fn();

vi.mock("@tools/kyberswap/aggregator/client.js", () => ({
  getKyberAggregatorClient: () => ({
    getRoute: (...args: unknown[]) => mockGetRoute(...args),
  }),
}));

// Spy on logger.warn so the fail-soft safety leg's log payload can be asserted
// to contain NO raw provider/HTTP text (Stage 6b fix 1). Other methods are
// no-ops to keep tests hermetic and quiet.
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

import { KYBERSWAP_HANDLERS } from "../../../../vex-agent/tools/protocols/kyberswap/handlers.js";
import { KYBERSWAP_TOOLS } from "../../../../vex-agent/tools/protocols/kyberswap/manifest.js";

describe("kyberswap session wallet resolution", () => {
  const SESSION_CTX = ctx({
    walletResolution: { source: "session", evm: { id: "w-evm-1", address: SESSION_EVM.address }, solana: null },
    walletPolicy: { kind: "none" },
  });

  beforeEach(() => {
    mockResolveSigningWallet.mockClear();
    mockResolveSelectedAddress.mockClear();
  });

  it("zap.in resolves the SESSION signing wallet (not the zero-arg primary)", async () => {
    mockGetZapInRoute.mockResolvedValueOnce({
      data: { route: { r: 1 }, routerAddress: "0x2f1E23e0A5A56e7746E1Ae42d5c3112B2d0cf09B", zapDetails: { initialAmountUsd: "10.00", actions: [] } },
    });
    mockBuildZapIn.mockResolvedValueOnce({
      data: { routerAddress: "0x2f1E23e0A5A56e7746E1Ae42d5c3112B2d0cf09B", callData: "0xabcd", value: "0" },
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.in"]!(
      { chain: "polygon", dex: "DEX_UNISWAPV3", pool: "0xPool", tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", amountIn: "1000000000000000000" },
      SESSION_CTX,
    );

    expect(result.success).toBe(true);
    // Signer resolved from the SESSION resolution + policy, family eip155.
    expect(mockResolveSigningWallet).toHaveBeenCalledWith(
      SESSION_CTX.walletResolution, SESSION_CTX.walletPolicy, "eip155",
    );
  });

  it("zap.in dryRun (preview) does NOT decrypt a signing wallet", async () => {
    mockGetZapInRoute.mockResolvedValueOnce({
      data: { route: { r: 1 }, routerAddress: "0x2f1E23e0A5A56e7746E1Ae42d5c3112B2d0cf09B", zapDetails: { initialAmountUsd: "10.00", actions: [] } },
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.in"]!(
      { chain: "polygon", dex: "DEX_UNISWAPV3", pool: "0xPool", tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", amountIn: "1000000000000000000", dryRun: true },
      SESSION_CTX,
    );

    expect(result.success).toBe(true);
    expect(mockResolveSigningWallet).not.toHaveBeenCalled();
  });
});
