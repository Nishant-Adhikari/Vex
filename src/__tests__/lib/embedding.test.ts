/**
 * Tests for shared embedding bundled-defaults reader (M9).
 *
 * Verifies:
 *  - file_missing: read failure collapses cleanly (no throw).
 *  - incomplete: missing keys reported by name.
 *  - parse_error: strict EMBEDDING_DIM (rejects "768abc"); rejects
 *    out-of-range dim.
 *  - happy path: full .env.example yields all 4 fields normalized.
 *  - Comment + blank lines ignored; quoted values unwrapped.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_EMBEDDING_DIM,
  MIN_EMBEDDING_DIM,
  readEmbeddingDefaultsFromExample,
} from "../../lib/embedding.js";

const TEST_DIR = join(tmpdir(), `vex-embedding-defaults-${Date.now()}`);
const TEST_FILE = join(TEST_DIR, ".env.example");

const COMPLETE_BODY = [
  "# Bundled defaults for local Model Runner",
  "",
  'EMBEDDING_BASE_URL="http://localhost:12434/engines/llama.cpp/v1"',
  "EMBEDDING_MODEL=ai/embeddinggemma:300M-Q8_0",
  "EMBEDDING_DIM=768",
  'EMBEDDING_PROVIDER="local"',
  "",
].join("\n");

describe("readEmbeddingDefaultsFromExample", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("exposes MIN/MAX_EMBEDDING_DIM matching engine bounds", () => {
    expect(MIN_EMBEDDING_DIM).toBe(1);
    expect(MAX_EMBEDDING_DIM).toBe(8192);
  });

  it("returns file_missing when path does not exist", () => {
    const result = readEmbeddingDefaultsFromExample(join(TEST_DIR, "missing.env"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("file_missing");
  });

  it("returns happy values from a complete .env.example", () => {
    writeFileSync(TEST_FILE, COMPLETE_BODY);
    const result = readEmbeddingDefaultsFromExample(TEST_FILE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values).toEqual({
        baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
        model: "ai/embeddinggemma:300M-Q8_0",
        dim: 768,
        provider: "local",
      });
    }
  });

  it("reports incomplete with missingKeys when a field is absent", () => {
    writeFileSync(TEST_FILE, [
      'EMBEDDING_BASE_URL="http://x"',
      "EMBEDDING_DIM=768",
    ].join("\n"));
    const result = readEmbeddingDefaultsFromExample(TEST_FILE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("incomplete");
      expect(result.detail?.missingKeys).toEqual(
        expect.arrayContaining(["EMBEDDING_MODEL", "EMBEDDING_PROVIDER"]),
      );
    }
  });

  it("reports incomplete when a value is empty string", () => {
    writeFileSync(TEST_FILE, [
      'EMBEDDING_BASE_URL=""',
      "EMBEDDING_MODEL=x",
      "EMBEDDING_DIM=768",
      "EMBEDDING_PROVIDER=local",
    ].join("\n"));
    const result = readEmbeddingDefaultsFromExample(TEST_FILE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("incomplete");
      expect(result.detail?.missingKeys).toEqual(["EMBEDDING_BASE_URL"]);
    }
  });

  it("rejects EMBEDDING_DIM with trailing garbage (parseInt would silently accept)", () => {
    writeFileSync(TEST_FILE, [
      'EMBEDDING_BASE_URL="http://x"',
      "EMBEDDING_MODEL=x",
      "EMBEDDING_DIM=768abc",
      "EMBEDDING_PROVIDER=local",
    ].join("\n"));
    const result = readEmbeddingDefaultsFromExample(TEST_FILE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("parse_error");
      expect(result.detail?.field).toBe("EMBEDDING_DIM");
    }
  });

  it("rejects EMBEDDING_DIM out of range (above max)", () => {
    writeFileSync(TEST_FILE, [
      'EMBEDDING_BASE_URL="http://x"',
      "EMBEDDING_MODEL=x",
      "EMBEDDING_DIM=99999",
      "EMBEDDING_PROVIDER=local",
    ].join("\n"));
    const result = readEmbeddingDefaultsFromExample(TEST_FILE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("parse_error");
  });

  it("rejects EMBEDDING_DIM=0 (below MIN)", () => {
    writeFileSync(TEST_FILE, [
      'EMBEDDING_BASE_URL="http://x"',
      "EMBEDDING_MODEL=x",
      "EMBEDDING_DIM=0",
      "EMBEDDING_PROVIDER=local",
    ].join("\n"));
    const result = readEmbeddingDefaultsFromExample(TEST_FILE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("parse_error");
  });

  it("ignores comments and blank lines", () => {
    writeFileSync(TEST_FILE, [
      "# header comment",
      "",
      'EMBEDDING_BASE_URL="http://x"',
      "  # indented comment",
      "",
      "EMBEDDING_MODEL=m",
      "EMBEDDING_DIM=42",
      "EMBEDDING_PROVIDER=p",
    ].join("\n"));
    const result = readEmbeddingDefaultsFromExample(TEST_FILE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.values.dim).toBe(42);
  });

  it("unwraps both double and single quoted values", () => {
    writeFileSync(TEST_FILE, [
      "EMBEDDING_BASE_URL='http://single'",
      'EMBEDDING_MODEL="double-quoted"',
      "EMBEDDING_DIM=1",
      "EMBEDDING_PROVIDER=unquoted",
    ].join("\n"));
    const result = readEmbeddingDefaultsFromExample(TEST_FILE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.baseUrl).toBe("http://single");
      expect(result.values.model).toBe("double-quoted");
      expect(result.values.provider).toBe("unquoted");
    }
  });
});
