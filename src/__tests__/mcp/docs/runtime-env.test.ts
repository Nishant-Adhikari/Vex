import { afterEach, describe, expect, it } from "vitest";
import { buildRuntimeEnv } from "../../../mcp/docs/registry-projection.js";

const ENV_KEYS = [
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

function setEmbeddingEnv(): void {
  process.env.EMBEDDING_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1";
  process.env.EMBEDDING_MODEL = "ai/embeddinggemma:300M-Q8_0";
  process.env.EMBEDDING_DIM = "768";
  process.env.EMBEDDING_PROVIDER = "local";
}

describe("mcp runtime env docs", () => {
  it("reports JUPITER_API_KEY as missing when unset", () => {
    setEmbeddingEnv();
    delete process.env.JUPITER_API_KEY;

    expect(buildRuntimeEnv().envFlags.JUPITER_API_KEY).toBe("missing");
  });

  it("reports JUPITER_API_KEY as present when configured", () => {
    setEmbeddingEnv();
    process.env.JUPITER_API_KEY = "test-jupiter-key";

    expect(buildRuntimeEnv().envFlags.JUPITER_API_KEY).toBe("present");
  });
});
