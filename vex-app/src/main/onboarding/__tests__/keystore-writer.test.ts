import { describe, expect, it, vi, beforeEach } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  initializeMasterPassword: vi.fn(),
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../secrets/session.js", () => ({
  initializeMasterPassword: sessionMocks.initializeMasterPassword,
}));

const { setKeystorePassword } = await import("../keystore-writer.js");

describe("setKeystorePassword", () => {
  beforeEach(() => {
    sessionMocks.initializeMasterPassword.mockReset();
  });

  it("creates or unlocks the encrypted vault through the secret session", async () => {
    sessionMocks.initializeMasterPassword.mockReturnValue({
      ok: true,
      data: { kind: "set" },
    });

    const result = await setKeystorePassword("correct horse 8c");

    expect(result).toEqual({ ok: true, data: { kind: "set" } });
    expect(sessionMocks.initializeMasterPassword).toHaveBeenCalledWith(
      "correct horse 8c",
    );
  });

  it("propagates an unchanged result from the vault session", async () => {
    sessionMocks.initializeMasterPassword.mockReturnValue({
      ok: true,
      data: { kind: "unchanged" },
    });

    const result = await setKeystorePassword("same-password");

    expect(result).toEqual({ ok: true, data: { kind: "unchanged" } });
  });

  it("returns a safe error when the vault cannot be initialized", async () => {
    sessionMocks.initializeMasterPassword.mockReturnValue({
      ok: false,
      error: {
        code: "onboarding.env_persist_failed",
        domain: "onboarding",
        message: "Could not access the encrypted secret vault.",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });

    const result = await setKeystorePassword("password");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("onboarding.env_persist_failed");
  });
});
