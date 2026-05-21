import type { Result } from "../../../ipc/result.js";
import type {
  CreateBugReportInput,
  CreateBugReportResult,
} from "../../../schemas/bug-reports.js";

/**
 * Local-first bug report sink (Phase 1). Persists to the local
 * `bug_reports` table after redaction. Distinct from Sentry telemetry —
 * this path runs without consent because the data stays on the user's
 * disk. Phase 3 will add an opt-in upload path on top of the same table.
 */
export interface SupportBridge {
  readonly createBugReport: (
    input: CreateBugReportInput
  ) => Promise<Result<CreateBugReportResult>>;
}
