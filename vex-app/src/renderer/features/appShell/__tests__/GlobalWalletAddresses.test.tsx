/**
 * GlobalWalletAddresses — carries the session-mode sidebar's wallet
 * identity presentation (DepositAddresses) onto the welcome/empty state
 * (WP-L). Data source: `useAvailableWallets` (the existing config-backed
 * inventory hook — NO new IPC). Renders nothing while loading/erroring or
 * when the inventory is empty (a convenience row, not a panel state).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUseAvailableWallets = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api/wallet-inventory.js", () => ({
  useAvailableWallets: mockUseAvailableWallets,
}));

const { GlobalWalletAddresses } = await import(
  "../book/GlobalWalletAddresses.js"
);

const EVM_1 = { id: "evm-1", family: "evm" as const, address: "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa", label: "" };
const EVM_2 = { id: "evm-2", family: "evm" as const, address: "0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb", label: "Trading" };
const SOL_1 = { id: "sol-1", family: "solana" as const, address: "9jk8UbH339rCgnohpBvqiss4a7bXWmicMPCUCFmDrmYK", label: "" };

function mockWallets(evm: (typeof EVM_1)[], solana: (typeof SOL_1)[]): void {
  mockUseAvailableWallets.mockReturnValue({
    data: { ok: true, data: { evm, solana } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GlobalWalletAddresses", () => {
  it("renders nothing when the inventory has no wallets", () => {
    mockWallets([], []);
    const { container } = render(<GlobalWalletAddresses />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the query has not resolved a result yet", () => {
    mockUseAvailableWallets.mockReturnValue({ data: undefined });
    const { container } = render(<GlobalWalletAddresses />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing on a failed query result", () => {
    mockUseAvailableWallets.mockReturnValue({
      data: { ok: false, error: { code: "INTERNAL", message: "boom" } },
    });
    const { container } = render(<GlobalWalletAddresses />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the primary EVM and Solana wallets by default with no 'more wallets' group", () => {
    mockWallets([EVM_1], [SOL_1]);
    render(<GlobalWalletAddresses />);
    expect(screen.getByText("EVM")).not.toBeNull();
    expect(screen.getByText("SOL")).not.toBeNull();
    expect(screen.queryByText(/more wallet/)).toBeNull();
  });

  it("lists additional configured wallets below the primaries, with their label", () => {
    mockWallets([EVM_1, EVM_2], [SOL_1]);
    render(<GlobalWalletAddresses />);
    expect(screen.getByText("1 more wallet")).not.toBeNull();
    expect(screen.getByText("Trading")).not.toBeNull();
  });

  it("pluralizes the remaining-wallets count", () => {
    const evm3 = { id: "evm-3", family: "evm" as const, address: "0xCCCCccccCCCCccccCCCCccccCCCCccccCCCCcccc", label: "" };
    mockWallets([EVM_1, EVM_2, evm3], [SOL_1]);
    render(<GlobalWalletAddresses />);
    expect(screen.getByText("2 more wallets")).not.toBeNull();
  });
});
