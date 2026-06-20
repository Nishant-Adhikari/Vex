import { describe, it, expect, beforeEach, afterEach } from "vitest";

const {
  getKeystorePassword,
  requireKeystorePassword,
  setKeystorePasswordProvider,
  clearKeystorePasswordProvider,
} = await import("@utils/env.js");

const ENV_KEY = "VEX_KEYSTORE_PASSWORD";

describe("getKeystorePassword", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns a valid process.env value", () => {
    process.env[ENV_KEY] = "my-password";
    expect(getKeystorePassword()).toBe("my-password");
  });

  it("treats empty string env as missing", () => {
    process.env[ENV_KEY] = "";
    expect(getKeystorePassword()).toBeNull();
  });

  it('treats literal "undefined" env as missing', () => {
    process.env[ENV_KEY] = "undefined";
    expect(getKeystorePassword()).toBeNull();
  });

  it("returns null when no unlocked password exists in process.env", () => {
    expect(getKeystorePassword()).toBeNull();
  });
});

describe("requireKeystorePassword", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns password when available", () => {
    process.env[ENV_KEY] = "valid-password";
    expect(requireKeystorePassword()).toBe("valid-password");
  });

  it("throws KEYSTORE_PASSWORD_NOT_SET when no password is loaded", () => {
    expect(() => requireKeystorePassword()).toThrow("VEX_KEYSTORE_PASSWORD");
  });
});

describe("keystore password provider (desktop unlock chokepoint)", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
    clearKeystorePasswordProvider();
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
    clearKeystorePasswordProvider();
  });

  it("supplies the password when process.env is unset (desktop after unlock)", () => {
    setKeystorePasswordProvider(() => "live-unlocked-pw");
    expect(getKeystorePassword()).toBe("live-unlocked-pw");
    expect(requireKeystorePassword()).toBe("live-unlocked-pw");
  });

  it("takes precedence over process.env", () => {
    process.env[ENV_KEY] = "env-pw";
    setKeystorePasswordProvider(() => "provider-pw");
    expect(getKeystorePassword()).toBe("provider-pw");
  });

  it("falls back to process.env when the provider returns null (locked)", () => {
    process.env[ENV_KEY] = "env-pw";
    setKeystorePasswordProvider(() => null);
    expect(getKeystorePassword()).toBe("env-pw");
  });

  it("fails closed when the provider returns null AND env is unset", () => {
    setKeystorePasswordProvider(() => null);
    expect(getKeystorePassword()).toBeNull();
    expect(() => requireKeystorePassword()).toThrow("VEX_KEYSTORE_PASSWORD");
  });

  it("ignores empty/sentinel provider values and falls back to env", () => {
    process.env[ENV_KEY] = "env-pw";
    setKeystorePasswordProvider(() => "");
    expect(getKeystorePassword()).toBe("env-pw");
    setKeystorePasswordProvider(() => "undefined");
    expect(getKeystorePassword()).toBe("env-pw");
  });

  it("reads the provider LIVE each call (a relock revokes signing without re-registration)", () => {
    let live: string | null = "first";
    setKeystorePasswordProvider(() => live);
    expect(getKeystorePassword()).toBe("first");
    live = null; // simulate relock nulling unlockedMasterPassword
    expect(getKeystorePassword()).toBeNull();
    expect(() => requireKeystorePassword()).toThrow("VEX_KEYSTORE_PASSWORD");
  });

  it("clearKeystorePasswordProvider reverts to env-only resolution", () => {
    setKeystorePasswordProvider(() => "provider-pw");
    expect(getKeystorePassword()).toBe("provider-pw");
    clearKeystorePasswordProvider();
    expect(getKeystorePassword()).toBeNull();
    process.env[ENV_KEY] = "env-pw";
    expect(getKeystorePassword()).toBe("env-pw");
  });
});
