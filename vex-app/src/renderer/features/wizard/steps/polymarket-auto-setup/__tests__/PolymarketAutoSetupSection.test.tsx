/**
 * PolymarketAutoSetupSection tests — per-wallet picker + two-modal flow
 * (feature #7 + puzzle 5 B-UI).
 *
 * Verifies:
 *  - button enabled state vs evmWalletPresent / vaultUnlocked / disabled,
 *  - the EVM wallet picker lists every wallet with a ✓ / ◦ badge,
 *  - the selection defaults to the primary (first EVM),
 *  - button label is per-wallet: configured → "Reconfigure", else
 *    "Auto-configure" (with the partial-aggregate variant),
 *  - NOT-configured selected wallet → skips ConfirmModal, opens SudoModal,
 *  - configured selected wallet → opens ConfirmModal first; confirm → Sudo,
 *  - ConfirmModal cancel → returns to idle,
 *  - SudoModal success → onSuccess fires AND the IPC carries the selected
 *    walletId,
 *  - SudoModal race fallback → re-opens ConfirmModal,
 *  - selecting a different wallet threads THAT walletId into the IPC.
 *
 * The picker reads `window.vex.wallets.listAvailable` and
 * `window.vex.onboarding.polymarketConfiguredAddresses` (both mocked on the
 * global window); the SudoModal drives `polymarketAutoSetup`. Renders are
 * wrapped in a QueryClientProvider so the TanStack hooks resolve.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { JSX } from "react";
import type { Result } from "@shared/ipc/result.js";
import type { PolymarketStatus } from "@shared/schemas/api-keys.js";
import type {
  AvailableWalletsDto,
  AvailableWalletDto,
} from "@shared/schemas/wallets.js";

interface PolymarketAutoSetupInput {
  readonly password: string;
  readonly riskAcknowledged: true;
  readonly overwriteConfirmed: boolean;
  readonly walletId?: string;
}

interface PolymarketAutoSetupResultShape {
  readonly configured: true;
  readonly address: string;
}

interface ConfiguredAddressesResult {
  readonly addresses: readonly string[];
}

const mockAutoSetup = vi.fn<
  (input: PolymarketAutoSetupInput) => Promise<Result<PolymarketAutoSetupResultShape>>
>();
const mockListAvailable = vi.fn<
  (input: Record<string, never>) => Promise<Result<AvailableWalletsDto>>
>();
const mockConfiguredAddresses = vi.fn<
  () => Promise<Result<ConfiguredAddressesResult>>
>();
const mockOnSuccess = vi.fn();

const { PolymarketAutoSetupSection } = await import(
  "../PolymarketAutoSetupSection.js"
);

const PRIMARY_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const SECOND_ADDRESS = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

const PRIMARY_WALLET: AvailableWalletDto = {
  id: "evm_legacy",
  family: "evm",
  address: PRIMARY_ADDRESS,
  label: "Primary",
};
const SECOND_WALLET: AvailableWalletDto = {
  id: "evm_22222222-2222-2222-2222-222222222222",
  family: "evm",
  address: SECOND_ADDRESS,
  label: "Trading",
};

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

function renderSection(
  props?: Partial<{
    status: PolymarketStatus;
    evmWalletPresent: boolean;
    vaultUnlocked: boolean;
    disabled: boolean;
    onSuccess: typeof mockOnSuccess;
  }>,
): RenderResult {
  const ui: JSX.Element = (
    <PolymarketAutoSetupSection
      status={props?.status ?? "missing"}
      evmWalletPresent={props?.evmWalletPresent ?? true}
      vaultUnlocked={props?.vaultUnlocked ?? true}
      disabled={props?.disabled ?? false}
      onSuccess={props?.onSuccess ?? mockOnSuccess}
    />
  );
  return render(
    <QueryClientProvider client={newClient()}>{ui}</QueryClientProvider>,
  );
}

/** Wait until the picker has rendered its wallet rows (queries resolved). */
async function waitForPicker(view: RenderResult): Promise<void> {
  await waitFor(() => {
    expect(
      view.container.querySelector("[data-vex-polymarket-auto-wallet]"),
    ).not.toBeNull();
  });
}

function clickButton(view: RenderResult): HTMLButtonElement {
  const button = view.container.querySelector(
    "[data-vex-polymarket-auto-button]",
  ) as HTMLButtonElement;
  fireEvent.click(button);
  return button;
}

function selectWallet(view: RenderResult, walletId: string): void {
  const radio = view.container.querySelector(
    `[data-vex-polymarket-auto-wallet-radio='${walletId}']`,
  ) as HTMLInputElement;
  fireEvent.click(radio);
}

function ackAndTypeInSudo(view: RenderResult): void {
  const checkbox = view.container.querySelector(
    "[data-vex-polymarket-sudo-ack]",
  ) as HTMLInputElement;
  fireEvent.click(checkbox);
  const input = view.container.querySelector(
    "[data-vex-polymarket-sudo-password]",
  ) as HTMLInputElement;
  fireEvent.input(input, { target: { value: "valid-password-12" } });
  const submit = view.container.querySelector(
    "[data-vex-polymarket-sudo-submit]",
  ) as HTMLButtonElement;
  fireEvent.click(submit);
}

