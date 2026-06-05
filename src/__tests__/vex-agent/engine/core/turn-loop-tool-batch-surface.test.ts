/**
 * Surface guard — `engine/core/turn-loop-tool-batch.ts` façade.
 *
 * After the structural split of the tool-batch processor into
 * `turn-loop-tool-batch/{outcome,execute,approval-stop,results}.ts`, the
 * original path stays as a compatibility façade. This test pins the EXACT
 * public runtime surface (every exported value present with the right
 * `typeof`, and no extra keys) so a future refactor cannot silently drop or
 * add an export. `StopPayload` and `ToolBatchOutcome` are type-only exports
 * (erased at runtime), so they appear in the type-only import below — not in
 * the runtime key set. The importer `engine/core/turn-loop.ts` consumes only
 * `processTurnToolBatch`.
 */

import { describe, it, expect } from "vitest";

import * as toolBatch from "@vex-agent/engine/core/turn-loop-tool-batch.js";
// Type-only imports of the re-exported types must compile.
import type {
  StopPayload,
  ToolBatchOutcome,
} from "@vex-agent/engine/core/turn-loop-tool-batch.js";

// Reference the type-only imports so `verbatimModuleSyntax`/unused checks keep
// them load-bearing without producing any runtime export.
type _StopPayloadCheck = StopPayload;
type _ToolBatchOutcomeCheck = ToolBatchOutcome;

describe("turn-loop-tool-batch façade surface", () => {
  it("exposes processTurnToolBatch as a function", () => {
    expect(typeof toolBatch.processTurnToolBatch).toBe("function");
  });

  it("exports the exact set of runtime keys (no drift)", () => {
    expect(Object.keys(toolBatch).sort()).toEqual(["processTurnToolBatch"].sort());
  });
});
