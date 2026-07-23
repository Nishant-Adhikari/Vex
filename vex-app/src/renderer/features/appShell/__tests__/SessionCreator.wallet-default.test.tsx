/**
 * SessionCreator — mission wallet default. The New-mission composer must
 * pre-select the operator's PRIMARY EVM wallet (first non-vault EVM in the
 * inventory) so creating a mission is one-click, matching the backend default
 * (#41). Agent sessions stay wallet-optional (None), an explicit user pick is
 * never overridden, and a missing/vault-only inventory leaves the field null.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "@shared/ipc/result.js";
import type {
  SessionCreateInput,
  SessionList,
  SessionListItem,
} from "@shared/schemas/sessions.js";
import type { AvailableWalletsDto } from "@shared/schemas/wallets.js";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));
vi.mock("@hugeicons/core-free-icons", () => ({
  ArrowDown01Icon: "ArrowDown01Icon",
}));
vi.mock("@thesvg/react", () => ({
  Ethereum: () => null,
  Solana: () => null,
}));

const { SessionCreator } = await import("../SessionCreator.js");
const { useUiStore } = await import("../../../stores/uiStore.js");

const sessionsListMock = vi.fn<() => Promise<Result<SessionList>>>();
const sessionsCreateMock = vi.fn<
  (input: SessionCreateInput) => Promise<Result<SessionListItem>>
>();
const walletsListAvailableMock = vi.fn<
  () => Promise<Result<AvailableWalletsDto>>
>();

const PRIMARY_EVM = {
  id: "evm-primary",
  family: "evm" as const,
  address: "0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f",
  label: "Primary",
  vault: false,
};
const SECONDARY_EVM = {
  id: "evm-secondary",
  family: "evm" as const,
  address: "0x384cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  label: "Secondary",
  vault: false,
};
const VAULT_EVM = {
  id: "evm-vault",
  family: "evm" as const,
  address: "0xVAULT000000000000000000000000000000000000",
  label: "Vault",
  vault: true,
};

function inventory(
  evm: AvailableWalletsDto["evm"],
): Result<AvailableWalletsDto> {
  return { ok: true, data: { evm, solana: [] } };
}

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
    show?: () => void;
  };
  proto.showModal ??= function (this: HTMLDialogElement): void {
    this.setAttribute("open", "");
  };
  proto.close ??= function (this: HTMLDialogElement): void {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  proto.show ??= function (this: HTMLDialogElement): void {
    this.setAttribute("open", "");
  };
});

beforeEach(() => {
  sessionsListMock.mockReset();
  sessionsCreateMock.mockReset();
  walletsListAvailableMock.mockReset();
  sessionsListMock.mockResolvedValue({ ok: true, data: [] });
  sessionsCreateMock.mockImplementation(async (input) => ({
    ok: true,
    data: {
      id: "11111111-1111-4111-8111-111111111111",
      mode: input.mode,
      permission: input.permission,
      title: input.name,
      initialGoal: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      missionStatus: null,
      pinnedAt: null,
    },
  }));
  walletsListAvailableMock.mockResolvedValue(
    inventory([PRIMARY_EVM, SECONDARY_EVM, VAULT_EVM]),
  );
  useUiStore.setState({
    sessionModeFilter: "all",
    createSessionInitialMessage: null,
    activeSessionId: null,
  });
  Object.defineProperty(window, "vex", {
    configurable: true,
    value: {
      sessions: { list: sessionsListMock, create: sessionsCreateMock },
      wallets: { listAvailable: walletsListAvailableMock },
    },
  });
});

function renderCreator(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SessionCreator open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  return client;
}

function evmCombobox(): HTMLElement {
  // WalletSelect renders a SelectMenu whose accessible name is "EVM wallet".
  return screen.getByRole("combobox", { name: "EVM wallet" });
}

async function selectMission(): Promise<void> {
  fireEvent.click(await screen.findByRole("radio", { name: /Mission/i }));
}

describe("SessionCreator mission wallet default", () => {
  it("pre-selects the primary (first non-vault) EVM wallet in mission mode", async () => {
    renderCreator();
    await selectMission();
    await waitFor(() =>
      expect(evmCombobox().textContent).toContain("Primary"),
    );
    // And the create payload carries the primary id, not null.
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(sessionsCreateMock).toHaveBeenCalledTimes(1));
    expect(sessionsCreateMock.mock.calls[0]![0]).toMatchObject({
      mode: "mission",
      selectedEvmWalletId: "evm-primary",
    });
  });

  it("does not force a wallet in agent mode (stays None)", async () => {
    renderCreator();
    // Agent is the default mode; wait for the inventory to load then confirm None.
    await waitFor(() => expect(walletsListAvailableMock).toHaveBeenCalled());
    await waitFor(() => expect(evmCombobox().textContent).toContain("None"));
  });

  it("does not override an explicit user choice of None in mission mode", async () => {
    renderCreator();
    await selectMission();
    await waitFor(() => expect(evmCombobox().textContent).toContain("Primary"));

    // Open the EVM menu and pick "None" explicitly.
    fireEvent.click(evmCombobox());
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByRole("option", { name: "None" }));

    await waitFor(() => expect(evmCombobox().textContent).toContain("None"));
    // The default must not re-apply and clobber the explicit None.
    await new Promise((r) => setTimeout(r, 0));
    expect(evmCombobox().textContent).toContain("None");
  });

  it("stays null when there is no non-vault EVM wallet (vault-only inventory)", async () => {
    walletsListAvailableMock.mockResolvedValue(inventory([VAULT_EVM]));
    renderCreator();
    await selectMission();
    await waitFor(() => expect(walletsListAvailableMock).toHaveBeenCalled());
    await waitFor(() => expect(evmCombobox().textContent).toContain("None"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(sessionsCreateMock).toHaveBeenCalledTimes(1));
    expect(sessionsCreateMock.mock.calls[0]![0]).toMatchObject({
      selectedEvmWalletId: null,
    });
  });
});
