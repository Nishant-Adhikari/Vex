/**
 * Tests for embedding-writer (M9 Step 4).
 *
 * Real fs against tmp dir; injectable countMismatchedRows so we can
 * exercise the dim-lock + db_unavailable branches without standing
 * up Postgres. Verifies:
 *  - Happy path (no existing dim, empty knowledge_entries) → all 4
 *    fields written, dimChanged=true, written=true.
 *  - Unchanged dim path skips DB query entirely (the mock asserts
 *    the checker was not called).
 *  - DIM lock with mismatched rows → embedding.dim_locked + details.
 *  - DB unavailable → embedding.db_unavailable.
 *  - Trailing slash stripped before write.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { writeEmbeddingConfig } = await import("../embedding-writer.js");
const { readDotenvFileValue } = await import("@vex-lib/dotenv.js");
const { ok, err } = await import("@shared/ipc/result.js");

let tmpDir = "";
let envFile = "";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-embed-"));
  envFile = path.join(tmpDir, ".env");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const HAPPY_INPUT = {
  baseUrl: "http://127.0.0.1:12434/engines/llama.cpp/v1",
  model: "ai/embeddinggemma:300M-Q8_0",
  dim: 768,
  provider: "local",
} as const;

describe("writeEmbeddingConfig", () => {
  it("happy path: writes 4 fields when DB returns 0 mismatched rows", async () => {
    const checker = vi.fn().mockResolvedValue(ok(0));
    const r = await writeEmbeddingConfig(HAPPY_INPUT, {
      envFile,
      countMismatchedRows: checker,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.written).toBe(true);
      expect(r.data.dimChanged).toBe(true);
    }
    expect(checker).toHaveBeenCalledWith(768);
    expect(readDotenvFileValue("EMBEDDING_BASE_URL", envFile)).toBe(
      "http://127.0.0.1:12434/engines/llama.cpp/v1",
    );
    expect(readDotenvFileValue("EMBEDDING_MODEL", envFile)).toBe(
      "ai/embeddinggemma:300M-Q8_0",
    );
    expect(readDotenvFileValue("EMBEDDING_DIM", envFile)).toBe("768");
    expect(readDotenvFileValue("EMBEDDING_PROVIDER", envFile)).toBe("local");
  });

  it("unchanged dim path: SKIPS the DB query entirely", async () => {
    // Pre-seed .env with same dim
    await fs.writeFile(envFile, "EMBEDDING_DIM=\"768\"\n", "utf8");
    const checker = vi.fn();
    const r = await writeEmbeddingConfig(HAPPY_INPUT, {
      envFile,
      countMismatchedRows: checker,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.dimChanged).toBe(false);
    expect(checker).not.toHaveBeenCalled(); // critical assertion
  });

  it("DIM lock with mismatched rows → embedding.dim_locked", async () => {
    const checker = vi.fn().mockResolvedValue(ok(42));
    const r = await writeEmbeddingConfig(HAPPY_INPUT, {
      envFile,
      countMismatchedRows: checker,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("embedding.dim_locked");
      expect(r.error.details).toMatchObject({
        existingRowCount: 42,
        targetDim: 768,
      });
    }
    // No .env should have been written
    expect(readDotenvFileValue("EMBEDDING_DIM", envFile)).toBeNull();
  });

  it("DB unavailable → embedding.db_unavailable, no write", async () => {
    const checker = vi
      .fn()
      .mockResolvedValue(
        err({
          code: "embedding.db_unavailable",
          domain: "embedding",
          message: "DB down",
          retryable: true,
          userActionable: true,
          redacted: true,
        }),
      );
    const r = await writeEmbeddingConfig(HAPPY_INPUT, {
      envFile,
      countMismatchedRows: checker,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("embedding.db_unavailable");
    expect(readDotenvFileValue("EMBEDDING_DIM", envFile)).toBeNull();
  });

  it("strips trailing slash from baseUrl before writing", async () => {
    const checker = vi.fn().mockResolvedValue(ok(0));
    const r = await writeEmbeddingConfig(
      { ...HAPPY_INPUT, baseUrl: "http://localhost:12434/v1/" },
      { envFile, countMismatchedRows: checker },
    );
    expect(r.ok).toBe(true);
    expect(readDotenvFileValue("EMBEDDING_BASE_URL", envFile)).toBe(
      "http://localhost:12434/v1",
    );
  });

  it("preserves unrelated keys when overwriting embedding values", async () => {
    await fs.writeFile(
      envFile,
      'JUPITER_API_KEY="keep"\nEMBEDDING_DIM="768"\n',
      "utf8",
    );
    const checker = vi.fn().mockResolvedValue(ok(0));
    await writeEmbeddingConfig(HAPPY_INPUT, {
      envFile,
      countMismatchedRows: checker,
    });
    expect(readDotenvFileValue("JUPITER_API_KEY", envFile)).toBe("keep");
    expect(readDotenvFileValue("EMBEDDING_MODEL", envFile)).toBe(
      "ai/embeddinggemma:300M-Q8_0",
    );
  });
});
