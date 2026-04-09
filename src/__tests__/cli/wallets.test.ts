import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../errors.js";

const createWallet = vi.fn();
const importWallet = vi.fn();
const createSolanaWallet = vi.fn();
const importSolanaWallet = vi.fn();
const getEvmWalletStatus = vi.fn();
const getSolanaWalletStatus = vi.fn();
const confirm = vi.fn();
const promptMenu = vi.fn();
const promptSecret = vi.fn();
const renderWalletStatuses = vi.fn();
const writeStderr = vi.fn();

vi.mock("../../tools/wallet/create.js", () => ({
  createWallet,
}));

vi.mock("../../tools/wallet/import.js", () => ({
  importWallet,
}));

vi.mock("../../tools/wallet/solana-create.js", () => ({
  createSolanaWallet,
}));

vi.mock("../../tools/wallet/solana-import.js", () => ({
  importSolanaWallet,
}));

vi.mock("../../cli/echo/status.js", () => ({
  getEvmWalletStatus,
  getSolanaWalletStatus,
}));

vi.mock("../../cli/echo/ui.js", () => ({
  confirm,
  promptMenu,
  promptSecret,
  renderWalletStatuses,
}));

vi.mock("../../utils/output.js", () => ({
  writeStderr,
}));

const { ensureWallets } = await import("../../cli/echo/wallets.js");

function walletStatus(
  kind: "evm" | "solana",
  status: "configured" | "missing",
  address: string | null,
  hasStoredState: boolean,
  detail: string,
) {
  return { kind, status, address, hasStoredState, detail };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("wallet onboarding flow", () => {
  it("keeps configured wallets without prompting for overwrite", async () => {
    getEvmWalletStatus.mockImplementation(() =>
      walletStatus("evm", "configured", "0x18b467Cb28FC07Ca6E17A964b3319051B3072B79", true, "Ready for local signing."),
    );
    getSolanaWalletStatus.mockImplementation(() =>
      walletStatus("solana", "configured", "7gP4XwQ3vMbJ7fYf9xYgT3V2R9X2QyYpn6yKkq7MZsEg", true, "Ready for local signing."),
    );
    promptMenu.mockResolvedValueOnce("continue");

    await ensureWallets();

    expect(promptMenu).toHaveBeenCalledWith("Wallet actions", expect.any(Array));
    expect(confirm).not.toHaveBeenCalled();
    expect(createWallet).not.toHaveBeenCalled();
    expect(importWallet).not.toHaveBeenCalled();
    expect(createSolanaWallet).not.toHaveBeenCalled();
    expect(importSolanaWallet).not.toHaveBeenCalled();
  });

  it("replaces a configured wallet only through advanced wallet actions", async () => {
    let evmState = walletStatus(
      "evm",
      "configured",
      "0x18b467Cb28FC07Ca6E17A964b3319051B3072B79",
      true,
      "Ready for local signing.",
    );

    getEvmWalletStatus.mockImplementation(() => evmState);
    getSolanaWalletStatus.mockImplementation(() =>
      walletStatus("solana", "configured", "7gP4XwQ3vMbJ7fYf9xYgT3V2R9X2QyYpn6yKkq7MZsEg", true, "Ready for local signing."),
    );
    promptMenu
      .mockResolvedValueOnce("advanced")
      .mockResolvedValueOnce("replace-evm")
      .mockResolvedValueOnce("create")
      .mockResolvedValueOnce("back")
      .mockResolvedValueOnce("continue");
    confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    createWallet.mockImplementation(async ({ force }: { force: boolean }) => {
      evmState = walletStatus("evm", "configured", "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f", true, "Ready for local signing.");
      return { address: evmState.address, force };
    });

    await ensureWallets();

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(createWallet).toHaveBeenCalledWith({ force: true });
  });

  it("requires recovery when stored wallet state exists but is invalid", async () => {
    let evmState = walletStatus(
      "evm",
      "missing",
      "0x18b467Cb28FC07Ca6E17A964b3319051B3072B79",
      true,
      "EVM keystore.json is missing.",
    );

    getEvmWalletStatus.mockImplementation(() => evmState);
    getSolanaWalletStatus.mockImplementation(() =>
      walletStatus("solana", "configured", "7gP4XwQ3vMbJ7fYf9xYgT3V2R9X2QyYpn6yKkq7MZsEg", true, "Ready for local signing."),
    );
    promptMenu.mockResolvedValueOnce("continue").mockResolvedValueOnce("import");
    promptSecret.mockResolvedValueOnce("0xabc123");
    importWallet.mockImplementation(async () => {
      evmState = walletStatus(
        "evm",
        "configured",
        "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f",
        true,
        "Ready for local signing.",
      );
      return { address: evmState.address };
    });

    await ensureWallets();

    expect(confirm).not.toHaveBeenCalled();
    expect(importWallet).toHaveBeenCalledWith("0xabc123", { force: true });
  });

  it("fails when recovery is cancelled for invalid stored wallet state", async () => {
    getEvmWalletStatus.mockImplementation(() =>
      walletStatus("evm", "missing", "0x18b467Cb28FC07Ca6E17A964b3319051B3072B79", true, "EVM keystore.json is missing."),
    );
    getSolanaWalletStatus.mockImplementation(() =>
      walletStatus("solana", "configured", "7gP4XwQ3vMbJ7fYf9xYgT3V2R9X2QyYpn6yKkq7MZsEg", true, "Ready for local signing."),
    );
    promptMenu.mockResolvedValueOnce("continue").mockResolvedValueOnce("cancel");

    await expect(ensureWallets()).rejects.toMatchObject({
      code: ErrorCodes.SETUP_CANCELLED,
    });
  });
});
