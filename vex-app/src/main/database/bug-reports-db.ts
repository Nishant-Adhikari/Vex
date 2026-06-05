/**
 * Bug-reports DB helper for vex-app's local `support` sink.
 *
 * vex-app deliberately uses its own pg connections so the GUI build stays
 * decoupled from the engine (`src/vex-agent`) module graph (mirrors the
 * pattern in `sessions-db.ts` and `dim-lock.ts`). The shared schema lives
 * in `src/vex-agent/db/migrations/019_bug_reports.sql` and is mirrored
 * into `vex-app/resources/migrations/` at build/dev time by
 * `vex-app/scripts/copy-migrations.mjs`.
 *
 * Connection lifecycle: each public function opens its own `pg.Client`
 * (single-shot) through `buildPoolConfig()` and closes it in `finally`. No
 * pool is kept around — these calls are infrequent, never on a hot path,
 * and the explicit lifecycle keeps connection leaks impossible to reach.
 *
 * Redaction is NOT applied here. Callers (the `support` service in
 * `../support/bug-report-service.ts`) MUST redact `description`,
 * `sanitized_context`, and `attachments` BEFORE calling `insertBugReport`.
 * The `redaction_*_count` columns are stamped to prove that contract was
 * upheld.
 *
 * This module is the compatibility façade for the bug-reports DB repository:
 * the implementation lives in `./bug-reports/*` and is re-exported here so the
 * existing import path (`../database/bug-reports-db.js`) keeps its public
 * surface.
 */

export type {
  BugReportKind,
  BugReportSource,
  BugReportSeverity,
  BugReportStatus,
  BugReportUploadState,
  ContextPressureBand,
  BugReport,
  BugReportInsert,
  ListRecentArgs,
} from "./bug-reports/types.js";
export { BugReportsDbUnavailableError } from "./bug-reports/connection.js";
export { insertBugReport } from "./bug-reports/create.js";
export { listRecentBugReports, getBugReportById } from "./bug-reports/read.js";
export { bumpUploadAttempt } from "./bug-reports/upload-attempt.js";
