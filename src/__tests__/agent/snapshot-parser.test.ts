/**
 * Tests for portfolio snapshot field mapping, NaN guards, and chain resolution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB client
vi.mock("../../agent/db/client.js", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

// Mock snapshots repo
const mockGetLatest = vi.fn().mockResolvedValue(null);
const mockInsertSnapshot = vi.fn().mockResolvedValue(1);

vi.mock("../../agent/db/repos/snapshots.js", () => ({
  getLatest: (...args: unknown[]) => mockGetLatest(...args),
  insertSnapshot: (...args: unknown[]) => mockInsertSnapshot(...args),
}));

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Mock execFile to control CLI output
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const { takeSnapshot } = await import("../../agent/snapshot.js");
const logger = (await import("../../utils/logger.js")).default;

// Helper: simulate CLI returning JSON
function mockCliResponse(responses: Record<string, string>) {
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
    const key = args.join(" ");
    for (const [pattern, response] of Object.entries(responses)) {
      if (key.includes(pattern)) {
        cb(null, response);
        return;
      }
    }
    cb(new Error("Unknown CLI command"), "");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLatest.mockResolvedValue(null);
  mockInsertSnapshot.mockResolvedValue(1);
});

describe("takeSnapshot EVM token parsing", () => {
  it("parses tokens[] array from CLI output (not balances[])", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({
        success: true,
        address: "0x123",
        tokens: [
          { address: "0xToken", chainId: 16661, symbol: "TEST", decimals: 18, extensions: { balance: "100.5", price: { usd: "2.0" } } },
        ],
      }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    expect(mockInsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      positions: expect.arrayContaining([
        expect.objectContaining({ symbol: "TEST", usdValue: 201 }),
      ]),
    }));
  });

  it("reads balance from extensions.balance", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({
        success: true, tokens: [
          { address: "0x1", chainId: 1, symbol: "ETH", decimals: 18, extensions: { balance: "3.5", price: { usd: "3000" } } },
        ],
      }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    const call = mockInsertSnapshot.mock.calls[0][0];
    expect(call.positions[0].amount).toBe("3.5");
    expect(call.positions[0].usdValue).toBe(10500);
  });

  it("resolves chainId to canonical portfolio chain names", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({
        success: true, tokens: [
          { address: "0x1", chainId: 16661, symbol: "0G", decimals: 18, extensions: { balance: "1", price: { usd: "0.1" } } },
          { address: "0x2", chainId: 42161, symbol: "ARB", decimals: 18, extensions: { balance: "10", price: { usd: "1" } } },
        ],
      }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    const positions = mockInsertSnapshot.mock.calls[0][0].positions;
    expect(positions[0].chain).toBe("0g");
    expect(positions[1].chain).toBe("arbitrum");
  });

  it("skips tokens with NaN balance and logs warning", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({
        success: true, tokens: [
          { address: "0x1", chainId: 1, symbol: "BAD", decimals: 18, extensions: { balance: "not-a-number", price: { usd: "1" } } },
          { address: "0x2", chainId: 1, symbol: "GOOD", decimals: 18, extensions: { balance: "10", price: { usd: "2" } } },
        ],
      }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    const positions = mockInsertSnapshot.mock.calls[0][0].positions;
    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe("GOOD");
    expect(logger.warn).toHaveBeenCalledWith("snapshot.evm.invalid_token_data", expect.objectContaining({ symbol: "BAD" }));
  });

  it("skips tokens with NaN price and logs warning", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({
        success: true, tokens: [
          { address: "0x1", chainId: 1, symbol: "NOPRICE", decimals: 18, extensions: { balance: "10", price: { usd: "abc" } } },
        ],
      }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    const positions = mockInsertSnapshot.mock.calls[0][0].positions;
    expect(positions).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith("snapshot.evm.invalid_token_data", expect.anything());
  });

  it("logs warning when response has no tokens array", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({ success: true, balances: [] }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    expect(logger.warn).toHaveBeenCalledWith("snapshot.evm.unexpected_shape", expect.anything());
  });

  it("handles missing extensions gracefully (defaults to 0)", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({
        success: true, tokens: [
          { address: "0x1", chainId: 1, symbol: "NOEXT", decimals: 18 },
        ],
      }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    const positions = mockInsertSnapshot.mock.calls[0][0].positions;
    expect(positions[0].amount).toBe("0");
    expect(positions[0].usdValue).toBe(0);
  });

  it("handles empty tokens array", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({ success: true, tokens: [] }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    expect(mockInsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      totalUsd: 0,
    }));
  });

  it("uses fallback chain name for unknown chainId", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({
        success: true, tokens: [
          { address: "0x1", chainId: 999999, symbol: "UNK", decimals: 18, extensions: { balance: "1", price: { usd: "1" } } },
        ],
      }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    const positions = mockInsertSnapshot.mock.calls[0][0].positions;
    expect(positions[0].chain).toBe("evm-999999");
  });

  it("tracks all KyberSwap-supported chains by default", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({ success: true, tokens: [] }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    const activeChains = mockInsertSnapshot.mock.calls[0][0].activeChains;
    expect(activeChains).toEqual(expect.arrayContaining([
      "0g",
      "solana",
      "ethereum",
      "arbitrum",
      "base",
      "polygon",
      "ronin",
      "megaeth",
    ]));
    expect(activeChains).not.toContain("eth");
    expect(activeChains).not.toContain("arb");
  });
});

describe("takeSnapshot Solana token parsing", () => {
  it("uses 'solana' as chain name", async () => {
    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({ success: true, tokens: [] }),
      "khalani tokens balances --wallet solana": JSON.stringify({
        success: true, tokens: [
          { address: "SoLAddr", chainId: 20011000000, symbol: "SOL", decimals: 9, extensions: { balance: "5.25", price: { usd: "150" } } },
        ],
      }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    const positions = mockInsertSnapshot.mock.calls[0][0].positions;
    expect(positions[0].chain).toBe("solana");
    expect(positions[0].usdValue).toBe(787.5);
  });
});

describe("takeSnapshot P&L calculation", () => {
  it("calculates pnlVsPrev from previous snapshot", async () => {
    mockGetLatest.mockResolvedValueOnce({ totalUsd: 100 });

    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({
        success: true, tokens: [
          { address: "0x1", chainId: 1, symbol: "T", decimals: 18, extensions: { balance: "150", price: { usd: "1" } } },
        ],
      }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    expect(mockInsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      pnlVsPrev: 50,
      pnlPctVsPrev: 50,
    }));
  });

  it("skips P&L when no previous snapshot", async () => {
    mockGetLatest.mockResolvedValueOnce(null);

    mockCliResponse({
      "khalani tokens balances --wallet eip155": JSON.stringify({ success: true, tokens: [] }),
      "khalani tokens balances --wallet solana": JSON.stringify({ success: true, tokens: [] }),
      "wallet balance": JSON.stringify({ success: false }),
    });

    await takeSnapshot("test");

    expect(mockInsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      pnlVsPrev: undefined,
      pnlPctVsPrev: undefined,
    }));
  });
});
