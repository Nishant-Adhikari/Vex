import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  projectTrade,
  projectHolderGroup,
  projectLeaderboardEntry,
  projectBuilderEntry,
  projectBuilderVolumeEntry,
  projectMarketPositionGroup,
} from "../../../vex-agent/tools/protocols/polymarket/projectors.js";
import type {
  DataTrade,
  DataMetaHolder,
  DataLeaderboardEntry,
  DataBuilderEntry,
  DataBuilderVolumeEntry,
  DataMetaMarketPosition,
} from "@tools/polymarket/data/types.js";

describe("polymarket projectors (P0-5 concise)", () => {
  it("projectTrade drops profileImage, keeps name + attribution", () => {
    const trade: DataTrade = {
      proxyWallet: "0xabc",
      side: "BUY",
      asset: "tok",
      conditionId: "c1",
      size: 10,
      price: 0.5,
      timestamp: 1700000000,
      title: "Will X happen?",
      slug: "will-x",
      outcome: "Yes",
      outcomeIndex: 0,
      transactionHash: "0xhash",
      name: "trader_one",
      pseudonym: "p1",
      profileImage: "https://img.example/avatar.png",
    };

    const out = projectTrade(trade);

    expect(out).not.toHaveProperty("profileImage");
    expect(out.name).toBe("trader_one");
    expect(out.pseudonym).toBe("p1");
    expect(out.side).toBe("BUY");
    expect(out.transactionHash).toBe("0xhash");
  });

  it("projectHolderGroup drops bio + profileImage and maps nested holders[]", () => {
    const group: DataMetaHolder = {
      token: "tok-1",
      holders: [
        {
          proxyWallet: "0x1",
          bio: "I trade markets",
          asset: "a1",
          pseudonym: "ps1",
          amount: 100,
          displayUsernamePublic: true,
          outcomeIndex: 0,
          name: "holder1",
          profileImage: "https://img/1.png",
        },
        {
          proxyWallet: "0x2",
          bio: null,
          asset: "a2",
          pseudonym: null,
          amount: 50,
          displayUsernamePublic: false,
          outcomeIndex: 1,
          name: null,
          profileImage: null,
        },
      ],
    };

    const out = projectHolderGroup(group);

    expect(out.token).toBe("tok-1");
    expect(out.holders).toHaveLength(2);
    for (const h of out.holders) {
      expect(h).not.toHaveProperty("bio");
      expect(h).not.toHaveProperty("profileImage");
    }
    expect(out.holders[0]!.amount).toBe(100);
    expect(out.holders[0]!.name).toBe("holder1");
  });

  it("projectHolderGroup tolerates a missing/invalid holders array", () => {
    const broken = { token: "t" } as unknown as DataMetaHolder;
    expect(projectHolderGroup(broken).holders).toEqual([]);
  });

  it("projectLeaderboardEntry drops profileImage, keeps verifiedBadge + xUsername", () => {
    const entry: DataLeaderboardEntry = {
      rank: "1",
      proxyWallet: "0xlead",
      userName: "topdog",
      vol: 1000,
      pnl: 250,
      profileImage: "https://img/lead.png",
      xUsername: "topdog_x",
      verifiedBadge: true,
    };

    const out = projectLeaderboardEntry(entry);

    expect(out).not.toHaveProperty("profileImage");
    expect(out.verifiedBadge).toBe(true);
    expect(out.xUsername).toBe("topdog_x");
    expect(out.vol).toBe(1000);
  });

  it("projectBuilderEntry drops builderLogo", () => {
    const entry: DataBuilderEntry = {
      rank: "2",
      builder: "buildco",
      volume: 5000,
      activeUsers: 42,
      verified: true,
      builderLogo: "https://img/logo.png",
    };

    const out = projectBuilderEntry(entry);

    expect(out).not.toHaveProperty("builderLogo");
    expect(out.builder).toBe("buildco");
    expect(out.activeUsers).toBe(42);
  });

  it("projectBuilderVolumeEntry drops builderLogo", () => {
    const entry: DataBuilderVolumeEntry = {
      dt: "2026-06-19",
      builder: "buildco",
      builderLogo: "https://img/logo.png",
      verified: false,
      volume: 1234,
      activeUsers: 7,
      rank: "3",
    };

    const out = projectBuilderVolumeEntry(entry);

    expect(out).not.toHaveProperty("builderLogo");
    expect(out.dt).toBe("2026-06-19");
    expect(out.volume).toBe(1234);
  });

  it("projectMarketPositionGroup drops profileImage and maps nested positions[]", () => {
    const group: DataMetaMarketPosition = {
      token: "mtok",
      positions: [
        {
          proxyWallet: "0xp1",
          name: "pos_owner",
          profileImage: "https://img/p1.png",
          verified: true,
          asset: "a1",
          conditionId: "c1",
          avgPrice: 0.4,
          size: 20,
          currPrice: 0.6,
          currentValue: 12,
          cashPnl: 4,
          totalBought: 8,
          realizedPnl: 0,
          totalPnl: 4,
          outcome: "Yes",
          outcomeIndex: 0,
        },
      ],
    };

    const out = projectMarketPositionGroup(group);

    expect(out.token).toBe("mtok");
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0]!).not.toHaveProperty("profileImage");
    expect(out.positions[0]!.name).toBe("pos_owner");
    expect(out.positions[0]!.totalPnl).toBe(4);
  });
});

/**
 * Capture-safety fence (plan §6/§8.6): the concise projection is only safe on
 * NON-mutating handlers — `ok()` ties output to data 1:1, so projecting a
 * MUTATING handler's data would strip `_tradeCapture` and break the capture
 * pipeline. `handlers-data.ts` (where projectors are wired) must therefore
 * never produce `_tradeCapture`. This pins that invariant so the pattern is
 * never copied onto a capturing tool.
 */
describe("capture-safety — projected data handlers carry no capture payload", () => {
  it("handlers-data.ts never references _tradeCapture", () => {
    const dataHandlersPath = fileURLToPath(
      new URL(
        "../../../vex-agent/tools/protocols/polymarket/handlers-data.ts",
        import.meta.url,
      ),
    );
    const source = readFileSync(dataHandlersPath, "utf8");
    expect(source).not.toContain("_tradeCapture");
  });
});
