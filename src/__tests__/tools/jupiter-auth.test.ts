import { afterEach, describe, expect, it, vi } from "vitest";
import { VexError } from "../../errors.js";

vi.mock("../../config/store.js", () => ({
  loadConfig: () => ({
    solana: {
      jupiterApiKey: "legacy-config-key",
    },
  }),
}));

const { requireJupiterApiKey, resolveJupiterApiKey } = await import(
  "../../tools/solana-ecosystem/shared/jupiter-auth.js"
);

const originalKey = process.env.JUPITER_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.JUPITER_API_KEY;
  else process.env.JUPITER_API_KEY = originalKey;
});

describe("shared Jupiter auth", () => {
  it("reads the API key only from env", () => {
    delete process.env.JUPITER_API_KEY;

    expect(resolveJupiterApiKey()).toBe("");
  });

  it("throws an env-only hint when the API key is missing", () => {
    delete process.env.JUPITER_API_KEY;

    try {
      requireJupiterApiKey();
      throw new Error("Expected requireJupiterApiKey() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(VexError);
      expect((error as VexError).hint).toContain("CONFIG_DIR/.env");
    }
  });
});
