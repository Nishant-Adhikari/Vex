/**
 * Server-side wallet-ref resolution (puzzle 5 phase 5C). The renderer sends
 * only IDs; main resolves id → address from the inventory. A renderer-supplied
 * address is never trusted; an unknown id fails closed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetWalletById = vi.fn();
const mockGetPrimaryEvmEntry = vi.fn();
vi.mock("@vex-lib/wallet.js", () => ({
  getWalletById: (...a: unknown[]) => mockGetWalletById(...a),
  getPrimaryEvmEntry: (...a: unknown[]) => mockGetPrimaryEvmEntry(...a),
}));

const { resolveWalletRef, invalidWalletSelectionError, defaultMissionEvmWalletRef } =
  await import("../_wallet-refs.js");

const PRIMARY_ADDR = "0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveWalletRef", () => {
  it("null / empty id → null (unselected)", () => {
    expect(resolveWalletRef("evm", null)).toBeNull();
    expect(resolveWalletRef("evm", undefined)).toBeNull();
    expect(resolveWalletRef("evm", "")).toBeNull();
    expect(mockGetWalletById).not.toHaveBeenCalled();
  });

  it("known id → {id,address} resolved server-side from inventory", () => {
    mockGetWalletById.mockReturnValue({ id: "evm_1", address: "0xAbc", label: "Main", createdAt: "" });
    expect(resolveWalletRef("evm", "evm_1")).toEqual({ id: "evm_1", address: "0xAbc" });
    expect(mockGetWalletById).toHaveBeenCalledWith("evm", "evm_1");
  });

  it("unknown id → 'invalid' (caller fails closed)", () => {
    mockGetWalletById.mockReturnValue(null);
    expect(resolveWalletRef("solana", "sol_x")).toBe("invalid");
  });
});

describe("defaultMissionEvmWalletRef", () => {
  it("returns the primary EVM entry as {id,address} (the 0x9ed2… trading wallet)", () => {
    mockGetPrimaryEvmEntry.mockReturnValue({
      id: "evm_legacy",
      address: PRIMARY_ADDR,
      label: "Primary",
      createdAt: "",
      legacy: true,
      vault: false,
    });
    expect(defaultMissionEvmWalletRef()).toEqual({ id: "evm_legacy", address: PRIMARY_ADDR });
  });

  it("returns null when the primary entry is a vault (never default onto hold-only)", () => {
    mockGetPrimaryEvmEntry.mockReturnValue({ id: "evm_vault", address: "0xVault", vault: true });
    expect(defaultMissionEvmWalletRef()).toBeNull();
  });

  it("returns null when there is no primary entry", () => {
    mockGetPrimaryEvmEntry.mockReturnValue(null);
    expect(defaultMissionEvmWalletRef()).toBeNull();
  });
});

describe("invalidWalletSelectionError", () => {
  it("builds a redacted wallets.invalid_selection VexError with the correlation id", () => {
    const e = invalidWalletSelectionError("corr-1");
    expect(e.code).toBe("wallets.invalid_selection");
    expect(e.domain).toBe("wallets");
    expect(e.correlationId).toBe("corr-1");
    expect(e.redacted).toBe(true);
    expect(e.retryable).toBe(false);
  });
});
