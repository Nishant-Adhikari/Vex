import { beforeEach, describe, expect, it, vi } from "vitest";

function callMock<T>(mock: unknown, args: unknown[]): T {
  return (mock as (...innerArgs: unknown[]) => T)(...args);
}

const mockEvents = vi.fn();
const mockSearchEvents = vi.fn();
const mockEvent = vi.fn();
const mockSuggestedEvents = vi.fn();
const mockEventMarkets = vi.fn();
const mockEventMarket = vi.fn();
const mockMarket = vi.fn();
const mockOrderbook = vi.fn();
const mockTradingStatus = vi.fn();
const mockOrders = vi.fn();
const mockOrder = vi.fn();
const mockOrderStatus = vi.fn();
const mockPositions = vi.fn();
const mockPosition = vi.fn();
const mockHistory = vi.fn();
const mockProfile = vi.fn();
const mockPnlHistory = vi.fn();
const mockTrades = vi.fn();
const mockLeaderboards = vi.fn();
const mockVaultInfo = vi.fn();
const mockCreateOrder = vi.fn();
const mockClosePosition = vi.fn();
const mockCloseAll = vi.fn();
const mockClaimPosition = vi.fn();

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/client.js", () => ({
  jupiterPredictionEvents: (...args: unknown[]) => callMock(mockEvents, args),
  jupiterPredictionSearchEvents: (...args: unknown[]) => callMock(mockSearchEvents, args),
  jupiterPredictionEvent: (...args: unknown[]) => callMock(mockEvent, args),
  jupiterPredictionSuggestedEvents: (...args: unknown[]) => callMock(mockSuggestedEvents, args),
  jupiterPredictionEventMarkets: (...args: unknown[]) => callMock(mockEventMarkets, args),
  jupiterPredictionEventMarket: (...args: unknown[]) => callMock(mockEventMarket, args),
  jupiterPredictionMarket: (...args: unknown[]) => callMock(mockMarket, args),
  jupiterPredictionOrderbook: (...args: unknown[]) => callMock(mockOrderbook, args),
  jupiterPredictionTradingStatus: (...args: unknown[]) => callMock(mockTradingStatus, args),
  jupiterPredictionOrders: (...args: unknown[]) => callMock(mockOrders, args),
  jupiterPredictionOrder: (...args: unknown[]) => callMock(mockOrder, args),
  jupiterPredictionOrderStatus: (...args: unknown[]) => callMock(mockOrderStatus, args),
  jupiterPredictionPositions: (...args: unknown[]) => callMock(mockPositions, args),
  jupiterPredictionPosition: (...args: unknown[]) => callMock(mockPosition, args),
  jupiterPredictionHistory: (...args: unknown[]) => callMock(mockHistory, args),
  jupiterPredictionProfile: (...args: unknown[]) => callMock(mockProfile, args),
  jupiterPredictionPnlHistory: (...args: unknown[]) => callMock(mockPnlHistory, args),
  jupiterPredictionTrades: (...args: unknown[]) => callMock(mockTrades, args),
  jupiterPredictionLeaderboards: (...args: unknown[]) => callMock(mockLeaderboards, args),
  jupiterPredictionVaultInfo: (...args: unknown[]) => callMock(mockVaultInfo, args),
  jupiterPredictionCreateOrder: (...args: unknown[]) => callMock(mockCreateOrder, args),
  jupiterPredictionClosePosition: (...args: unknown[]) => callMock(mockClosePosition, args),
  jupiterPredictionCloseAllPositions: (...args: unknown[]) => callMock(mockCloseAll, args),
  jupiterPredictionClaimPosition: (...args: unknown[]) => callMock(mockClaimPosition, args),
}));

const mockSignAndSend = vi.fn();
vi.mock("@tools/solana-ecosystem/shared/solana-transaction.js", () => ({
  signAndSendVersionedTx: (...args: unknown[]) => callMock(mockSignAndSend, args),
}));

vi.mock("@config/store.js", () => ({
  loadConfig: () => ({
    solana: { explorerUrl: "https://explorer.solana.com", cluster: "mainnet-beta" },
  }),
}));

const {
  getJupiterPredictionEvents,
  getJupiterPredictionPositions,
  getJupiterPredictionProfile,
  executeJupiterPredictionCreateOrder,
  executeJupiterPredictionClosePosition,
  executeJupiterPredictionCloseAllPositions,
  executeJupiterPredictionClaimPosition,
} = await import("@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.js");

const { Keypair } = await import("@solana/web3.js");
const { VexError, ErrorCodes } = await import("../../../../errors.js");

