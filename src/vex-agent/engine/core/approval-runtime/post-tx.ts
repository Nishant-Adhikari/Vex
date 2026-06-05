/**
 * Approval runtime — post-tx side effects (dispatch / tool-result /
 * lease+flip / continuation claim).
 *
 * Compatibility façade. The snapshot tx in `./snapshot.ts` commits the
 * queue+intent decision; the functions re-exported here run AFTER that tx so
 * an audit-write or dispatch failure cannot roll back the decision itself. The
 * implementation is split under `./post-tx/`:
 *   - `post-tx/dispatch-approved.ts` — `applyApproveSideEffects` (the ONLY
 *     dispatch path: wallet hydration + context construction + dispatch).
 *   - `post-tx/result-message.ts`    — approved tool-result append +
 *     execution-status mapping.
 *   - `post-tx/reject.ts`            — `applyRejectSideEffects` and
 *     `applyPolicyDriftSideEffects` (which delegates to the shared rejection
 *     core; NEVER dispatches).
 *   - `post-tx/recovery.ts`          — `paused_error` flip + continuation-claim
 *     recovery helpers shared by all paths.
 *
 * To prevent stranding the mission run in `paused_approval` (decision resolved
 * but no post-tx work completed), every post-decision side effect is wrapped so
 * a failure explicitly flips the run to `paused_error` with audit evidence —
 * the operator can `/retry` to recover.
 */

export { applyApproveSideEffects } from "./post-tx/dispatch-approved.js";
export {
  applyPolicyDriftSideEffects,
  applyRejectSideEffects,
} from "./post-tx/reject.js";
