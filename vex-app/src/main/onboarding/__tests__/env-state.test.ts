/**
 * Tests for env-state helpers — verifies presence-only behavior +
 * URL redaction. Real fetch is left to integration tests; here we
 * pin the parser semantics that protect from key/value leakage.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  gatherWalletAddresses,
  readEnvKeyPresence,
  readEnvValue,
  redactEmbeddingUrl,
} = await import("../env-state.js");

describe("readEnvKeyPresence", () => {
  let tmp = "";
  let envFile = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "vex-envstate-"));
    envFile = path.join(tmp, ".env");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns true when the key has a non-empty value", async () => {
    writeFileSync(envFile, "VEX_KEYSTORE_PASSWORD=correct horse battery staple\n", "utf8");
    expect(await readEnvKeyPresence(envFile, "VEX_KEYSTORE_PASSWORD")).toBe(true);
  });

  it("returns false when the key is absent", async () => {
    writeFileSync(envFile, "OTHER_KEY=value\n", "utf8");
    expect(await readEnvKeyPresence(envFile, "VEX_KEYSTORE_PASSWORD")).toBe(false);
  });

  it("returns false when the key has an empty value", async () => {
    writeFileSync(envFile, "VEX_KEYSTORE_PASSWORD=\n", "utf8");
    expect(await readEnvKeyPresence(envFile, "VEX_KEYSTORE_PASSWORD")).toBe(false);
  });

  it("returns false when the file does not exist", async () => {
    expect(await readEnvKeyPresence(envFile, "ANY")).toBe(false);
  });

  it("escapes regex metacharacters in key names", async () => {
    writeFileSync(envFile, "MY.KEY+VAL=set\n", "utf8");
    expect(await readEnvKeyPresence(envFile, "MY.KEY+VAL")).toBe(true);
    expect(await readEnvKeyPresence(envFile, "MY[KEY]")).toBe(false);
  });
});

describe("readEnvValue", () => {
  let tmp = "";
  let envFile = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "vex-envvalue-"));
    envFile = path.join(tmp, ".env");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns the unquoted value", async () => {
    writeFileSync(envFile, 'EMBEDDING_BASE_URL="http://127.0.0.1:12434/engines/llama.cpp/v1"\n', "utf8");
    expect(await readEnvValue(envFile, "EMBEDDING_BASE_URL")).toBe(
      "http://127.0.0.1:12434/engines/llama.cpp/v1"
    );
  });

  it("returns null when key is missing", async () => {
    writeFileSync(envFile, "OTHER=value\n", "utf8");
    expect(await readEnvValue(envFile, "EMBEDDING_BASE_URL")).toBeNull();
  });

  it("returns null when value is empty", async () => {
    writeFileSync(envFile, "EMBEDDING_BASE_URL=\n", "utf8");
    expect(await readEnvValue(envFile, "EMBEDDING_BASE_URL")).toBeNull();
  });
});

describe("gatherWalletAddresses", () => {
  let tmp = "";
  let configFile = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "vex-walletaddr-"));
    configFile = path.join(tmp, "config.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns both addresses when config.json is fully valid", async () => {
    writeFileSync(
      configFile,
      JSON.stringify({
        wallet: {
          address: "0xabc",
          solanaAddress: "SoLanA1111111111111111111111111111111111111",
        },
      }),
      "utf8",
    );
    expect(await gatherWalletAddresses(configFile)).toEqual({
      evm: "0xabc",
      solana: "SoLanA1111111111111111111111111111111111111",
    });
  });

  it("returns {evm:null, solana:null} when the config file is missing", async () => {
    expect(await gatherWalletAddresses(configFile)).toEqual({
      evm: null,
      solana: null,
    });
  });

  it("returns {evm:null, solana:null} when the file contains malformed JSON", async () => {
    writeFileSync(configFile, "{not-valid-json", "utf8");
    expect(await gatherWalletAddresses(configFile)).toEqual({
      evm: null,
      solana: null,
    });
  });

  it("returns nulls when wallet key is absent (config exists but has no addresses)", async () => {
    writeFileSync(configFile, JSON.stringify({ chain: "evm" }), "utf8");
    expect(await gatherWalletAddresses(configFile)).toEqual({
      evm: null,
      solana: null,
    });
  });

  it("returns nulls when wallet object has no address fields", async () => {
    writeFileSync(configFile, JSON.stringify({ wallet: {} }), "utf8");
    expect(await gatherWalletAddresses(configFile)).toEqual({
      evm: null,
      solana: null,
    });
  });

  it("collapses to nulls when wallet.address is a non-string (schema rejection)", async () => {
    writeFileSync(
      configFile,
      JSON.stringify({ wallet: { address: 12345 } }),
      "utf8",
    );
    expect(await gatherWalletAddresses(configFile)).toEqual({
      evm: null,
      solana: null,
    });
  });

  it("ignores unknown top-level keys (passthrough on outer object)", async () => {
    writeFileSync(
      configFile,
      JSON.stringify({
        wallet: { address: "0xabc", solanaAddress: null },
        chain: "evm",
        unrelated: { nested: true },
      }),
      "utf8",
    );
    expect(await gatherWalletAddresses(configFile)).toEqual({
      evm: "0xabc",
      solana: null,
    });
  });
});

describe("redactEmbeddingUrl", () => {
  it("returns scheme+host only", () => {
    expect(redactEmbeddingUrl("http://127.0.0.1:12434/engines/llama.cpp/v1")).toBe(
      "http://127.0.0.1:12434"
    );
  });

  it("returns null on null input", () => {
    expect(redactEmbeddingUrl(null)).toBeNull();
  });

  it("returns null on malformed url (avoid leaking raw input)", () => {
    expect(redactEmbeddingUrl("not a url")).toBeNull();
  });

  it("does not include path/query that may carry tokens", () => {
    expect(
      redactEmbeddingUrl("https://embed.example.com/v1/models?api_key=secret")
    ).toBe("https://embed.example.com");
  });
});
