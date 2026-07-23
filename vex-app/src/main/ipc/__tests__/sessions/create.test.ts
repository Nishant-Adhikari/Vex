/**
 * vex.sessions.create — mission default primary-EVM-wallet behavior.
 *
 * A MISSION session created with NO explicit EVM selection must bind to the
 * operator's PRIMARY trading wallet so the host never has to pick a wallet
 * each time (Mission Presets tab + normal new-mission flow both send
 * selectedEvmWalletId: null). The default:
 *   - fills in ONLY when nothing was selected — never overrides an explicit id;
 *   - never lands on a vault (hold-only) wallet — falls back to null;
 *   - applies to MISSION mode only — agent sessions stay wallet-less by intent.
 *
 * We stub `registerHandler` to capture the handler config, then invoke
 * `handle()` directly with a mocked `createSession` so we can assert the exact
 * `{ evm, solana }` refs handed to the DB layer. Inventory is mocked via
 * `@vex-lib/wallet.js` (getWalletById / getPrimaryEvmEntry), the same seam the
 * real `_wallet-refs.js` reads through.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandlerArgs, HandlerContext } from "../../register-handler.js";
import type { SessionCreateInput } from "@shared/schemas/sessions.js";

/** The operator's PRIMARY trading wallet (config wallet.evm[0], legacy). */
const PRIMARY_ADDR = "0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f";

const mockGetWalletById = vi.fn();
const mockGetPrimaryEvmEntry = vi.fn();
vi.mock("@vex-lib/wallet.js", () => ({
  getWalletById: (...a: unknown[]) => mockGetWalletById(...a),
  getPrimaryEvmEntry: (...a: unknown[]) => mockGetPrimaryEvmEntry(...a),
}));

const mockCreateSession = vi.fn();
vi.mock("../../../database/sessions-db.js", () => ({
  createSession: (...a: unknown[]) => mockCreateSession(...a),
}));

vi.mock("../../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Capture the handler config instead of registering on ipcMain.
let captured: HandlerArgs<SessionCreateInput, unknown> | null = null;
vi.mock("../../register-handler.js", () => ({
  registerHandler: (args: HandlerArgs<SessionCreateInput, unknown>) => {
    captured = args;
    return () => {};
  },
}));

const { registerSessionsCreateHandler } = await import("../../sessions/create.js");

const CTX: HandlerContext = { requestId: "corr-create-1" } as HandlerContext;

function baseInput(over: Partial<SessionCreateInput> = {}): SessionCreateInput {
  return {
    mode: "mission",
    name: "Mission A",
    permission: "restricted",
    selectedEvmWalletId: null,
    selectedSolanaWalletId: null,
    ...over,
  } as SessionCreateInput;
}

/** Invoke the captured handler and return the walletRefs passed to createSession. */
async function walletRefsFor(input: SessionCreateInput) {
  registerSessionsCreateHandler();
  if (!captured) throw new Error("handler not captured");
  await captured.handle(input, CTX);
  expect(mockCreateSession).toHaveBeenCalledTimes(1);
  const call = mockCreateSession.mock.calls[0];
  if (!call) throw new Error("createSession was not called");
  return call[1] as {
    evm: { id: string; address: string } | null;
    solana: { id: string; address: string } | null;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  captured = null;
  mockGetWalletById.mockReturnValue(null);
  mockGetPrimaryEvmEntry.mockReturnValue(null);
  mockCreateSession.mockResolvedValue({
    ok: true,
    data: { mode: "mission", permission: "restricted" },
  });
});

describe("sessions.create — mission default primary EVM wallet", () => {
  it("mission + no EVM selection → binds to the PRIMARY wallet ({id,address} of 0x9ed2…)", async () => {
    mockGetPrimaryEvmEntry.mockReturnValue({
      id: "evm_legacy",
      address: PRIMARY_ADDR,
      label: "Primary",
      createdAt: "",
      legacy: true,
      vault: false,
    });
    const refs = await walletRefsFor(baseInput({ selectedEvmWalletId: null }));
    expect(refs.evm).toEqual({ id: "evm_legacy", address: PRIMARY_ADDR });
  });

  it("explicit EVM selection is honored and NOT overridden by the primary default", async () => {
    mockGetWalletById.mockImplementation((family: string, id: string) =>
      family === "evm" && id === "evm_pick"
        ? { id: "evm_pick", address: "0xPick", label: "Picked", createdAt: "" }
        : null,
    );
    mockGetPrimaryEvmEntry.mockReturnValue({
      id: "evm_legacy",
      address: PRIMARY_ADDR,
      vault: false,
    });
    const refs = await walletRefsFor(baseInput({ selectedEvmWalletId: "evm_pick" }));
    expect(refs.evm).toEqual({ id: "evm_pick", address: "0xPick" });
    // Explicit selection short-circuits the default lookup entirely.
    expect(mockGetPrimaryEvmEntry).not.toHaveBeenCalled();
  });

  it("never defaults onto a VAULT primary — falls back to null", async () => {
    mockGetPrimaryEvmEntry.mockReturnValue({
      id: "evm_vault",
      address: "0xVault",
      vault: true,
    });
    const refs = await walletRefsFor(baseInput({ selectedEvmWalletId: null }));
    expect(refs.evm).toBeNull();
  });

  it("no primary in inventory → leaves EVM null (no crash)", async () => {
    mockGetPrimaryEvmEntry.mockReturnValue(null);
    const refs = await walletRefsFor(baseInput({ selectedEvmWalletId: null }));
    expect(refs.evm).toBeNull();
  });

  it("agent mode + no selection → NO wallet forced (default is mission-only)", async () => {
    mockGetPrimaryEvmEntry.mockReturnValue({
      id: "evm_legacy",
      address: PRIMARY_ADDR,
      vault: false,
    });
    const refs = await walletRefsFor(
      baseInput({ mode: "agent", selectedEvmWalletId: null }),
    );
    expect(refs.evm).toBeNull();
    expect(mockGetPrimaryEvmEntry).not.toHaveBeenCalled();
  });

  it("Solana is left null — the mission default is EVM-only", async () => {
    mockGetPrimaryEvmEntry.mockReturnValue({
      id: "evm_legacy",
      address: PRIMARY_ADDR,
      vault: false,
    });
    const refs = await walletRefsFor(baseInput({ selectedSolanaWalletId: null }));
    expect(refs.solana).toBeNull();
  });
});