const USER = Keypair.generate();
const USER_ADDRESS = USER.publicKey.toBase58();
const POSITION = "7xKXtg2CWwM2s7x8H8sZZtP2C2xY2hW3ni8dD8R9Lk8m";
const MARKET_ID = "market-456";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("jupiter prediction api service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through read payloads without reshaping", async () => {
    const eventsPayload = { data: [{ eventId: "event-1" }], pagination: { start: 0, end: 1, total: 1, hasNext: false } };
    const positionsPayload = { data: [{ pubkey: POSITION }], pagination: { start: 0, end: 1, total: 1, hasNext: false } };
    const profilePayload = { ownerPubkey: USER_ADDRESS, realizedPnlUsd: "1", totalVolumeUsd: "2", predictionsCount: "3", correctPredictions: "4", wrongPredictions: "5", totalActiveContracts: "6", totalPositionsValueUsd: "7" };

    mockEvents.mockResolvedValueOnce(eventsPayload);
    mockPositions.mockResolvedValueOnce(positionsPayload);
    mockProfile.mockResolvedValueOnce(profilePayload);

    expect(await getJupiterPredictionEvents({ category: "crypto" })).toBe(eventsPayload);
    expect(await getJupiterPredictionPositions({ ownerPubkey: USER_ADDRESS })).toBe(positionsPayload);
    expect(await getJupiterPredictionProfile(USER_ADDRESS)).toBe(profilePayload);
  });

  it("derives the signer correctly for create, close, and claim execution helpers", async () => {
    mockCreateOrder.mockResolvedValueOnce({
      transaction: "create-base64",
      txMeta: { blockhash: "bh", lastValidBlockHeight: 1 },
      externalOrderId: "ext",
      order: { orderPubkey: "order-1" },
    });
    mockClosePosition.mockResolvedValueOnce({
      transaction: "close-base64",
      txMeta: { blockhash: "bh", lastValidBlockHeight: 1 },
      externalOrderId: "ext",
      order: { orderPubkey: "order-2" },
    });
    mockClaimPosition.mockResolvedValueOnce({
      transaction: "claim-base64",
      txMeta: { blockhash: "bh", lastValidBlockHeight: 1 },
      position: { positionPubkey: POSITION },
    });
    mockSignAndSend
      .mockResolvedValueOnce("sig-create")
      .mockResolvedValueOnce("sig-close")
      .mockResolvedValueOnce("sig-claim");

    const created = await executeJupiterPredictionCreateOrder(USER.secretKey, {
      marketId: MARKET_ID,
      isYes: true,
      isBuy: true,
      depositAmount: "1000000",
      depositMint: USDC,
    });
    const closed = await executeJupiterPredictionClosePosition(USER.secretKey, POSITION);
    const claimed = await executeJupiterPredictionClaimPosition(USER.secretKey, POSITION);

    expect(mockCreateOrder).toHaveBeenCalledWith({
      ownerPubkey: USER_ADDRESS,
      marketId: MARKET_ID,
      isYes: true,
      isBuy: true,
      depositAmount: "1000000",
      depositMint: USDC,
    });
    expect(mockClosePosition).toHaveBeenCalledWith(POSITION, { ownerPubkey: USER_ADDRESS });
    expect(mockClaimPosition).toHaveBeenCalledWith(POSITION, { ownerPubkey: USER_ADDRESS });

    expect(mockSignAndSend).toHaveBeenCalledTimes(3);
    expect(mockSignAndSend.mock.calls[0][0]).toBe("create-base64");
    expect(mockSignAndSend.mock.calls[1][0]).toBe("close-base64");
    expect(mockSignAndSend.mock.calls[2][0]).toBe("claim-base64");
    for (const call of mockSignAndSend.mock.calls) {
      expect(call[1][0].publicKey.toBase58()).toBe(USER_ADDRESS);
    }

    expect(created.signature).toBe("sig-create");
    expect(closed.signature).toBe("sig-close");
    expect(claimed.signature).toBe("sig-claim");
  });

  it("executes close-all responses sequentially and preserves item kinds", async () => {
    mockCloseAll.mockResolvedValueOnce({
      data: [
        {
          transaction: "close-all-1",
          txMeta: { blockhash: "bh", lastValidBlockHeight: 1 },
          externalOrderId: "ext-1",
          order: { orderPubkey: "order-1" },
        },
        {
          transaction: "close-all-2",
          txMeta: { blockhash: "bh", lastValidBlockHeight: 1 },
          position: { positionPubkey: POSITION },
        },
      ],
    });
    mockSignAndSend
      .mockResolvedValueOnce("sig-1")
      .mockResolvedValueOnce("sig-2");

    const result = await executeJupiterPredictionCloseAllPositions(USER.secretKey);

    expect(mockCloseAll).toHaveBeenCalledWith({ ownerPubkey: USER_ADDRESS });
    expect(mockSignAndSend.mock.calls[0][0]).toBe("close-all-1");
    expect(mockSignAndSend.mock.calls[1][0]).toBe("close-all-2");
    expect(result.signer).toBe(USER_ADDRESS);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].kind).toBe("order");
    expect(result.results[1].kind).toBe("claim");
    expect(result.results[0].signature).toBe("sig-1");
    expect(result.results[1].signature).toBe("sig-2");
  });

  it("B-007: close-all halts and surfaces an unknown post-broadcast state without resending remaining items", async () => {
    mockCloseAll.mockResolvedValueOnce({
      data: [
        {
          transaction: "close-all-1",
          txMeta: { blockhash: "bh", lastValidBlockHeight: 1 },
          externalOrderId: "ext-1",
          order: { orderPubkey: "order-1" },
        },
        {
          transaction: "close-all-2",
          txMeta: { blockhash: "bh", lastValidBlockHeight: 1 },
          position: { positionPubkey: POSITION },
        },
      ],
    });

    // First item: broadcast succeeded but confirmation is unknown. The
    // idempotency-safe send helper throws a non-retryable error carrying the
    // signature instead of re-broadcasting.
    const unknown = new VexError(
      ErrorCodes.SOLANA_TX_TIMEOUT,
      "Transaction broadcast but confirmation is unknown (SOLANA_TX_TIMEOUT)",
      "Signature: sig-1\nExplorer: https://explorer.solana.com/tx/sig-1",
    );
    unknown.retryable = false;
    mockSignAndSend.mockRejectedValueOnce(unknown);

    await expect(
      executeJupiterPredictionCloseAllPositions(USER.secretKey),
    ).rejects.toMatchObject({
      code: ErrorCodes.SOLANA_TX_TIMEOUT,
      retryable: false,
    });

    // The unknown state halts the loop: only the first item was sent, the
    // second item is NEVER broadcast (no blind resend / continuation).
    expect(mockSignAndSend).toHaveBeenCalledTimes(1);
    expect(mockSignAndSend.mock.calls[0][0]).toBe("close-all-1");
  });
});
