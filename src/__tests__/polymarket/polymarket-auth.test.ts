import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { signClobRequest, buildClobHeaders, requirePolyClobCredentials, hasPolyClobCredentials } from "@tools/polymarket/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";

describe("signClobRequest", () => {
  it("returns timestamp and base64 signature", () => {
    const { timestamp, signature } = signClobRequest("GET", "/orders", "", "test-secret");
    expect(timestamp).toMatch(/^\d+$/);
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe("string");
  });

  it("produces different signatures for different methods", () => {
    const get = signClobRequest("GET", "/orders", "", "secret");
    const post = signClobRequest("POST", "/orders", '{"a":1}', "secret");
    expect(get.signature).not.toBe(post.signature);
  });

  it("produces different signatures for different paths", () => {
    const a = signClobRequest("GET", "/orders", "", "secret");
    const b = signClobRequest("GET", "/trades", "", "secret");
    expect(a.signature).not.toBe(b.signature);
  });

  it("produces different signatures for different secrets", () => {
    const a = signClobRequest("GET", "/orders", "", "secret1");
    const b = signClobRequest("GET", "/orders", "", "secret2");
    expect(a.signature).not.toBe(b.signature);
  });

  it("includes body in signature", () => {
    const noBody = signClobRequest("POST", "/order", "", "secret");
    const withBody = signClobRequest("POST", "/order", '{"side":"BUY"}', "secret");
    expect(noBody.signature).not.toBe(withBody.signature);
  });
});

describe("buildClobHeaders", () => {
  it("returns all 5 required headers", () => {
    const headers = buildClobHeaders("key-123", "0xaddr", "pass", "GET", "/orders", "", "secret");
    expect(headers.POLY_API_KEY).toBe("key-123");
    expect(headers.POLY_ADDRESS).toBe("0xaddr");
    expect(headers.POLY_PASSPHRASE).toBe("pass");
    expect(headers.POLY_TIMESTAMP).toMatch(/^\d+$/);
    expect(headers.POLY_SIGNATURE).toBeTruthy();
  });
});

describe("requirePolyClobCredentials", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws POLYMARKET_NOT_CONFIGURED when env vars missing", () => {
    delete process.env.POLYMARKET_API_KEY;
    delete process.env.POLYMARKET_API_SECRET;
    delete process.env.POLYMARKET_PASSPHRASE;
    expect(() => requirePolyClobCredentials()).toThrow(EchoError);
    expect(() => requirePolyClobCredentials()).toThrow(/not configured/);
  });

  it("throws when only partial env vars set", () => {
    process.env.POLYMARKET_API_KEY = "key";
    delete process.env.POLYMARKET_API_SECRET;
    delete process.env.POLYMARKET_PASSPHRASE;
    expect(() => requirePolyClobCredentials()).toThrow(EchoError);
  });

  it("returns credentials when all env vars set", () => {
    process.env.POLYMARKET_API_KEY = "key";
    process.env.POLYMARKET_API_SECRET = "secret";
    process.env.POLYMARKET_PASSPHRASE = "pass";
    const creds = requirePolyClobCredentials();
    expect(creds.apiKey).toBe("key");
    expect(creds.apiSecret).toBe("secret");
    expect(creds.passphrase).toBe("pass");
  });
});

describe("hasPolyClobCredentials", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns false when missing", () => {
    delete process.env.POLYMARKET_API_KEY;
    expect(hasPolyClobCredentials()).toBe(false);
  });

  it("returns true when all set", () => {
    process.env.POLYMARKET_API_KEY = "key";
    process.env.POLYMARKET_API_SECRET = "secret";
    process.env.POLYMARKET_PASSPHRASE = "pass";
    expect(hasPolyClobCredentials()).toBe(true);
  });
});
