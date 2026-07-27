/**
 * LIFECYCLE GUARD — Inference error classification -> pause/retry outcome (#52).
 *
 * Guards the END-TO-END linkage between the STRICT error classifier
 * (mission-error-classifier.ts) and the auto-retry scheduler
 * (mission-auto-retry.ts): a run that throws a transient transport error is
 * eligible for an auto-retry wake and continues; a hard-excluded cause
 * (TLS certificate / DNS ENOTFOUND) is NOT retried and lands in `paused_error`
 * with NO wake scheduled.
 *
 * Coverage gap this fills (see suite index): the classifier is unit-tested in
 * isolation and the scheduler eligibility matrix is unit-tested with a generic
 * `status:503` transient / `AGENT_VALIDATION_ERROR` permanent fixture — but the
 * two layers are never driven TOGETHER with the specific TLS/DNS/socket causes
 * the #52 fix hardened. NOTE (design fact, not a bug): the classifier reads
 * transport OWN-PROPERTIES (`code`/`causeCode`/`status`), never `err.message`,
 * so "socket hang up" is represented by `causeCode:UND_ERR_SOCKET`/`ECONNRESET`
 * and a TLS/DNS failure by its errno code — matching production error shapes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryOneWith = vi.fn();
const incrementErrorRetryCount = vi.fn();
const updateStatus = vi.fn().mockResolvedValue(undefined);
const enqueue = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  withTransaction: async <T>(cb: (client: unknown) => Promise<T>): Promise<T> =>
    cb({}),
  queryOneWith: (...a: unknown[]) => queryOneWith(...a),
}));
vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  incrementErrorRetryCount: (...a: unknown[]) => incrementErrorRetryCount(...a),
  updateStatus: (...a: unknown[]) => updateStatus(...a),
}));
vi.mock("@vex-agent/db/repos/loop-wake.js", () => ({
  enqueue: (...a: unknown[]) => enqueue(...a),
}));

const { persistErrorPauseWithMaybeAutoRetry } = await import(
  "@vex-agent/engine/core/runner/mission-auto-retry.js"
);

// Full-mode, opt-in, unstamped, retry-budget-remaining row — the ELIGIBLE
// baseline so the ONLY thing gating an auto-retry is the classifier verdict.
const OPT_IN = {
  version: 1,
  frozenMission: { constraintsJson: { autoRetryEnabled: true } },
};
function eligibleRow(over: Record<string, unknown> = {}) {
  return {
    status: "paused_error",
    stop_reason: "provider_error",
    error_retry_count: 0,
    auto_retry_unsafe: false,
    contract_snapshot_json: OPT_IN,
    permission: "full",
    ...over,
  };
}
function makeErr(extra: Record<string, unknown>): Error {
  return Object.assign(new Error("boom"), extra);
}
function call(err: unknown) {
  return persistErrorPauseWithMaybeAutoRetry(
    { runId: "run-1", err, summary: "boom", evidenceBase: {} },
    0,
  );
}

beforeEach(() => {
  incrementErrorRetryCount.mockResolvedValue(1);
  queryOneWith.mockResolvedValue(eligibleRow());
});
afterEach(() => vi.clearAllMocks());

describe("transient transport errors auto-retry (run continues)", () => {
  it("socket hang up (causeCode UND_ERR_SOCKET) schedules an auto-retry", async () => {
    const decision = await call(makeErr({ causeCode: "UND_ERR_SOCKET" }));
    expect(decision.scheduled).not.toBeNull();
    expect(decision.scheduled?.attempt).toBe(1);
    expect(incrementErrorRetryCount).toHaveBeenCalledOnce();
    // Persisted as paused_error while the retry wake is pending.
    expect(updateStatus).toHaveBeenCalledWith(
      "run-1",
      "paused_error",
      "provider_error",
      expect.objectContaining({
        evidence: expect.objectContaining({ classified: "transient" }),
      }),
      expect.anything(),
    );
  });

  it("connection reset (code ECONNRESET) schedules an auto-retry", async () => {
    const decision = await call(makeErr({ code: "ECONNRESET" }));
    expect(decision.scheduled).not.toBeNull();
  });
});

describe("hard-excluded causes do NOT retry-loop -> paused_error only", () => {
  it("DNS failure (ENOTFOUND, raw code path) surfaces paused_error with NO retry", async () => {
    const decision = await call(makeErr({ code: "ENOTFOUND" }));
    expect(decision.scheduled).toBeNull();
    expect(incrementErrorRetryCount).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith(
      "run-1",
      "paused_error",
      "provider_error",
      expect.objectContaining({
        evidence: expect.objectContaining({ classified: "permanent" }),
      }),
      expect.anything(),
    );
  });

  it.each([
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  ])("TLS cert failure (%s) surfaces paused_error with NO retry", async (causeCode) => {
    const decision = await call(makeErr({ causeCode }));
    expect(decision.scheduled).toBeNull();
    expect(incrementErrorRetryCount).not.toHaveBeenCalled();
  });

  it("a hard-exclusion beats a contradictory retryable:true stamp (operator-abort loophole)", async () => {
    // If some mapper wrongly stamped retryable:true on a normalized abort/DNS
    // error, the hard-exclusion must still win — no auto-retry.
    const decision = await call(makeErr({ retryable: true, code: "ENOTFOUND" }));
    expect(decision.scheduled).toBeNull();
  });
});
