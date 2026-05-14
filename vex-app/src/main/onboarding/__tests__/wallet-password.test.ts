import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  requireUnlockedMasterPassword: vi.fn(),
}));

vi.mock("../../secrets/session.js", () => ({
  requireUnlockedMasterPassword: sessionMocks.requireUnlockedMasterPassword,
}));

const KEYSTORE_ENV_KEY = "VEX_KEYSTORE_PASSWORD";

const { withFreshKeystorePassword, isPasswordSetupError } = await import(
  "../wallet-password.js"
);

beforeEach(() => {
  sessionMocks.requireUnlockedMasterPassword.mockReset();
  delete process.env[KEYSTORE_ENV_KEY];
});

afterEach(() => {
  delete process.env[KEYSTORE_ENV_KEY];
});

describe("withFreshKeystorePassword", () => {
  it("injects the unlocked in-memory password during the engine call", async () => {
    sessionMocks.requireUnlockedMasterPassword.mockReturnValue({
      ok: true,
      data: "unlocked-password",
    });
    let observed: string | undefined;

    await withFreshKeystorePassword(async (ctx) => {
      observed = process.env[KEYSTORE_ENV_KEY];
      expect(ctx.password).toBe("unlocked-password");
      return "done";
    });

    expect(observed).toBe("unlocked-password");
    expect(process.env[KEYSTORE_ENV_KEY]).toBeUndefined();
  });

  it("deletes process.env in finally even when a prior value existed", async () => {
    process.env[KEYSTORE_ENV_KEY] = "prior-stale-value";
    sessionMocks.requireUnlockedMasterPassword.mockReturnValue({
      ok: true,
      data: "unlocked-password",
    });
    let observedDuring: string | undefined;

    await withFreshKeystorePassword(async () => {
      observedDuring = process.env[KEYSTORE_ENV_KEY];
      return "x";
    });

    expect(observedDuring).toBe("unlocked-password");
    expect(process.env[KEYSTORE_ENV_KEY]).toBeUndefined();
  });

  it("returns the locked-vault error when no password is unlocked", async () => {
    sessionMocks.requireUnlockedMasterPassword.mockReturnValue({
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

    const result = await withFreshKeystorePassword(async () => "x");

    expect(isPasswordSetupError(result)).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.keystore_locked");
  });

  it("deletes process.env in finally when the wrapped function throws", async () => {
    process.env[KEYSTORE_ENV_KEY] = "prior-stale-value";
    sessionMocks.requireUnlockedMasterPassword.mockReturnValue({
      ok: true,
      data: "unlocked-password",
    });

    await expect(
      withFreshKeystorePassword(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);
    expect(process.env[KEYSTORE_ENV_KEY]).toBeUndefined();
  });
});

describe("isPasswordSetupError", () => {
  it("identifies the err envelope shape", () => {
    expect(
      isPasswordSetupError({
        ok: false,
        error: { code: "wallet.keystore_locked" },
      }),
    ).toBe(true);
  });

  it("returns false for ok results and other shapes", () => {
    expect(isPasswordSetupError({ ok: true, data: {} })).toBe(false);
    expect(isPasswordSetupError(null)).toBe(false);
    expect(isPasswordSetupError("error")).toBe(false);
  });
});
