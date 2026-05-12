/**
 * Tests for ensure-embedding-defaults (M11.5.4).
 *
 * Verifies:
 *  - Happy path (empty env) → all 4 keys written with default port
 *  - Preserve-first: any existing key (even partial) blocks write
 *  - Custom embedPort propagates into EMBEDDING_BASE_URL
 *  - Idempotent re-run (second call returns "preserved", values intact)
 *  - Defaults match the contract in `embedding-defaults.ts`
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { ensureEmbeddingDefaults } = await import(
  "../ensure-embedding-defaults.js"
);
const { __resetEnvWriteMutexForTests } = await import(
  "../env-write-mutex.js"
);
const {
  DEFAULT_EMBED_PORT,
  EMBEDDING_MODEL_ALIAS,
  EMBEDDING_DIM,
  EMBEDDING_PROVIDER,
} = await import("../embedding-defaults.js");
const { readDotenvFileValue } = await import("@vex-lib/dotenv.js");

let tmpDir = "";
let envFile = "";

beforeEach(async () => {
  __resetEnvWriteMutexForTests();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-eed-"));
  envFile = path.join(tmpDir, ".env");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function readEnvKey(key: string): string | null {
  return readDotenvFileValue(key, envFile);
}

describe("ensureEmbeddingDefaults", () => {
  it("writes 4 keys when env file is empty", async () => {
    const result = await ensureEmbeddingDefaults({ envFile });
    expect(result.kind).toBe("written");
    expect([...result.writtenKeys].sort()).toEqual([
      "EMBEDDING_BASE_URL",
      "EMBEDDING_DIM",
      "EMBEDDING_MODEL",
      "EMBEDDING_PROVIDER",
    ]);
    expect(readEnvKey("EMBEDDING_BASE_URL")).toBe(
      `http://127.0.0.1:${DEFAULT_EMBED_PORT}/v1`
    );
    expect(readEnvKey("EMBEDDING_MODEL")).toBe(EMBEDDING_MODEL_ALIAS);
    expect(readEnvKey("EMBEDDING_DIM")).toBe(String(EMBEDDING_DIM));
    expect(readEnvKey("EMBEDDING_PROVIDER")).toBe(EMBEDDING_PROVIDER);
  });

  it("preserves existing custom EMBEDDING_BASE_URL (no overwrite)", async () => {
    await fs.writeFile(
      envFile,
      'EMBEDDING_BASE_URL="http://customhost:1234/v1"\n',
      "utf8"
    );
    const result = await ensureEmbeddingDefaults({ envFile });
    expect(result.kind).toBe("preserved");
    expect(result.writtenKeys).toEqual([]);
    expect(readEnvKey("EMBEDDING_BASE_URL")).toBe(
      "http://customhost:1234/v1"
    );
    expect(readEnvKey("EMBEDDING_MODEL")).toBeNull();
    expect(readEnvKey("EMBEDDING_DIM")).toBeNull();
    expect(readEnvKey("EMBEDDING_PROVIDER")).toBeNull();
  });

  it("preserves when even a single key is set (e.g. EMBEDDING_DIM only)", async () => {
    await fs.writeFile(envFile, 'EMBEDDING_DIM="1024"\n', "utf8");
    const result = await ensureEmbeddingDefaults({ envFile });
    expect(result.kind).toBe("preserved");
    expect(readEnvKey("EMBEDDING_DIM")).toBe("1024");
    expect(readEnvKey("EMBEDDING_BASE_URL")).toBeNull();
  });

  it("uses passed-in embedPort, not hardcoded", async () => {
    await ensureEmbeddingDefaults({ envFile, embedPort: 9999 });
    expect(readEnvKey("EMBEDDING_BASE_URL")).toBe(
      "http://127.0.0.1:9999/v1"
    );
  });

  it("is idempotent on re-run (second call preserves)", async () => {
    const r1 = await ensureEmbeddingDefaults({ envFile });
    expect(r1.kind).toBe("written");
    const r2 = await ensureEmbeddingDefaults({ envFile });
    expect(r2.kind).toBe("preserved");
    expect(r2.writtenKeys).toEqual([]);
    expect(readEnvKey("EMBEDDING_BASE_URL")).toBe(
      `http://127.0.0.1:${DEFAULT_EMBED_PORT}/v1`
    );
  });

  it("treats empty-string value as absent (writes defaults when EMBEDDING_*= )", async () => {
    await fs.writeFile(
      envFile,
      "EMBEDDING_BASE_URL=\nEMBEDDING_MODEL=\nEMBEDDING_DIM=\nEMBEDDING_PROVIDER=\n",
      "utf8"
    );
    const result = await ensureEmbeddingDefaults({ envFile });
    expect(result.kind).toBe("written");
    expect(readEnvKey("EMBEDDING_BASE_URL")).toBe(
      `http://127.0.0.1:${DEFAULT_EMBED_PORT}/v1`
    );
  });
});
