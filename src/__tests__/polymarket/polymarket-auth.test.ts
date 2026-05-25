import { describe, it, expect, afterEach, vi } from "vitest";
import { VexError, ErrorCodes } from "../../errors.js";

// Control the primary-EVM-address read so the legacy (primary-only) fallback is
// deterministic without a real wallet config on disk.
const inv = vi.hoisted(() => ({ primaryAddress: null as string | null }));
vi.mock("@tools/wallet/inventory.js", () => ({
  getPrimaryEvmAddress: () => inv.primaryAddress,
}));

const { signClobRequest, buildClobHeaders, requirePolyClobCredentials, hasPolyClobCredentials } =
  await import("@tools/polymarket/auth.js");

const MAP_KEY = "POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS";
const ADDR_PRIMARY = `0x${"11".repeat(20)}`;
const ADDR_SESSION = `0x${"22".repeat(20)}`;
const MAP_CREDS = { apiKey: "ak-map", apiSecret: "as-map", passphrase: "pp-map" };

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

  function clearAll(): void {
    delete process.env[MAP_KEY];
    delete process.env.POLYMARKET_API_KEY;
    delete process.env.POLYMARKET_API_SECRET;
    delete process.env.POLYMARKET_PASSPHRASE;
  }

  afterEach(() => {
    process.env = { ...originalEnv };
    inv.primaryAddress = null;
  });

  it("returns the wallet's creds from the per-address map", () => {
    clearAll();
    process.env[MAP_KEY] = JSON.stringify({ [ADDR_SESSION]: MAP_CREDS });
    expect(requirePolyClobCredentials(ADDR_SESSION)).toEqual(MAP_CREDS);
  });

  it("selects the correct wallet from a multi-entry map", () => {
    clearAll();
    const other = { apiKey: "ak-x", apiSecret: "as-x", passphrase: "pp-x" };
    process.env[MAP_KEY] = JSON.stringify({ [ADDR_PRIMARY]: other, [ADDR_SESSION]: MAP_CREDS });
    expect(requirePolyClobCredentials(ADDR_SESSION)).toEqual(MAP_CREDS);
  });

  it("legacy fallback returns the fixed env keys for the PRIMARY wallet only", () => {
    clearAll();
    inv.primaryAddress = ADDR_PRIMARY;
    process.env.POLYMARKET_API_KEY = "k";
    process.env.POLYMARKET_API_SECRET = "s";
    process.env.POLYMARKET_PASSPHRASE = "p";
    expect(requirePolyClobCredentials(ADDR_PRIMARY)).toEqual({
      apiKey: "k", apiSecret: "s", passphrase: "p",
    });
  });

  it("does NOT use the legacy fixed keys for a NON-primary wallet", () => {
    clearAll();
    inv.primaryAddress = ADDR_PRIMARY;
    process.env.POLYMARKET_API_KEY = "k";
    process.env.POLYMARKET_API_SECRET = "s";
    process.env.POLYMARKET_PASSPHRASE = "p";
    expect(() => requirePolyClobCredentials(ADDR_SESSION)).toThrow(VexError);
    expect(() => requirePolyClobCredentials(ADDR_SESSION)).toThrow(/not configured/i);
  });

  it("map entry wins over the legacy fixed keys for the primary", () => {
    clearAll();
    inv.primaryAddress = ADDR_PRIMARY;
    process.env.POLYMARKET_API_KEY = "legacy";
    process.env.POLYMARKET_API_SECRET = "legacy";
    process.env.POLYMARKET_PASSPHRASE = "legacy";
    process.env[MAP_KEY] = JSON.stringify({ [ADDR_PRIMARY]: MAP_CREDS });
    expect(requirePolyClobCredentials(ADDR_PRIMARY)).toEqual(MAP_CREDS);
  });

  it("throws POLYMARKET_NOT_CONFIGURED when nothing resolves", () => {
    clearAll();
    inv.primaryAddress = null;
    try {
      requirePolyClobCredentials(ADDR_SESSION);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VexError);
      expect((err as VexError).code).toBe(ErrorCodes.POLYMARKET_NOT_CONFIGURED);
    }
  });

  it("fails CLOSED on a malformed map even when legacy keys would match the primary", () => {
    clearAll();
    inv.primaryAddress = ADDR_PRIMARY;
    process.env.POLYMARKET_API_KEY = "k";
    process.env.POLYMARKET_API_SECRET = "s";
    process.env.POLYMARKET_PASSPHRASE = "p";
    process.env[MAP_KEY] = "{not valid json";
    expect(() => requirePolyClobCredentials(ADDR_PRIMARY)).toThrow(VexError);
  });
});

describe("hasPolyClobCredentials", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    inv.primaryAddress = null;
  });

  it("returns true when the wallet has map creds", () => {
    delete process.env.POLYMARKET_API_KEY;
    process.env[MAP_KEY] = JSON.stringify({ [ADDR_SESSION]: MAP_CREDS });
    expect(hasPolyClobCredentials(ADDR_SESSION)).toBe(true);
  });

  it("returns false when the wallet has no creds", () => {
    delete process.env[MAP_KEY];
    delete process.env.POLYMARKET_API_KEY;
    inv.primaryAddress = null;
    expect(hasPolyClobCredentials(ADDR_SESSION)).toBe(false);
  });

  it("returns false on a malformed map (the probe never surfaces corruption)", () => {
    process.env[MAP_KEY] = "{not valid json";
    expect(hasPolyClobCredentials(ADDR_SESSION)).toBe(false);
  });

  it("returns true for the primary via the legacy fallback", () => {
    delete process.env[MAP_KEY];
    inv.primaryAddress = ADDR_PRIMARY;
    process.env.POLYMARKET_API_KEY = "k";
    process.env.POLYMARKET_API_SECRET = "s";
    process.env.POLYMARKET_PASSPHRASE = "p";
    expect(hasPolyClobCredentials(ADDR_PRIMARY)).toBe(true);
  });
});
