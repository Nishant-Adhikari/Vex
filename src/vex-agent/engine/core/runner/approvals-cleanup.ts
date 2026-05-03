/**
 * Approval-queue cleanup helper, shared between `abort` and `rewind`.
 *
 * `approval_queue` has no `mission_run_id`, but every approval enqueued
 * during a mission run carries the run's `sessionId`. Filtering by
 * `sessionId` is the safe boundary: rejecting all currently-pending
 * approvals scoped to a session guarantees no `approveAndResume` for that
 * session can dispatch a tool against stale state. Per-row CAS in
 * `approvalsRepo.reject` keeps the count honest — only rows that were
 * still `pending` at our CAS time count.
 */

import * as approvalsRepo from "@vex-agent/db/repos/approvals.js";

export async function rejectPendingApprovalsForSession(sessionId: string): Promise<number> {
  const pending = await approvalsRepo.getPending();
  let count = 0;
  for (const approval of pending) {
    if (approval.sessionId !== sessionId) continue;
    const rejected = await approvalsRepo.reject(approval.id);
    if (rejected) count++;
  }
  return count;
}
