import { afterEach, describe, expect, it } from "vitest";
import { validateRequiredEnv } from "../../mcp/bootstrap.js";

const ENV_KEYS = [
  "VEX_DB_URL",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIM",
  "EMBEDDING_PROVIDER",
  "JUPITER_API_KEY",
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function setRequiredBootstrapEnv(): void {
  process.env.VEX_DB_URL = "postgresql://vex:vex@localhost:5777/vex";
  process.env.EMBEDDING_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1";
  process.env.EMBEDDING_MODEL = "ai/embeddinggemma:300M-Q8_0";
  process.env.EMBEDDING_DIM = "768";
  process.env.EMBEDDING_PROVIDER = "local";
}

describe("mcp bootstrap env validation", () => {
  it("fails fast when JUPITER_API_KEY is missing", () => {
    setRequiredBootstrapEnv();
    delete process.env.JUPITER_API_KEY;

    expect(() => validateRequiredEnv()).toThrow(/JUPITER_API_KEY/);
  });

  it("passes when JUPITER_API_KEY is present", () => {
    setRequiredBootstrapEnv();
    process.env.JUPITER_API_KEY = "test-jupiter-key";

    expect(() => validateRequiredEnv()).not.toThrow();
  });
});
