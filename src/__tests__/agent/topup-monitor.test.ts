import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock all dependencies
const mockGetLedgerState = vi.fn(async () => null);
const mockGetInferenceConfig = vi.fn(() => null);
const mockPublish = vi.fn(async () => {});
const mockGetBaseline = vi.fn(async () => ({ baselineLockedOg: 0, baselineTotalOg: 0, lastTopupAt: null, lastTopupAmountOg: null, updatedAt: "" }));
const mockRecordEvent = vi.fn(async () => {});
const mockUpdateBaseline = vi.fn(async () => {});

vi.mock("../../agent/billing.js", () => ({
  getLedgerState: (...a: unknown[]) => mockGetLedgerState(...a),
  isLowBalance: vi.fn(),
}));
vi.mock("../../agent/engine.js", () => ({
  getInferenceConfig: () => mockGetInferenceConfig(),
}));
vi.mock("../../agent/autonomy-inbox.js", () => ({
  publish: (...a: unknown[]) => mockPublish(...a),
}));
vi.mock("../../agent/db/repos/topup.js", () => ({
  getBaseline: () => mockGetBaseline(),
  recordEvent: (...a: unknown[]) => mockRecordEvent(...a),
  updateBaseline: (...a: unknown[]) => mockUpdateBaseline(...a),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { startMonitor, stopMonitor, onTopupSuccess, checkBalance, _resetForTest } from "../../agent/topup-monitor.js";

describe("topup-monitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    _resetForTest();
  });

  afterEach(() => {
    stopMonitor();
    vi.useRealTimers();
  });

  it("does not alert when balance is above threshold", async () => {
    mockGetInferenceConfig.mockReturnValue({ provider: "p1", model: "m1", alertThresholdOg: 0.5 });
    mockGetLedgerState.mockResolvedValue({ providerLockedOg: 1.0, ledgerAvailableOg: 2.0, fetchedAt: "" });
    mockGetBaseline.mockResolvedValue({ baselineLockedOg: 0, baselineTotalOg: 0, lastTopupAt: null, lastTopupAmountOg: null, updatedAt: "" });

    startMonitor();
    await vi.advanceTimersByTimeAsync(61_000);

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("publishes compute_balance_low when below threshold", async () => {
    mockGetInferenceConfig.mockReturnValue({ provider: "p1", model: "m1", alertThresholdOg: 0.5 });
    mockGetLedgerState.mockResolvedValue({ providerLockedOg: 0.3, ledgerAvailableOg: 0, fetchedAt: "" });
    mockGetBaseline.mockResolvedValue({ baselineLockedOg: 0, baselineTotalOg: 0, lastTopupAt: null, lastTopupAmountOg: null, updatedAt: "" });

    startMonitor();
    await vi.advanceTimersByTimeAsync(61_000);

    expect(mockPublish).toHaveBeenCalledWith("compute_balance_low", expect.objectContaining({
      providerAddress: "p1",
      providerLockedOg: 0.3,
    }));
  });

  it("uses hybrid threshold with baseline (direct call)", async () => {
    mockGetInferenceConfig.mockReturnValue({ provider: "p1", model: "m1", alertThresholdOg: 0.1 });
    // Baseline 10.0 → 15% = 1.5, higher than dynamic 0.1
    mockGetBaseline.mockResolvedValue({ baselineLockedOg: 10.0, baselineTotalOg: 10.0, lastTopupAt: null, lastTopupAmountOg: null, updatedAt: "" });
    // Balance 1.0 < threshold 1.5
    mockGetLedgerState.mockResolvedValue({ providerLockedOg: 1.0, ledgerAvailableOg: 0, fetchedAt: "" });

    await checkBalance();

    expect(mockPublish).toHaveBeenCalledWith("compute_balance_low", expect.objectContaining({
      providerLockedOg: 1.0,
    }));
  });

  it("respects cooldown between alerts (direct call)", async () => {
    mockGetInferenceConfig.mockReturnValue({ provider: "p1", model: "m1", alertThresholdOg: 0.5 });
    mockGetLedgerState.mockResolvedValue({ providerLockedOg: 0.1, ledgerAvailableOg: 0, fetchedAt: "" });
    mockGetBaseline.mockResolvedValue({ baselineLockedOg: 0, baselineTotalOg: 0, lastTopupAt: null, lastTopupAmountOg: null, updatedAt: "" });

    // First call → should alert
    await checkBalance();
    expect(mockPublish).toHaveBeenCalledTimes(1);

    // Second call immediately → cooldown blocks
    await checkBalance();
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it("onTopupSuccess resets alerts and updates baseline", async () => {
    await onTopupSuccess(5.0, 10.0, 2.0);

    expect(mockUpdateBaseline).toHaveBeenCalledWith(5.0, 10.0, 2.0);
    expect(mockRecordEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "topup_succeeded",
      amountOg: 2.0,
    }));
  });
});
