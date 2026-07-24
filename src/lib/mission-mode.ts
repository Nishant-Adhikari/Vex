/**
 * Mission-mode broadcast guard — the SECOND, low-level no-broadcast layer for
 * the mission simulator (belt-and-suspenders with the swap-handler paper-fill).
 *
 * A simulator mission must NEVER broadcast a real transaction. The swap handler
 * already paper-fills under simulator mode (layer A, the execute path). This
 * module is layer B: the low-level broadcast primitives
 * (`sendUniswapTransaction`, `sendKyberTransaction`) call
 * `assertBroadcastAllowed()` immediately before `walletClient.sendTransaction`.
 * If the active mission run is simulator mode the assert THROWS, so even a bug
 * that routed a simulator swap past layer A can never reach the wire.
 *
 * The active mode is carried on an `AsyncLocalStorage` set once per dispatched
 * tool call (`runWithMissionMode`, wired from the dispatcher) — an INDEPENDENT
 * channel from the `ProtocolExecutionContext.missionMode` that layer A reads, so
 * the two layers do not share a single point of failure.
 *
 * FAIL-CLOSED: `isSimulatedBroadcastContext()` treats an active store whose mode
 * is anything other than the explicit `"live"` sentinel as simulated. Only an
 * unambiguous live run (or NO mission-run store at all — e.g. a user-initiated
 * agent swap) is allowed to broadcast.
 *
 * This module lives in `src/lib` (the shared low layer) with no `vex-agent` /
 * `tools` imports so both the engine dispatcher and the tool primitives can
 * depend on it without a layering inversion. `MissionMode` is duplicated here to
 * keep the module self-contained; it mirrors `engine/types.ts`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { VexError, ErrorCodes } from "../errors.js";

/** Mirrors `engine/types.ts:MissionMode`. */
export type MissionMode = "live" | "simulator";

interface MissionModeStore {
  readonly missionMode: MissionMode;
}

const store = new AsyncLocalStorage<MissionModeStore>();

/**
 * Run `fn` with the active mission mode bound for the async subtree. Set once
 * per dispatched tool call so any broadcast primitive invoked underneath can
 * see the run's frozen mode.
 */
export function runWithMissionMode<T>(missionMode: MissionMode, fn: () => T): T {
  return store.run({ missionMode }, fn);
}

/** The active mission mode, or `undefined` when no mission-run store is set. */
export function getActiveMissionMode(): MissionMode | undefined {
  return store.getStore()?.missionMode;
}

/**
 * Whether the current async context is a simulated (no-broadcast) context.
 *
 * Fail-closed: a store IS present but its mode is not the explicit `"live"`
 * sentinel → simulated. Absent store → NOT simulated (a plain user/agent swap
 * outside any mission run is genuinely live).
 */
export function isSimulatedBroadcastContext(): boolean {
  const active = store.getStore();
  if (active === undefined) return false;
  return active.missionMode !== "live";
}

/**
 * Resolve the effective mission mode for a session, honouring the
 * FROZEN-PER-RUN invariant: the ACTIVE run's stored mode is authoritative and
 * always wins; the session-level intent is only a fallback used before a run
 * exists (setup). Defaults to `"live"`. Once a run is live, changing the
 * session's intent can never alter the running mode — the run's own frozen mode
 * is what this returns.
 */
export function resolveActiveMissionMode(
  runMode: MissionMode | null | undefined,
  sessionMode: MissionMode | null | undefined,
): MissionMode {
  return runMode ?? sessionMode ?? "live";
}

/**
 * Hard broadcast gate — call immediately before any real `sendTransaction`.
 * Throws (fail-closed) when the active mission run is simulator mode so the
 * primitive returns without ever touching the wire. `what` names the call site
 * for the error/log.
 */
export function assertBroadcastAllowed(what: string): void {
  if (isSimulatedBroadcastContext()) {
    throw new VexError(
      ErrorCodes.SWAP_FAILED,
      `${what} blocked: this is a SIMULATOR mission run — no transaction may be broadcast. ` +
        `This is a safety backstop; the swap should have been paper-filled upstream.`,
    );
  }
}
