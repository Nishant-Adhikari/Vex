/**
 * PolymarketAutoSetupSection tests — owns the two-modal flow for
 * feature #7.
 *
 * Verifies:
 *  - button enabled state vs evmWalletPresent / vaultUnlocked / disabled,
 *  - button label varies per polymarket status,
 *  - missing/partial click → skips ConfirmModal, opens SudoModal directly,
 *  - configured click → opens ConfirmModal first; confirm → opens SudoModal,
 *  - ConfirmModal cancel → returns to idle (no SudoModal),
 *  - SudoModal success → onSuccess callback fires,
 *  - SudoModal race fallback → re-opens ConfirmModal.
 *
 * `window.vex.onboarding.polymarketAutoSetup` is mocked on the global
 * window so the SudoModal can drive its branches end-to-end without a
 * preload bridge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Result } from "@shared/ipc/result.js";
import type { PolymarketStatus } from "@shared/schemas/api-keys.js";

interface PolymarketAutoSetupInput {
  readonly password: string;
  readonly riskAcknowledged: true;
  readonly overwriteConfirmed: boolean;
}

interface PolymarketAutoSetupResultShape {
  readonly configured: true;
  readonly address: string;
}

const mockAutoSetup = vi.fn<
  (input: PolymarketAutoSetupInput) => Promise<Result<PolymarketAutoSetupResultShape>>
>();
const mockOnSuccess = vi.fn();

const { PolymarketAutoSetupSection } = await import(
  "../PolymarketAutoSetupSection.js"
);

const EVM_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

function renderSection(
  props?: Partial<{
    status: PolymarketStatus;
    evmWalletPresent: boolean;
    vaultUnlocked: boolean;
    disabled: boolean;
    onSuccess: typeof mockOnSuccess;
  }>,
): ReturnType<typeof render> {
  return render(
    <PolymarketAutoSetupSection
      status={props?.status ?? "missing"}
      evmWalletPresent={props?.evmWalletPresent ?? true}
      vaultUnlocked={props?.vaultUnlocked ?? true}
      disabled={props?.disabled ?? false}
      onSuccess={props?.onSuccess ?? mockOnSuccess}
    />,
  );
}

function clickButton(view: ReturnType<typeof render>): HTMLButtonElement {
  const button = view.container.querySelector(
    "[data-vex-polymarket-auto-button]",
  ) as HTMLButtonElement;
  fireEvent.click(button);
  return button;
}

function ackAndTypeInSudo(view: ReturnType<typeof render>): void {
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
  mockOnSuccess.mockReset();
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
      },
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "vex");
});

describe("PolymarketAutoSetupSection", () => {
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

  it("button label varies per status: missing", () => {
    const view = renderSection({ status: "missing" });
    const button = view.container.querySelector(
      "[data-vex-polymarket-auto-button]",
    ) as HTMLButtonElement;
    expect(button.textContent).toMatch(/^Auto-configure Polymarket$/);
  });

  it("button label varies per status: partial", () => {
    const view = renderSection({ status: "partial" });
    const button = view.container.querySelector(
      "[data-vex-polymarket-auto-button]",
    ) as HTMLButtonElement;
    expect(button.textContent).toMatch(/replaces partial entries/);
  });

  it("button label varies per status: configured", () => {
    const view = renderSection({ status: "configured" });
    const button = view.container.querySelector(
      "[data-vex-polymarket-auto-button]",
    ) as HTMLButtonElement;
    expect(button.textContent).toMatch(/Reconfigure Polymarket/);
  });

  it("status=missing click → skips ConfirmModal, opens SudoModal directly", () => {
    const view = renderSection({ status: "missing" });
    clickButton(view);
    expect(
      view.container.querySelector("[data-vex-polymarket-confirm='root']"),
    ).toBeNull();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo='root']"),
    ).not.toBeNull();
  });

  it("status=partial click → skips ConfirmModal, opens SudoModal directly", () => {
    const view = renderSection({ status: "partial" });
    clickButton(view);
    expect(
      view.container.querySelector("[data-vex-polymarket-confirm='root']"),
    ).toBeNull();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo='root']"),
    ).not.toBeNull();
  });

  it("status=configured click → opens ConfirmModal first; confirm opens SudoModal", () => {
    const view = renderSection({ status: "configured" });
    clickButton(view);
    expect(
      view.container.querySelector("[data-vex-polymarket-confirm='root']"),
    ).not.toBeNull();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo='root']"),
    ).toBeNull();
    // Accept overwrite — the SudoModal should now appear.
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

  it("ConfirmModal cancel returns to idle (no SudoModal)", () => {
    const view = renderSection({ status: "configured" });
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

  it("SudoModal success fires onSuccess callback", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: true,
      data: { configured: true, address: EVM_ADDRESS },
    });
    const view = renderSection({ status: "missing" });
    clickButton(view);
    ackAndTypeInSudo(view);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledTimes(1);
    });
    expect(mockAutoSetup).toHaveBeenCalledWith({
      password: "valid-password-12",
      riskAcknowledged: true,
      overwriteConfirmed: false,
    });
  });

  it("SudoModal race fallback: risk_confirmation_required → re-opens ConfirmModal", async () => {
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
    clickButton(view);
    ackAndTypeInSudo(view);

    await waitFor(() => {
      expect(
        view.container.querySelector("[data-vex-polymarket-confirm='root']"),
      ).not.toBeNull();
    });
    // SudoModal is gone because the parent phase transitioned from
    // "submitting" → "confirming" via onRiskConfirmationRequired; the
    // sudo branch only renders while phase === "submitting".
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo='root']"),
    ).toBeNull();
  });

  it("Reconfigure flow passes overwriteConfirmed=true to IPC after confirm", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: true,
      data: { configured: true, address: EVM_ADDRESS },
    });
    const view = renderSection({ status: "configured" });
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
      });
    });
  });
});
