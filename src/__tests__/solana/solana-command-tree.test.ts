import { describe, expect, it } from "vitest";
import { createSolanaCommand } from "@commands/solana/index.js";

describe("solana command tree", () => {
  it("registers all expected subcommands", () => {
    const root = createSolanaCommand();
    const names = root.commands.map((c) => c.name());

    expect(names).toEqual(expect.arrayContaining([
      "browse",
      "price",
      "send",
      "send-token",
      "swap",
      "burn",
      "close-accounts",
      "lend",
      "predict",
    ]));
  });

  it("has exactly 9 registered subcommands", () => {
    const root = createSolanaCommand();
    expect(root.commands).toHaveLength(9);
  });

  it("has correct root description", () => {
    const root = createSolanaCommand();
    expect(root.description()).toContain("Solana");
  });
});
