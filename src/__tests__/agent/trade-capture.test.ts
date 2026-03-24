import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeEntry } from "../../agent/types.js";

const storedTrades = new Map<string, TradeEntry>();
const mockAddTrade = vi.fn(async (trade: TradeEntry) => {
  storedTrades.set(trade.id, trade);
});
const mockGetTradeById = vi.fn(async (id: string) => storedTrades.get(id) ?? null);

vi.mock("../../agent/db/repos/trades.js", () => ({
  addTrade: (...args: unknown[]) => mockAddTrade(...args),
  getTradeById: (...args: unknown[]) => mockGetTradeById(...args),
}));

vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { captureTradeFromResult } = await import("../../agent/trade-capture.js");

describe("captureTradeFromResult", () => {
  beforeEach(() => {
    storedTrades.clear();
    vi.clearAllMocks();
  });

  it("captures a Solana swap execution", async () => {
    await captureTradeFromResult(
      "solana_swap_execute",
      ["solana", "swap", "execute", "SOL", "USDC", "--amount", "1", "--slippage-bps", "50", "--json", "--yes"],
      JSON.stringify({
        success: true,
        signature: "sig-sol-swap",
        explorerUrl: "https://explorer.solana.com/tx/sig-sol-swap",
        inputToken: "SOL",
        outputToken: "USDC",
        inputAmount: "1",
        outputAmount: "150.25",
      }),
    );

    expect(mockAddTrade).toHaveBeenCalledTimes(1);
    const trade = [...storedTrades.values()][0];
    expect(trade.type).toBe("swap");
    expect(trade.chain).toBe("solana");
    expect(trade.input).toEqual({ token: "SOL", amount: "1" });
    expect(trade.output).toEqual({ token: "USDC", amount: "150.25" });
    expect(trade.meta.dex).toBe("jupiter");
  });

  it("merges prediction close into the existing open position", async () => {
    await captureTradeFromResult(
      "solana_predict_buy",
      ["solana", "predict", "buy", "market-1", "--side", "yes", "--amount", "10", "--json", "--yes"],
      JSON.stringify({
        success: true,
        action: "predict-buy",
        marketId: "market-1",
        side: "yes",
        amount: 10,
        signature: "sig-predict-buy",
        positionPubkey: "position-abc",
      }),
    );

    await captureTradeFromResult(
      "solana_predict_sell",
      ["solana", "predict", "sell", "position-abc", "--json", "--yes"],
      JSON.stringify({
        success: true,
        action: "predict-sell",
        signature: "sig-predict-sell",
      }),
    );

    expect(storedTrades.size).toBe(1);
    const trade = [...storedTrades.values()][0];
    expect(trade.status).toBe("closed");
    expect(trade.meta.marketId).toBe("market-1");
    expect(trade.meta.positionPubkey).toBe("position-abc");
    expect(trade.input.token).toBe("USDC");
    expect(trade.signature).toBe("sig-predict-sell");
  });

  it("captures Khalani bridge submissions as pending trades on canonical chains", async () => {
    await captureTradeFromResult(
      "khalani_bridge",
      [
        "khalani", "bridge",
        "--from-chain", "eth",
        "--from-token", "0xFrom",
        "--to-chain", "poly",
        "--to-token", "0xTo",
        "--amount", "12345",
        "--json", "--yes",
      ],
      JSON.stringify({
        success: true,
        orderId: "order-1",
        txHash: "0xbridgehash",
        explorerUrl: "https://etherscan.io/tx/0xbridgehash",
        routeId: "route-1",
        sourceChainId: 1,
        destinationChainId: 137,
      }),
    );

    const trade = [...storedTrades.values()][0];
    expect(trade.type).toBe("bridge");
    expect(trade.status).toBe("pending");
    expect(trade.chain).toBe("ethereum");
    expect(trade.meta.sourceChain).toBe("ethereum");
    expect(trade.meta.destChain).toBe("polygon");
    expect(trade.meta.orderId).toBe("order-1");
  });

  it("ignores dry runs and unsuccessful outputs", async () => {
    await captureTradeFromResult(
      "jaine_swap_sell",
      ["jaine", "swap", "sell", "w0G", "USDC", "--amount-in", "5", "--json"],
      JSON.stringify({ success: true, dryRun: true }),
    );
    await captureTradeFromResult(
      "jaine_swap_sell",
      ["jaine", "swap", "sell", "w0G", "USDC", "--amount-in", "5", "--json", "--yes"],
      JSON.stringify({ success: false, error: { code: "NO_ROUTE" } }),
    );

    expect(mockAddTrade).not.toHaveBeenCalled();
    expect(storedTrades.size).toBe(0);
  });
});
