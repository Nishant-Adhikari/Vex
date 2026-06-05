/**
 * Façade-surface guard for the dispatcher structural split (A-002).
 *
 * `src/vex-agent/tools/dispatcher.ts` was split into sibling modules under
 * `./dispatcher/` (pressure-gate, plan-acceptance-gate, mutating-targets,
 * internal-loaders, protocol-route) while the original path stays a
 * compatibility façade. This test pins the EXACT public runtime surface so a
 * later edit cannot silently drop, rename, or add an export. The behavior of
 * each symbol is covered by the dedicated dispatcher-*.test.ts suites; here we
 * only assert presence + runtime typeof + the exact export-key set.
 */

import { describe, it, expect } from "vitest";

import * as dispatcherFacade from "../../../vex-agent/tools/dispatcher.js";

// Type-only imports must compile against the façade re-exports. The dispatcher
// façade exports only values (no types), so we pin the value-import surface and
// rely on `tsc --noEmit` to reject any signature drift in these named imports.
import {
  checkPressureDeny,
  checkPlanAcceptanceDeny,
  dispatchTool,
  dispatchTargetIsMutating,
  INTERNAL_TOOL_LOADERS,
} from "../../../vex-agent/tools/dispatcher.js";

describe("dispatcher façade — public surface", () => {
  it("exposes every expected export with the correct runtime typeof", () => {
    expect(typeof checkPressureDeny).toBe("function");
    expect(typeof checkPlanAcceptanceDeny).toBe("function");
    expect(typeof dispatchTool).toBe("function");
    expect(typeof dispatchTargetIsMutating).toBe("function");
    expect(typeof INTERNAL_TOOL_LOADERS).toBe("object");
    expect(INTERNAL_TOOL_LOADERS).not.toBeNull();
  });

  it("named re-exports are identity-equal to the namespace import", () => {
    expect(dispatcherFacade.checkPressureDeny).toBe(checkPressureDeny);
    expect(dispatcherFacade.checkPlanAcceptanceDeny).toBe(checkPlanAcceptanceDeny);
    expect(dispatcherFacade.dispatchTool).toBe(dispatchTool);
    expect(dispatcherFacade.dispatchTargetIsMutating).toBe(dispatchTargetIsMutating);
    expect(dispatcherFacade.INTERNAL_TOOL_LOADERS).toBe(INTERNAL_TOOL_LOADERS);
  });

  it("INTERNAL_TOOL_LOADERS values are lazy loader functions", () => {
    for (const [name, loader] of Object.entries(INTERNAL_TOOL_LOADERS)) {
      expect(typeof loader, `loader for ${name}`).toBe("function");
    }
  });

  it("exports EXACTLY the expected runtime keys — no more, no less", () => {
    const keys = Object.keys(dispatcherFacade).sort();
    expect(keys).toEqual(
      [
        "INTERNAL_TOOL_LOADERS",
        "checkPlanAcceptanceDeny",
        "checkPressureDeny",
        "dispatchTargetIsMutating",
        "dispatchTool",
      ].sort(),
    );
  });
});