beforeEach(() => {
  mockAutoSetup.mockReset();
  mockListAvailable.mockReset();
  mockConfiguredAddresses.mockReset();
  mockOnSuccess.mockReset();

  // Defaults: two EVM wallets, none configured. Auto-setup fails (wrong pw)
  // unless a test overrides it.
  mockListAvailable.mockResolvedValue({
    ok: true,
    data: { evm: [PRIMARY_WALLET, SECOND_WALLET], solana: [] },
  });
  mockConfiguredAddresses.mockResolvedValue({
    ok: true,
    data: { addresses: [] },
  });
  mockAutoSetup.mockResolvedValue({
    ok: false,
    error: {
      code: "wallet.password_invalid",
      domain: "wallet",
      message: "Wrong.",
      retryable: true,
      userActionable: true,
      redacted: true,
    },
  });

  Object.defineProperty(window, "vex", {
    configurable: true,
    value: {
      onboarding: {
        polymarketAutoSetup: mockAutoSetup,
        polymarketConfiguredAddresses: mockConfiguredAddresses,
      },
      wallets: {
        listAvailable: mockListAvailable,
      },
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "vex");
});

describe("PolymarketAutoSetupSection picker + gates", () => {
  it("disables button when EVM wallet missing + shows helper text", () => {
    const view = renderSection({ evmWalletPresent: false });
    const button = view.container.querySelector(
      "[data-vex-polymarket-auto-button]",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const helper = view.container.querySelector(
      "[data-vex-polymarket-auto-helper]",
    );
    expect(helper?.textContent).toMatch(/EVM wallet required/);
  });

  it("disables button when vault locked + shows helper text", () => {
    const view = renderSection({ vaultUnlocked: false });
    const button = view.container.querySelector(
      "[data-vex-polymarket-auto-button]",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const helper = view.container.querySelector(
      "[data-vex-polymarket-auto-helper]",
    );
    expect(helper?.textContent).toMatch(/Unlock Vex first/);
  });

  it("disables button when `disabled` prop is true", () => {
    const view = renderSection({ disabled: true });
    const button = view.container.querySelector(
      "[data-vex-polymarket-auto-button]",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("lists every EVM wallet with a per-wallet badge; selection defaults to the primary", async () => {
    mockConfiguredAddresses.mockResolvedValue({
      ok: true,
      data: { addresses: [PRIMARY_ADDRESS] },
    });
    const view = renderSection();
    await waitForPicker(view);

    const rows = view.container.querySelectorAll(
      "[data-vex-polymarket-auto-wallet]",
    );
    expect(rows.length).toBe(2);

    // Primary (first EVM) is selected by default.
    const primaryRow = view.container.querySelector(
      `[data-vex-polymarket-auto-wallet='${PRIMARY_WALLET.id}']`,
    );
    expect(
      primaryRow?.getAttribute("data-vex-polymarket-auto-wallet-selected"),
    ).toBe("true");
    // Primary is configured (in the set) → ✓; second wallet → ◦.
    expect(
      primaryRow?.getAttribute("data-vex-polymarket-auto-wallet-configured"),
    ).toBe("true");
    const secondRow = view.container.querySelector(
      `[data-vex-polymarket-auto-wallet='${SECOND_WALLET.id}']`,
    );
    expect(
      secondRow?.getAttribute("data-vex-polymarket-auto-wallet-configured"),
    ).toBe("false");
  });

  it("button label = 'Reconfigure' when the selected (primary) wallet is configured", async () => {
    mockConfiguredAddresses.mockResolvedValue({
      ok: true,
      data: { addresses: [PRIMARY_ADDRESS] },
    });
    const view = renderSection({ status: "configured" });
    await waitForPicker(view);
    await waitFor(() => {
      const button = view.container.querySelector(
        "[data-vex-polymarket-auto-button]",
      ) as HTMLButtonElement;
      expect(button.textContent).toMatch(/Reconfigure Polymarket/);
    });
  });

  it("button label = 'Auto-configure' when the selected wallet is NOT configured", async () => {
    const view = renderSection({ status: "missing" });
    await waitForPicker(view);
    const button = view.container.querySelector(
      "[data-vex-polymarket-auto-button]",
    ) as HTMLButtonElement;
    expect(button.textContent).toMatch(/^Auto-configure Polymarket$/);
  });

  it("button label = partial variant when not configured + status partial", async () => {
    const view = renderSection({ status: "partial" });
    await waitForPicker(view);
    const button = view.container.querySelector(
      "[data-vex-polymarket-auto-button]",
    ) as HTMLButtonElement;
    expect(button.textContent).toMatch(/replaces partial entries/);
  });
});

describe("PolymarketAutoSetupSection modal flow", () => {
  it("NOT-configured selected wallet → skips ConfirmModal, opens SudoModal directly", async () => {
    const view = renderSection({ status: "missing" });
    await waitForPicker(view);
    clickButton(view);
    expect(
      view.container.querySelector("[data-vex-polymarket-confirm='root']"),
    ).toBeNull();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo='root']"),
    ).not.toBeNull();
  });

  it("configured selected wallet → opens ConfirmModal first; confirm opens SudoModal", async () => {
    mockConfiguredAddresses.mockResolvedValue({
      ok: true,
      data: { addresses: [PRIMARY_ADDRESS] },
    });
    const view = renderSection({ status: "configured" });
    await waitForPicker(view);
    // Wait for the per-wallet configured flag to settle the confirm gate.
    await waitFor(() => {
      const button = view.container.querySelector(
        "[data-vex-polymarket-auto-button]",
      ) as HTMLButtonElement;
      expect(
        button.getAttribute("data-vex-polymarket-auto-selected-configured"),
      ).toBe("true");
    });
    clickButton(view);
    expect(
      view.container.querySelector("[data-vex-polymarket-confirm='root']"),
    ).not.toBeNull();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo='root']"),
    ).toBeNull();
    const replace = view.container.querySelector(
      "[data-vex-polymarket-confirm-replace]",
    ) as HTMLButtonElement;
    fireEvent.click(replace);
    expect(
      view.container.querySelector("[data-vex-polymarket-confirm='root']"),
    ).toBeNull();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo='root']"),
    ).not.toBeNull();
  });

  it("ConfirmModal cancel returns to idle (no SudoModal)", async () => {
    mockConfiguredAddresses.mockResolvedValue({
      ok: true,
      data: { addresses: [PRIMARY_ADDRESS] },
    });
    const view = renderSection({ status: "configured" });
    await waitForPicker(view);
    await waitFor(() => {
      const button = view.container.querySelector(
        "[data-vex-polymarket-auto-button]",
      ) as HTMLButtonElement;
      expect(
        button.getAttribute("data-vex-polymarket-auto-selected-configured"),
      ).toBe("true");
    });
    clickButton(view);
    const cancel = view.container.querySelector(
      "[data-vex-polymarket-confirm-cancel]",
    ) as HTMLButtonElement;
    fireEvent.click(cancel);
    expect(
      view.container.querySelector("[data-vex-polymarket-confirm='root']"),
    ).toBeNull();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo='root']"),
    ).toBeNull();
  });

  it("SudoModal success fires onSuccess + threads the PRIMARY walletId into the IPC", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: true,
      data: { configured: true, address: PRIMARY_ADDRESS },
    });
    const view = renderSection({ status: "missing" });
    await waitForPicker(view);
    clickButton(view);
    ackAndTypeInSudo(view);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledTimes(1);
    });
    expect(mockAutoSetup).toHaveBeenCalledWith({
      password: "valid-password-12",
      riskAcknowledged: true,
      overwriteConfirmed: false,
      walletId: PRIMARY_WALLET.id,
    });
  });

  it("selecting a DIFFERENT wallet threads THAT walletId into the IPC", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: true,
      data: { configured: true, address: SECOND_ADDRESS },
    });
    const view = renderSection({ status: "missing" });
    await waitForPicker(view);
    selectWallet(view, SECOND_WALLET.id);
    clickButton(view);
    ackAndTypeInSudo(view);

    await waitFor(() => {
      expect(mockAutoSetup).toHaveBeenCalledWith({
        password: "valid-password-12",
        riskAcknowledged: true,
        overwriteConfirmed: false,
        walletId: SECOND_WALLET.id,
      });
    });
  });

  it("race fallback: risk_confirmation_required → re-opens ConfirmModal", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: false,
      error: {
        code: "wallet.risk_confirmation_required",
        domain: "wallet",
        message: "Need overwrite confirmation.",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });
    const view = renderSection({ status: "missing" });
    await waitForPicker(view);
    clickButton(view);
    ackAndTypeInSudo(view);

    await waitFor(() => {
      expect(
        view.container.querySelector("[data-vex-polymarket-confirm='root']"),
      ).not.toBeNull();
    });
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo='root']"),
    ).toBeNull();
  });

  it("Reconfigure flow passes overwriteConfirmed=true + walletId after confirm", async () => {
    mockConfiguredAddresses.mockResolvedValue({
      ok: true,
      data: { addresses: [PRIMARY_ADDRESS] },
    });
    mockAutoSetup.mockResolvedValue({
      ok: true,
      data: { configured: true, address: PRIMARY_ADDRESS },
    });
    const view = renderSection({ status: "configured" });
    await waitForPicker(view);
    await waitFor(() => {
      const button = view.container.querySelector(
        "[data-vex-polymarket-auto-button]",
      ) as HTMLButtonElement;
      expect(
        button.getAttribute("data-vex-polymarket-auto-selected-configured"),
      ).toBe("true");
    });
    clickButton(view);
    const replace = view.container.querySelector(
      "[data-vex-polymarket-confirm-replace]",
    ) as HTMLButtonElement;
    fireEvent.click(replace);
    ackAndTypeInSudo(view);

    await waitFor(() => {
      expect(mockAutoSetup).toHaveBeenCalledWith({
        password: "valid-password-12",
        riskAcknowledged: true,
        overwriteConfirmed: true,
        walletId: PRIMARY_WALLET.id,
      });
    });
  });
});
