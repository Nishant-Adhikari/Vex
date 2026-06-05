/**
 * Façade surface lock for `bug-reports-db.ts`.
 *
 * `bug-reports-db.ts` was split into `./bug-reports/*` sibling modules and now
 * re-exports the identical public surface. This test pins that surface so a
 * future structural change cannot silently drop, rename, or re-type an export
 * that the support layer (`ipc/support.ts`, `support/transport.ts`,
 * `support/bug-report-service.ts`) imports from the old path.
 *
 * It asserts:
 *   - every expected runtime export is present with the correct `typeof`,
 *   - the EXACT set of runtime export keys (no extras, none missing),
 *   - the type-only exports still compile when imported as types.
 */

import { describe, expect, it } from "vitest";
import * as bugReportsDb from "../bug-reports-db.js";
// Type-only imports: must compile. These are `type`/`interface` exports and
// therefore are NOT runtime export keys.
import type {
  BugReportKind,
  BugReportSource,
  BugReportSeverity,
  BugReportStatus,
  BugReportUploadState,
  ContextPressureBand,
  BugReport,
  BugReportInsert,
  ListRecentArgs,
} from "../bug-reports-db.js";

// Compile-time assertions that the type exports resolve to their shapes.
type _AssertKind = BugReportKind;
type _AssertSource = BugReportSource;
type _AssertSeverity = BugReportSeverity;
type _AssertStatus = BugReportStatus;
type _AssertUploadState = BugReportUploadState;
type _AssertPressureBand = ContextPressureBand;
type _AssertReport = BugReport["id"];
type _AssertInsert = BugReportInsert["id"];
type _AssertListArgs = ListRecentArgs["limit"];

// `BugReportsDbUnavailableError` is a class (runtime `function`); the four
// repository operations are plain functions.
const EXPECTED_FUNCTION_EXPORTS = [
  "BugReportsDbUnavailableError",
  "insertBugReport",
  "listRecentBugReports",
  "getBugReportById",
  "bumpUploadAttempt",
] as const;

describe("bug-reports-db façade surface", () => {
  it("exposes every expected function export with typeof === 'function'", () => {
    for (const key of EXPECTED_FUNCTION_EXPORTS) {
      expect(typeof (bugReportsDb as Record<string, unknown>)[key]).toBe("function");
    }
  });

  it("exposes EXACTLY the expected runtime export keys", () => {
    const runtimeKeys = Object.keys(bugReportsDb).sort();
    expect(runtimeKeys).toEqual([...EXPECTED_FUNCTION_EXPORTS].sort());
  });
});
