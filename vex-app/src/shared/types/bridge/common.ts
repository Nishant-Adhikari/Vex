/**
 * Cross-domain bridge primitives.
 *
 * Types shared by both `shell/` (vex-app desktop integration) and `agent/`
 * (vex-agent runtime integration) bridge surfaces. Kept in a dedicated module
 * so neither group has to reach into the other for a shared shape.
 */

import type { Result } from "../../ipc/result.js";

/**
 * Shape returned by long-running bridge methods that support user
 * cancellation (PR3). Renderer holds onto `cancel`; calling it asks
 * main to abort the in-flight handler. `promise` resolves to the
 * handler's `Result` — cancellation is a normal Result outcome, not a
 * rejection.
 *
 * The cancelled outcome is handler-specific, NOT always an error:
 *   - `docker.composeUp` throws `AbortError` on abort → `promise`
 *     resolves to `err(internal.cancelled)`.
 *   - `chat.submit` (9-5b) returns the persisted partial normally on
 *     abort → `promise` resolves to `ok(... stopReason:"user_stopped" ...)`.
 * `register-handler` only rewrites a result to `internal.cancelled` when
 * the handler itself returned an error while the signal was aborted.
 *
 * `cancel` is idempotent: subsequent calls after the first are no-ops.
 */
export interface AbortableInvocation<T> {
  readonly promise: Promise<Result<T>>;
  readonly cancel: () => void;
}

/**
 * Renderer-side telemetry input. Constrained shape so the preload boundary
 * can validate before crossing IPC.
 */
export interface TelemetryReportInput {
  readonly kind: "caught" | "uncaught" | "boundary";
  readonly message: string;
  readonly componentStack?: string | null;
}
