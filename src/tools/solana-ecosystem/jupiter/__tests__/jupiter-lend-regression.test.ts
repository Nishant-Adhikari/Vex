import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LEND_FILES = [
  "src/tools/solana-ecosystem/jupiter/jupiter-lend/constants.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-lend/index.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-lend/earn-api/client.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-lend/earn-api/index.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-lend/earn-api/service.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-lend/earn-api/types.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-lend/earn-api/validation.ts",
];

describe("jupiter lend shelf regression guards", () => {
  it("does not import legacy solana tools, deferred SDKs, or lite-api", () => {
    for (const file of LEND_FILES) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("src/tools/chains/solana");
      expect(source).not.toContain("tools/chains/solana");
      expect(source).not.toContain("@jup-ag/lend");
      expect(source).not.toContain("@jup-ag/lend-read");
      expect(source).not.toContain("lite-api.jup.ag");
    }
  });
});
