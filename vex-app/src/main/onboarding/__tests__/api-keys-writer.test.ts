/**
 * Tests for api-keys-writer (M9 Step 3).
 *
 * Real fs against tmp dir; verifies:
 *  - Empty submission → no writes, ok({fieldsWritten:[]}).
 *  - Jupiter only → JUPITER_API_KEY persisted.
 *  - Polymarket trio → all 3 written together; existing comments
 *    + unknown keys preserved; mode 0o600 maintained.
 *  - Defensive trio coherence (empty string → invalid_input).
 *  - Deterministic fieldsWritten in canonical order.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { writeApiKeys } = await import("../api-keys-writer.js");
const { readDotenvFileValue } = await import("@vex-lib/dotenv.js");

let tmpDir = "";
let envFile = "";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-apikeys-"));
  envFile = path.join(tmpDir, ".env");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("writeApiKeys", () => {
  it("returns empty fieldsWritten when nothing is submitted", async () => {
    const r = await writeApiKeys({}, { envFile });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.fieldsWritten).toEqual([]);
    expect(existsSync(envFile)).toBe(false);
  });

  it("persists JUPITER_API_KEY only", async () => {
    const r = await writeApiKeys({ jupiterApiKey: "sk-jup-xyz" }, { envFile });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.fieldsWritten).toEqual(["JUPITER_API_KEY"]);
    expect(readDotenvFileValue("JUPITER_API_KEY", envFile)).toBe("sk-jup-xyz");
    expect(readDotenvFileValue("TAVILY_API_KEY", envFile)).toBeNull();
  });

  it("writes the Polymarket trio together when present", async () => {
    const r = await writeApiKeys(
      {
        polymarket: {
          apiKey: "p-key",
          apiSecret: "p-secret",
          passphrase: "p-pass",
        },
      },
      { envFile },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.fieldsWritten).toEqual([
        "POLYMARKET_API_KEY",
        "POLYMARKET_API_SECRET",
        "POLYMARKET_PASSPHRASE",
      ]);
    }
    expect(readDotenvFileValue("POLYMARKET_API_KEY", envFile)).toBe("p-key");
    expect(readDotenvFileValue("POLYMARKET_API_SECRET", envFile)).toBe("p-secret");
    expect(readDotenvFileValue("POLYMARKET_PASSPHRASE", envFile)).toBe("p-pass");
  });

  it("writes all submitted keys in canonical order", async () => {
    const r = await writeApiKeys(
      {
        rettiwtApiKey: "r",
        tavilyApiKey: "t",
        jupiterApiKey: "j",
        polymarket: { apiKey: "pk", apiSecret: "ps", passphrase: "pp" },
      },
      { envFile },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.fieldsWritten).toEqual([
        "JUPITER_API_KEY",
        "TAVILY_API_KEY",
        "RETTIWT_API_KEY",
        "POLYMARKET_API_KEY",
        "POLYMARKET_API_SECRET",
        "POLYMARKET_PASSPHRASE",
      ]);
    }
  });

  it("preserves existing comments and unknown keys", async () => {
    await fs.writeFile(envFile, "# header\nUNKNOWN_KEY=\"keep me\"\n", "utf8");
    const r = await writeApiKeys({ jupiterApiKey: "j" }, { envFile });
    expect(r.ok).toBe(true);
    const raw = readFileSync(envFile, "utf8");
    expect(raw).toContain("# header");
    expect(raw).toContain('UNKNOWN_KEY="keep me"');
    expect(raw).toContain('JUPITER_API_KEY="j"');
  });

  it("(POSIX) keeps mode 0o600 after write", async () => {
    if (process.platform === "win32") return;
    await writeApiKeys({ jupiterApiKey: "x" }, { envFile });
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
  });

  it("rejects polymarket trio with empty-string field (defense in depth)", async () => {
    const r = await writeApiKeys(
      {
        polymarket: { apiKey: "k", apiSecret: "", passphrase: "p" } as never,
      },
      { envFile },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("validation.invalid_input");
    }
    expect(existsSync(envFile)).toBe(false);
  });
});
