import { describe, it, expect, beforeEach, afterEach } from "vitest";

const { getKeystorePassword, requireKeystorePassword } = await import("@utils/env.js");

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
