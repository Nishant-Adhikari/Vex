import { describe, expect, it } from "vitest";
import { missionDraftSeedSchema } from "@shared/schemas/sessions.js";
import { MISSION_PRESETS } from "../missionPresets.js";

describe("missionPresets — PONS Scalper structured seed", () => {
  const pons = MISSION_PRESETS.find((p) => p.id === "pons-scalper");

  it("exists with the expected identity", () => {
    expect(pons).toBeDefined();
    expect(pons!.title).toBe("PONS Scalper");
    expect(pons!.permission).toBe("full");
  });

  it("pre-fills every structured contract field (no reliance on goal-prose parsing)", () => {
    const d = pons!.draft;
    // 1. title
    expect(d.title).toBe("PONS Scalper");
    // 2. capitalSource — primary wallet balance
    expect(d.capitalSource).toBe("primary wallet balance");
    // 3. startingCapital — $20 USD
    expect(d.startingCapital).toMatch(/\$?20/);
    expect(d.startingCapital?.toLowerCase()).toContain("usd");
    // 4. allowedChains — Robinhood Chain (chain id 4663). Must be the
    //    resolver-friendly name, not the "(4663)" parenthetical form.
    expect(d.allowedChains).toEqual(["Robinhood Chain"]);
    // 5. allowedProtocols — DexScreener (research) + on-chain swap route
    expect(d.allowedProtocols).toHaveLength(2);
    expect(d.allowedProtocols?.[0]).toMatch(/DexScreener/i);
    expect(d.allowedProtocols?.[1]).toMatch(/swap route/i);
    // 6. riskProfile — aggressive
    expect(d.riskProfile).toBe("aggressive");
    // 7. successCriteria — sellability gate, 8% stop + TP, moonbag, trim, deadline
    expect(d.successCriteria?.length).toBeGreaterThanOrEqual(5);
    const crit = d.successCriteria!.join(" | ").toLowerCase();
    expect(crit).toContain("sellability");
    expect(crit).toContain("8%");
    expect(crit).toContain("moonbag");
    expect(crit).toContain("force-close");
    // 8. stopConditions — deadline/capital/max-loss/no-opportunity
    expect(d.stopConditions).toHaveLength(4);
    const stops = d.stopConditions!.join(" | ");
    expect(stops).toContain("deadline_reached");
    expect(stops).toContain("capital_depleted");
    expect(stops).toContain("max_loss_hit");
    expect(stops).toContain("no_viable_opportunity");
    // Hard time-box carried structurally too.
    expect(d.durationMinutes).toBe(60);
    // Never surfaces a wallet in the seed — the primary wallet is bound at
    // session creation.
    expect("allowedWallets" in d).toBe(false);
  });

  it("validates against the IPC mission-draft-seed schema", () => {
    const parsed = missionDraftSeedSchema.safeParse(pons!.draft);
    expect(parsed.success).toBe(true);
  });

  it("keeps the goal prose (execution guidance) alongside the structured seed", () => {
    expect(pons!.goal.length).toBeGreaterThan(0);
    expect(pons!.draft.goal).toBe(pons!.goal);
  });
});
