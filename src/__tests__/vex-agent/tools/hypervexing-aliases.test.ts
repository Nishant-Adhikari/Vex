import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearHlPolicyProvider,
  registerHlPolicyProvider,
} from "../../../lib/hyperliquid-policy.js";
import {
  clearHlWorkspaceModeProvider,
  registerHlWorkspaceModeProvider,
} from "../../../lib/hyperliquid-workspace-mode.js";
import { buildProtocolsPrompt, resetProtocolsPromptCache } from "@vex-agent/engine/prompts/protocols.js";
import { buildToolCatalogPrompt } from "@vex-agent/engine/prompts/tool-catalog.js";
import { getAllTools, getVisibleToolDefs, defaultVisibilityContext } from "@vex-agent/tools/registry.js";
import {
  HYPERVEXING_ALIAS_NAMES,
  HYPERVEXING_ALIAS_TARGETS,
} from "@vex-agent/tools/hypervexing-aliases.js";
import { getProtocolManifest } from "@vex-agent/tools/protocols/catalog.js";
import { HYPERLIQUID_INTERNAL_TOOLS } from "@vex-agent/tools/registry/hyperliquid.js";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";

function visibility(sessionId = SESSION_ID) {
  return defaultVisibilityContext({ sessionId });
}

beforeEach(() => {
  registerHlPolicyProvider(() => ({ policy: {}, version: "v1", provenance: "preferences" }));
  registerHlWorkspaceModeProvider((sessionId) => sessionId === SESSION_ID ? "hypervexing" : "normal");
  process.env.VEX_HYPERLIQUID_ATOMIC_OPEN_ENABLED = "1";
  resetProtocolsPromptCache();
});

afterEach(() => {
  clearHlPolicyProvider();
  clearHlWorkspaceModeProvider();
  delete process.env.VEX_HYPERLIQUID_ATOMIC_OPEN_ENABLED;
  resetProtocolsPromptCache();
});

describe("Hypervexing mode-scoped aliases", () => {
  it("maps every alias to a real Hyperliquid manifest", () => {
    for (const [alias, toolId] of Object.entries(HYPERVEXING_ALIAS_TARGETS)) {
      expect(getProtocolManifest(toolId), `${alias} target missing: ${toolId}`).toBeDefined();
    }
  });

  it("shows the complete hot set only for the active session mode", () => {
    const hotNames = getVisibleToolDefs(visibility()).map((tool) => tool.name)
      .filter((name) => name.startsWith("hl_"));
    expect(hotNames).toEqual(HYPERVEXING_ALIAS_NAMES);
    expect(getVisibleToolDefs(visibility("00000000-0000-4000-8000-000000000002"))
      .some((tool) => tool.name.startsWith("hl_"))).toBe(false);
  });

  it("removes hl_open when the atomic-open release capability is off", () => {
    delete process.env.VEX_HYPERLIQUID_ATOMIC_OPEN_ENABLED;
    const names = getVisibleToolDefs(visibility()).map((tool) => tool.name);
    expect(names).not.toContain("hl_open");
    expect(names).toContain("hl_close");
    expect(names).toContain("hl_set_stop");
  });

  it("adds the tool-map category and compact index only in Hypervexing mode", () => {
    expect(buildToolCatalogPrompt(visibility())).toContain("Hypervexing Hyperliquid hot set");
    expect(buildToolCatalogPrompt(visibility("00000000-0000-4000-8000-000000000002")))
      .not.toContain("Hypervexing Hyperliquid hot set");

    expect(buildProtocolsPrompt(SESSION_ID)).toContain("Hypervexing compact Hyperliquid index");
    expect(buildProtocolsPrompt(SESSION_ID)).toContain("hyperliquid.perp.twap");
    expect(buildProtocolsPrompt(SESSION_ID)).toContain("Hypervexing workspace: ACTIVE for this session.");
    expect(buildProtocolsPrompt("00000000-0000-4000-8000-000000000002"))
      .not.toContain("Hypervexing compact Hyperliquid index");
    expect(buildProtocolsPrompt("00000000-0000-4000-8000-000000000002"))
      .toContain("Hypervexing workspace: not active. Offer `hyperliquid_enter` when the user wants to trade Hyperliquid perps; do not push it otherwise.");
  });

  it("instructs same-turn entry for an explicit Hypervexing request", () => {
    expect(buildProtocolsPrompt()).toContain("call `hyperliquid_enter` in THAT turn");
    expect(buildProtocolsPrompt()).toContain("Do not merely describe the mode or ask a confirmation question.");
  });

  it("registers the always-visible safe-at-barrier workspace-entry tool", () => {
    expect(HYPERLIQUID_INTERNAL_TOOLS).toEqual([
      expect.objectContaining({
        name: "hyperliquid_enter",
        kind: "internal",
        mutating: false,
        pressureSafety: "safe_at_barrier",
      }),
    ]);
    expect(getAllTools().some((tool) => tool.name === "hyperliquid_enter")).toBe(true);
  });

  it("keeps aliases outside the permanent registry and manifest census", () => {
    const permanentNames = new Set(getAllTools().map((tool) => tool.name));
    for (const alias of HYPERVEXING_ALIAS_NAMES) expect(permanentNames.has(alias)).toBe(false);
  });
});
