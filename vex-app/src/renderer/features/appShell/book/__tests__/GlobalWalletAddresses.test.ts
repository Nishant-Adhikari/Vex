/**
 * groupWalletsByPrimary — the pure model behind `GlobalWalletAddresses`
 * (WP-L): the primary wallet per family is the first inventory entry
 * (stable insertion order), everything else is "remaining". Pure, no
 * rendering — the component render behavior is covered separately in
 * `appShell/__tests__/GlobalWalletAddresses.test.tsx`.
 */

import { describe, it, expect } from "vitest";
import type { AvailableWalletDto } from "@shared/schemas/wallets.js";
import { groupWalletsByPrimary } from "../GlobalWalletAddresses.js";

function wallet(
  id: string,
  family: "evm" | "solana",
  address: string,
  label = "",
): AvailableWalletDto {
  return { id, family, address, label };
}

describe("groupWalletsByPrimary", () => {
  it("returns null primaries and an empty remainder for an empty inventory", () => {
    const grouping = groupWalletsByPrimary({ evm: [], solana: [] });
    expect(grouping).toEqual({
      primaryEvm: null,
      primarySolana: null,
      remaining: [],
    });
  });

  it("picks the first wallet of each family as primary with no remainder for a single-wallet-per-family inventory", () => {
    const evm = wallet("evm-1", "evm", "0xAAA");
    const solana = wallet("sol-1", "solana", "SoAAA");
    const grouping = groupWalletsByPrimary({ evm: [evm], solana: [solana] });
    expect(grouping.primaryEvm).toBe(evm);
    expect(grouping.primarySolana).toBe(solana);
    expect(grouping.remaining).toEqual([]);
  });

  it("groups only the EVM family when Solana is unconfigured", () => {
    const evm = wallet("evm-1", "evm", "0xAAA");
    const grouping = groupWalletsByPrimary({ evm: [evm], solana: [] });
    expect(grouping.primaryEvm).toBe(evm);
    expect(grouping.primarySolana).toBeNull();
    expect(grouping.remaining).toEqual([]);
  });

  it("keeps every wallet beyond the first of each family in insertion order (EVM before Solana)", () => {
    const evm1 = wallet("evm-1", "evm", "0xAAA");
    const evm2 = wallet("evm-2", "evm", "0xBBB");
    const evm3 = wallet("evm-3", "evm", "0xCCC");
    const sol1 = wallet("sol-1", "solana", "SoAAA");
    const sol2 = wallet("sol-2", "solana", "SoBBB");
    const grouping = groupWalletsByPrimary({
      evm: [evm1, evm2, evm3],
      solana: [sol1, sol2],
    });
    expect(grouping.primaryEvm).toBe(evm1);
    expect(grouping.primarySolana).toBe(sol1);
    expect(grouping.remaining).toEqual([evm2, evm3, sol2]);
  });

  it("never mutates the input arrays", () => {
    const evm = [wallet("evm-1", "evm", "0xAAA"), wallet("evm-2", "evm", "0xBBB")];
    const solana = [wallet("sol-1", "solana", "SoAAA")];
    const before = { evm: [...evm], solana: [...solana] };
    groupWalletsByPrimary({ evm, solana });
    expect(evm).toEqual(before.evm);
    expect(solana).toEqual(before.solana);
  });
});
