/**
 * Tests for the M8 fresh-password helper (codex turn 8 RED #3, codex
 * turn 9 STILL-OPEN coverage + restore-in-finally).
 *
 * Verifies:
 *  - Reads VEX_KEYSTORE_PASSWORD freshly from CONFIG_DIR/.env on each call
 *    (overrides whatever process.env held).
 *  - Restores the previous process.env value in `finally`, including
 *    `delete` when previousEnv was undefined.
 *  - Returns err({code:"wallet.password_invalid"}) when the file value
 *    is missing or empty.
 *  - Restoration runs even when the wrapped fn throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadDotenvFileValue = vi.fn();

vi.mock("@vex-lib/dotenv.js", () => ({
  readDotenvFileValue: (key: string, path: string) =>
    mockReadDotenvFileValue(key, path),
}));

vi.mock("../../paths/config-dir.js", () => ({
  ENV_FILE: "/fake/.env",
}));

const KEYSTORE_ENV_KEY = "VEX_KEYSTORE_PASSWORD";

const { withFreshKeystorePassword, isPasswordSetupError } = await import(
  "../wallet-password.js"
);

beforeEach(() => {
  mockReadDotenvFileValue.mockReset();
  delete process.env[KEYSTORE_ENV_KEY];
});

afterEach(() => {
  delete process.env[KEYSTORE_ENV_KEY];
});

describe("withFreshKeystorePassword", () => {
  it("forces process.env to the file value during fn execution", async () => {
    mockReadDotenvFileValue.mockReturnValue("file-password");
    let observed: string | undefined;
    await withFreshKeystorePassword(async (ctx) => {
      observed = process.env[KEYSTORE_ENV_KEY];
      expect(ctx.password).toBe("file-password");
      return "done";
    });
    expect(observed).toBe("file-password");
  });

  it("deletes process.env in finally when previously undefined", async () => {
    mockReadDotenvFileValue.mockReturnValue("file-password");
    expect(process.env[KEYSTORE_ENV_KEY]).toBeUndefined();
    await withFreshKeystorePassword(async () => "x");
    expect(process.env[KEYSTORE_ENV_KEY]).toBeUndefined();
  });

  it("deletes process.env in finally even when a prior value existed (no stale-cache restore)", async () => {
    // Codex turn 10 NEEDS-WORK: restoring `previousEnv` would re-
    // introduce the stale-cache bug we're trying to fix. Confirm
    // delete-always semantics so subsequent engine helpers fall
    // through to the fresh-file read path.
    process.env[KEYSTORE_ENV_KEY] = "prior-stale-value";
    mockReadDotenvFileValue.mockReturnValue("file-password");
    let observedDuring: string | undefined;
    await withFreshKeystorePassword(async () => {
      observedDuring = process.env[KEYSTORE_ENV_KEY];
      return "x";
    });
    expect(observedDuring).toBe("file-password");
    expect(process.env[KEYSTORE_ENV_KEY]).toBeUndefined();
  });

  it("returns err(wallet.password_invalid) when file value missing", async () => {
    mockReadDotenvFileValue.mockReturnValue(null);
    const result = (await withFreshKeystorePassword(async () => "x")) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(isPasswordSetupError(result)).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("wallet.password_invalid");
  });

  it("returns err(wallet.password_invalid) when file value is empty string", async () => {
    mockReadDotenvFileValue.mockReturnValue("");
    const result = (await withFreshKeystorePassword(async () => "x")) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(isPasswordSetupError(result)).toBe(true);
    expect(result.error?.code).toBe("wallet.password_invalid");
  });

  it("deletes process.env in finally even when the wrapped fn throws", async () => {
    process.env[KEYSTORE_ENV_KEY] = "prior-stale-value";
    mockReadDotenvFileValue.mockReturnValue("file-password");
    await expect(
      withFreshKeystorePassword(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow(/boom/);
    expect(process.env[KEYSTORE_ENV_KEY]).toBeUndefined();
  });

  it("treats readDotenvFileValue throw as missing password", async () => {
    mockReadDotenvFileValue.mockImplementation(() => {
      throw new Error("EACCES");
    });
    const result = (await withFreshKeystorePassword(async () => "x")) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(isPasswordSetupError(result)).toBe(true);
    expect(result.error?.code).toBe("wallet.password_invalid");
  });
});

describe("isPasswordSetupError", () => {
  it("identifies the err envelope shape", () => {
    expect(
      isPasswordSetupError({
        ok: false,
        error: { code: "wallet.password_invalid" },
      })
    ).toBe(true);
  });

  it("returns false for ok results and other shapes", () => {
    expect(isPasswordSetupError({ ok: true, data: {} })).toBe(false);
    expect(isPasswordSetupError(null)).toBe(false);
    expect(isPasswordSetupError("error")).toBe(false);
  });
});
