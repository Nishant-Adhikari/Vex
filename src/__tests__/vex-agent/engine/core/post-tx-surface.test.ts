/**
 * Surface guard — `engine/core/approval-runtime/post-tx.ts` façade.
 *
 * After the structural split of the post-tx side effects into
 * `post-tx/{dispatch-approved,result-message,reject,recovery}.ts`, the original
 * path stays as a compatibility façade. This test pins the EXACT public runtime
 * surface (every exported value present with the right `typeof`, and no extra
 * keys) so a future refactor cannot silently drop or add an export. The
 * importer `engine/core/approval-runtime.ts` consumes exactly these three.
 */

import { describe, it, expect } from "vitest";

import * as postTx from "@vex-agent/engine/core/approval-runtime/post-tx.js";

describe("approval-runtime/post-tx façade surface", () => {
  it("exposes exactly the three apply* entrypoints as functions", () => {
    expect(typeof postTx.applyApproveSideEffects).toBe("function");
    expect(typeof postTx.applyRejectSideEffects).toBe("function");
    expect(typeof postTx.applyPolicyDriftSideEffects).toBe("function");
  });

  it("exports the exact set of runtime keys (no drift)", () => {
    expect(Object.keys(postTx).sort()).toEqual(
      [
        "applyApproveSideEffects",
        "applyPolicyDriftSideEffects",
        "applyRejectSideEffects",
      ].sort(),
    );
  });
});
