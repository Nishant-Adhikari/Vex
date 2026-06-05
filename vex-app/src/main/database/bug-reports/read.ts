/**
 * Bug-report reads — bounded recent list and single fetch by id.
 */

import { withClient } from "./connection.js";
import { BUG_REPORT_COLUMNS, mapRow, type BugReportRow } from "./mappers.js";
import type { BugReport, ListRecentArgs } from "./types.js";

export async function listRecentBugReports(
  args: ListRecentArgs,
): Promise<BugReport[]> {
  const safeLimit = Math.max(1, Math.min(args.limit, 500));
  return withClient(async (client) => {
    const result = await client.query<BugReportRow>(
      args.sinceCreatedAt !== undefined
        ? `SELECT ${BUG_REPORT_COLUMNS}
           FROM bug_reports
           WHERE created_at >= $1
           ORDER BY created_at DESC
           LIMIT $2`
        : `SELECT ${BUG_REPORT_COLUMNS}
           FROM bug_reports
           ORDER BY created_at DESC
           LIMIT $1`,
      args.sinceCreatedAt !== undefined
        ? [args.sinceCreatedAt, safeLimit]
        : [safeLimit],
    );
    return result.rows.map(mapRow);
  });
}

export async function getBugReportById(id: string): Promise<BugReport | null> {
  return withClient(async (client) => {
    const result = await client.query<BugReportRow>(
      `SELECT ${BUG_REPORT_COLUMNS} FROM bug_reports WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  });
}
