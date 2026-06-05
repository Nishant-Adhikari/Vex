/**
 * Façade surface guard for `approval-runtime/snapshot.ts`.
 *
 * After the structural split into `./snapshot/{types,render,compare,build}.ts`,
 * the original module stays a compatibility façade. This test pins the EXACT
 * runtime export-key set + each runtime export's `typeof`, and compiles
 * type-only imports of the exported types, so callers (engine/core/
 * approval-runtime.ts, post-tx/dispatch-approved.ts, post-tx/reject.ts) see no
 * difference.
 */

import { describe, it, expect } from "vitest";

import * as snapshot from "../../../../../vex-agent/engine/core/approval-runtime/snapshot.js";
import type {
  IntentSnapshotRow,
  ApproveSnapshot,
  RejectSnapshot,
} from "../../../../../vex-agent/engine/core/approval-runtime/snapshot.js";

// Type-only imports must compile and remain usable as type annotations.
type _RowCheck = IntentSnapshotRow;
type _ApproveCheck = ApproveSnapshot;
type _RejectCheck = RejectSnapshot;

describe("approval-runtime/snapshot façade surface", () => {
  it("exposes exactly the expected runtime export keys", () => {
    expect(Object.keys(snapshot).sort()).toEqual(
      ["buildApproveSnapshot", "buildRejectSnapshot"].sort(),
    );
  });

  it("each runtime export has the expected typeof", () => {
    expect(typeof snapshot.buildApproveSnapshot).toBe("function");
    expect(typeof snapshot.buildRejectSnapshot).toBe("function");
  });

  it("type-only exports compile and annotate values", () => {
    const row: _RowCheck | null = null;
    const approve: _ApproveCheck = { type: "not_found" };
    const reject: _RejectCheck = { type: "not_found" };
    expect(row).toBeNull();
    expect(approve.type).toBe("not_found");
    expect(reject.type).toBe("not_found");
  });
});
