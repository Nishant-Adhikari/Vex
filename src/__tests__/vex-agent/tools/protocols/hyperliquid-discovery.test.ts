import { afterEach, describe, expect, it } from "vitest";

import { clearHlPolicyProvider, registerHlPolicyProvider } from "../../../../lib/hyperliquid-policy.js";
import { getProtocolManifest, isProtocolToolAvailable } from "@vex-agent/tools/protocols/catalog.js";
import { executeProtocolTool } from "@vex-agent/tools/protocols/runtime.js";

afterEach(() => {
  clearHlPolicyProvider();
  delete process.env.VEX_HYPERLIQUID_ATOMIC_OPEN_ENABLED;
});

describe("Hyperliquid policy availability in the catalog", () => {
  it("hides mutations while leaving reads available when no provider exists", () => {
    const open = getProtocolManifest("hyperliquid.perp.open");
    const markets = getProtocolManifest("hyperliquid.perp.markets");
    expect(open && isProtocolToolAvailable(open)).toBe(false);
    expect(markets && isProtocolToolAvailable(markets)).toBe(true);
  });

  it("keeps atomic open hidden until both policy and release capability are enabled", async () => {
    registerHlPolicyProvider(() => ({ policy: {}, version: "v1", provenance: "preferences" }));
    const open = getProtocolManifest("hyperliquid.perp.open");
    expect(open && isProtocolToolAvailable(open)).toBe(false);
    const blocked = await executeProtocolTool({ toolId: "hyperliquid.perp.open", params: {} }, {
      sessionPermission: "full", approved: false, walletResolution: { source: "default" }, walletPolicy: { kind: "none" },
      hyperliquidPolicy: { kind: "available", snapshot: { policy: { requireStopLoss: true, leverageCapDefault: 3, perOrderNotionalPct: 20, totalNotionalPct: 100, maxSlippageEstPct: 1, maintenanceHeadroomFloor: 2, egressAlwaysApprove: true, marketMode: "all-core-perps", marketAllowlist: null, builderFeeConsent: { kind: "none" } }, version: "v1", resolvedAt: "2026-07-12T00:00:00.000Z", provenance: "preferences" } },
    });
    expect(blocked.output).toContain("release-gated");
    process.env.VEX_HYPERLIQUID_ATOMIC_OPEN_ENABLED = "1";
    expect(open && isProtocolToolAvailable(open)).toBe(true);
  });
});
