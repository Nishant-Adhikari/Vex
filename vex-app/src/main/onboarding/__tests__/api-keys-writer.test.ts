import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  writeUnlockedSecrets: vi.fn(),
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../secrets/session.js", () => ({
  writeUnlockedSecrets: sessionMocks.writeUnlockedSecrets,
}));

const { writeApiKeys } = await import("../api-keys-writer.js");

describe("writeApiKeys", () => {
  beforeEach(() => {
    sessionMocks.writeUnlockedSecrets.mockReset();
    sessionMocks.writeUnlockedSecrets.mockReturnValue({ ok: true, data: undefined });
  });

  it("returns empty fieldsWritten when nothing is submitted", async () => {
    const result = await writeApiKeys({});
    expect(result).toEqual({ ok: true, data: { fieldsWritten: [] } });
    expect(sessionMocks.writeUnlockedSecrets).not.toHaveBeenCalled();
  });

  it("stores JUPITER_API_KEY in the encrypted vault", async () => {
    const result = await writeApiKeys({ jupiterApiKey: "sk-jup-xyz" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.fieldsWritten).toEqual(["JUPITER_API_KEY"]);
    expect(sessionMocks.writeUnlockedSecrets).toHaveBeenCalledWith({
      JUPITER_API_KEY: "sk-jup-xyz",
    });
  });

  it("stores the Polymarket trio together when present", async () => {
    const result = await writeApiKeys({
      polymarket: {
        apiKey: "p-key",
        apiSecret: "p-secret",
        passphrase: "p-pass",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fieldsWritten).toEqual([
        "POLYMARKET_API_KEY",
        "POLYMARKET_API_SECRET",
        "POLYMARKET_PASSPHRASE",
      ]);
    }
    expect(sessionMocks.writeUnlockedSecrets).toHaveBeenCalledWith({
      POLYMARKET_API_KEY: "p-key",
      POLYMARKET_API_SECRET: "p-secret",
      POLYMARKET_PASSPHRASE: "p-pass",
    });
  });

  it("returns fieldsWritten in canonical order", async () => {
    const result = await writeApiKeys({
      rettiwtApiKey: "r",
      tavilyApiKey: "t",
      jupiterApiKey: "j",
      polymarket: { apiKey: "pk", apiSecret: "ps", passphrase: "pp" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fieldsWritten).toEqual([
        "JUPITER_API_KEY",
        "TAVILY_API_KEY",
        "RETTIWT_API_KEY",
        "POLYMARKET_API_KEY",
        "POLYMARKET_API_SECRET",
        "POLYMARKET_PASSPHRASE",
      ]);
    }
  });

  it("rejects a malformed Polymarket trio before writing", async () => {
    const result = await writeApiKeys({
      polymarket: { apiKey: "k", apiSecret: "", passphrase: "p" } as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation.invalid_input");
    expect(sessionMocks.writeUnlockedSecrets).not.toHaveBeenCalled();
  });

  it("returns the locked-vault error from the secret session", async () => {
    sessionMocks.writeUnlockedSecrets.mockReturnValue({
      ok: false,
      error: {
        code: "wallet.keystore_locked",
        domain: "wallet",
        message: "Unlock Vex first.",
        retryable: false,
        userActionable: true,
        redacted: true,
      },
    });

    const result = await writeApiKeys({ jupiterApiKey: "j" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.keystore_locked");
  });
});
