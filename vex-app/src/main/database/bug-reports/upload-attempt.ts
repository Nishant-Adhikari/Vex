/**
 * Phase 3 prep — invoked by the upload worker (not built yet) to record
 * one upload attempt.
 */

import { withClient } from "./connection.js";
import { BUG_REPORT_COLUMNS, mapRow, type BugReportRow } from "./mappers.js";
import type { BugReport, BugReportUploadState } from "./types.js";

/**
 * Phase 3 prep — invoked by the upload worker (not built yet) to record
 * one upload attempt. Owner-checked at the SQL level by id only because
 * Phase 3 will introduce a `locked_by` column at that time; for now the
 * single-instance lock on vex-app guarantees one writer.
 *
 * Always updates `updated_at = NOW()`. Sets `next_upload_at` to control
 * the retry backoff; setting it to NULL parks the report (e.g. terminal
 * failure or successful upload).
 */
export async function bumpUploadAttempt(
  id: string,
  args: {
    readonly state: BugReportUploadState;
    readonly error: string | null;
    readonly nextUploadAt: string | null;
    readonly remoteReportId?: string | null;
    readonly uploadedAt?: string | null;
  },
): Promise<BugReport | null> {
  return withClient(async (client) => {
    const result = await client.query<BugReportRow>(
      `UPDATE bug_reports
       SET upload_state          = $2,
           upload_attempt_count  = upload_attempt_count + 1,
           last_upload_error     = $3,
           next_upload_at        = $4,
           remote_report_id      = COALESCE($5, remote_report_id),
           uploaded_at           = COALESCE($6::timestamptz, uploaded_at),
           updated_at            = NOW()
       WHERE id = $1
       RETURNING ${BUG_REPORT_COLUMNS}`,
      [
        id,
        args.state,
        args.error,
        args.nextUploadAt,
        args.remoteReportId ?? null,
        args.uploadedAt ?? null,
      ],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  });
}
