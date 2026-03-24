/**
 * Tests for mode-based tool filtering via proactive flag.
 */

import { describe, it, expect } from "vitest";
import { toOpenAITools, TOOLS } from "../../agent/tool-registry.js";
import type { ChatMode } from "../../agent/types.js";

const toolNames = (mode: ChatMode) => toOpenAITools(mode).map(t => t.function.name);

describe("toOpenAITools mode filtering", () => {
  it("returns all tools when chatMode is 'full'", () => {
    const full = toOpenAITools("full");
    expect(full.length).toBe(TOOLS.length);
  });

  it("returns all tools when chatMode is 'restricted'", () => {
    const restricted = toOpenAITools("restricted");
    expect(restricted.length).toBe(TOOLS.length);
  });

  it("filters proactive tools when chatMode is 'off'", () => {
    const off = toOpenAITools("off");
    expect(off.length).toBeLessThan(TOOLS.length);
  });

  it("defaults to 'off' mode when no mode passed", () => {
    const defaultTools = toOpenAITools();
    const offTools = toOpenAITools("off");
    expect(defaultTools.length).toBe(offTools.length);
  });

  // Tools that MUST be available in manual mode
  const mustBeAvailable = [
    "wallet_balance",
    "web_search",
    "web_fetch",
    "file_read",
    "file_write",
    "file_list",
    "memory_manage",
    "trade_log",
    "schedule_create",
    "schedule_remove",
    "subagent_spawn",
    "subagent_stop",
  ];

  for (const name of mustBeAvailable) {
    it(`keeps ${name} available in 'off' mode`, () => {
      expect(toolNames("off")).toContain(name);
    });
  }

  // Tools that MUST be filtered in manual mode
  const mustBeFiltered = [
    "solana_browse",
    "dexscreener_trending",
    "dexscreener_profiles",
    "dexscreener_boosts",
    "dexscreener_stream",
    "slop-app_agents_trending",
    "slop-app_agents_newest",
  ];

  for (const name of mustBeFiltered) {
    it(`filters ${name} in 'off' mode`, () => {
      expect(toolNames("off")).not.toContain(name);
    });

    it(`keeps ${name} in 'full' mode`, () => {
      expect(toolNames("full")).toContain(name);
    });
  }
});

describe("proactive flag on ToolDef", () => {
  const getDef = (name: string) => TOOLS.find(t => t.name === name);

  it("solana_browse has proactive=true", () => {
    expect(getDef("solana_browse")?.proactive).toBe(true);
  });

  it("dexscreener_trending has proactive=true", () => {
    expect(getDef("dexscreener_trending")?.proactive).toBe(true);
  });

  it("wallet_balance does NOT have proactive=true", () => {
    expect(getDef("wallet_balance")?.proactive).toBeFalsy();
  });

  it("trade_log does NOT have proactive=true", () => {
    expect(getDef("trade_log")?.proactive).toBeFalsy();
  });

  it("schedule_create does NOT have proactive=true", () => {
    expect(getDef("schedule_create")?.proactive).toBeFalsy();
  });

  it("web_search does NOT have proactive=true", () => {
    expect(getDef("web_search")?.proactive).toBeFalsy();
  });
});
