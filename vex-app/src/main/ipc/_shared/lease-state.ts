/**
 * Shared classification for "is a live runner actually observing this
 * session's run right now?"
 *
 * `mission_runs.status === 'running'` alone does NOT imply a live runner —
 * the lease can be expired or released while status is still `running`
 * (parked between autonomous mission slices, or the process that held it
 * exited without finalizing). Every control operation (stop, pause, resume,
 * retry) needs this same distinction and previously re-derived it ad hoc —
 * `runtime-stop-dispatch.ts` checked it, but `request-pause.ts`,
 * `runtime-resume-dispatch.ts`, and `runtime-retry-dispatch.ts` did not,
 * which is exactly the bug class issue #12 reported (a `running` status
 * with a dead lease strands the operation because no runner ever observes
 * it). This module owns ONLY the classification; each dispatcher decides
 * its own response to a dead lease.
 */

export type RunLeaseState =
  /** `status === 'running'` and a live lease is held — a runner is observing. */
  | "live"
  /** `status === 'running'` but the lease is expired/absent — no runner is observing. */
  | "dead"
  /** `status !== 'running'` — lease liveness is not the relevant question. */
  | "not_running";

export function classifyRunLeaseState(
  status: string | null,
  leaseActive: boolean,
): RunLeaseState {
  if (status !== "running") return "not_running";
  return leaseActive ? "live" : "dead";
}
