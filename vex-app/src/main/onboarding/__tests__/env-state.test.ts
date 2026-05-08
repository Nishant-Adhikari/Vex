/**
 * Tests for env-state helpers — verifies presence-only behavior +
 * URL redaction. Real fetch is left to integration tests; here we
 * pin the parser semantics that protect from key/value leakage.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readEnvKeyPresence,
  readEnvValue,
  redactEmbeddingUrl,
} from "../env-state.js";

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
