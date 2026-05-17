/**
 * Integration: `executeCompactNow` service correctness under concurrency
 * and Track 2 worker resilience.
 *
 * Codex audit (P1 #1, #4, #5) — required gates before commit:
 *
 *   - Two concurrent `executeCompactNow` calls against the same session
 *     don't double-bump `checkpoint_generation` (FOR UPDATE row lock plus
 *     in-transaction live-message read prevent stale-plan + late-commit).
 *
 *   - Missing OpenRouter env (worker config) keeps the executor idle and
 *     does NOT consume `attempt_count` on pending jobs (regression for the
 *     claim-then-throw bug codex flagged).
 *
 *   - Empty archive range (the chunker job points at messages that have
 *     since vanished) marks the job FAILED with a backoff, NOT completed
 *     with 0 chunks (regression for the silent data-loss path codex
 *     flagged).
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach } from "vitest";

import { executeCompactNow } from "@vex-agent/engine/compact-jobs/service.js";
import { startCompactJobsExecutor } from "@vex-agent/engine/compact-jobs/executor.js";
import {
  enqueueJob,
  getById,
  listPendingForSession,
  type NewCompactJob,
} from "@vex-agent/db/repos/compact-jobs/index.js";
import { execute, query, queryOne } from "@vex-agent/db/client.js";
import { resetCompactMutexForTests } from "@vex-agent/engine/compact-jobs/state.js";
import { insertMessage, makeSession, resetDb } from "../setup/fixtures.js";

function newJob(sessionId: string, gen: number, overrides: Partial<NewCompactJob> = {}): NewCompactJob {
  return {
    sessionId,
    checkpointGeneration: gen,
    agentSummary: overrides.agentSummary ?? `Summary gen ${gen}`,
    preserveMd: overrides.preserveMd ?? null,
    threadThemesHints: overrides.threadThemesHints ?? [],
    sourceStartMessageId: overrides.sourceStartMessageId ?? 999_999,
    sourceEndMessageId: overrides.sourceEndMessageId ?? 999_999,
  };
}

async function seedLongConversation(sessionId: string): Promise<void> {
  // `selectPrefixWithGiantFallback` keeps the last TAIL_WINDOW=10 messages
  // as the live tail; anything before that is the archive prefix. Seed >
  // TAIL_WINDOW so a normal-mode compact has something to archive.
  for (let i = 0; i < 14; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    await insertMessage(sessionId, role, `turn ${i}: realistic conversation content`);
  }
}

describe("executeCompactNow concurrency (integration)", () => {
  beforeEach(async () => {
    await resetDb();
    resetCompactMutexForTests();
  });

  it("two in-process compact calls against the same session do not double-bump checkpoint_generation", async () => {
    const sid = await makeSession();
    await seedLongConversation(sid);

    // SCOPE NOTE (codex P2 — round 2): `executeCompactNow` always enters
    // `withCheckpointMutex` first, so two calls fired from the SAME
    // process serialize on the in-process Map before the FOR UPDATE row
    // lock is ever reached. This test therefore exercises the in-process
    // mutex (and the post-lock plan-then-bump invariant), not the
    // cross-process DB row lock. Multi-process row-lock coverage is
    // deferred — would require spawning a second Node process or running
    // against a separate connection pool.
    const [a, b] = await Promise.all([
      executeCompactNow({
        sessionId: sid,
        agentSummary: "First attempt",
        preserveMd: null,
        threadThemesHints: [],
        source: "agent_tool",
      }),
      executeCompactNow({
        sessionId: sid,
        agentSummary: "Second attempt",
        preserveMd: null,
        threadThemesHints: [],
        source: "forced_fallback",
      }),
    ]);

    // Even though the in-process mutex pre-serializes, the second call's
    // POST-lock plan happens against the snapshot the first call already
    // committed against — so it sees the archived prefix gone and returns
    // `noop` rather than bumping a stale generation. That's the durable
    // correctness primitive being asserted here.
    const committed = [a, b].filter((r) => r.kind === "committed");
    const noop = [a, b].filter((r) => r.kind === "noop");

    expect(committed.length + noop.length).toBe(2);
    expect(committed.length).toBe(1);
    expect(noop.length).toBe(1);

    // Check the persisted generation matches what the committed call reported.
    const sessionRow = await queryOne<{ checkpoint_generation: number }>(
      "SELECT checkpoint_generation FROM sessions WHERE id = $1",
      [sid],
    );
    if (committed[0]?.kind !== "committed") throw new Error("committed call returned wrong shape");
    expect(sessionRow?.checkpoint_generation).toBe(committed[0].generation);

    // Token count was reset to 0 by the committed call.
    const tokRow = await queryOne<{ token_count: number }>(
      "SELECT token_count FROM sessions WHERE id = $1",
      [sid],
    );
    expect(tokRow?.token_count).toBe(0);
  });
});

describe("compact-worker missing-config gate (integration)", () => {
  let savedApiKey: string | undefined;
  let savedAgentModel: string | undefined;

  beforeAll(() => {
    savedApiKey = process.env.OPENROUTER_API_KEY;
    savedAgentModel = process.env.AGENT_MODEL;
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    // Restore env so subsequent tests / suites are not poisoned.
    if (savedApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedApiKey;
    if (savedAgentModel === undefined) delete process.env.AGENT_MODEL;
    else process.env.AGENT_MODEL = savedAgentModel;
  });

  it("does NOT claim pending jobs (or burn attempt_count) when provider env is unset", async () => {
    const sid = await makeSession();
    const enq = await enqueueJob(newJob(sid, 1));
    const jobId = enq.job.id;

    // Unset env BEFORE starting the executor so the pre-claim gate fires.
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AGENT_MODEL;

    const handle = startCompactJobsExecutor({ pollIntervalMs: 50 });
    // Give the executor a few tick cycles to demonstrate it's idle.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await handle.stop();

    const after = await getById(jobId);
    expect(after).not.toBeNull();
    // Status untouched, attempt_count still 0 — the executor never claimed.
    expect(after!.status).toBe("pending");
    expect(after!.attemptCount).toBe(0);
  });
});

describe("compact-worker empty-archive failure mode (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("marks the job FAILED (retryable) when the source range resolves to zero archived rows", async () => {
    // Provider env must be present so the pre-claim gate doesn't short-circuit
    // the test. Worker will claim, attempt processJob, hit the empty-archive
    // branch, throw → processJob.catch → markFailed with backoff.
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-fixture-key";
    process.env.AGENT_MODEL = process.env.AGENT_MODEL ?? "test/fixture-model";

    const sid = await makeSession();
    // Enqueue a job pointing at message ids that DON'T exist in
    // messages_archive — the worker will read zero rows and throw.
    const enq = await enqueueJob(newJob(sid, 1, {
      sourceStartMessageId: 88_888,
      sourceEndMessageId: 99_999,
    }));
    const jobId = enq.job.id;

    const handle = startCompactJobsExecutor({ pollIntervalMs: 50 });
    // Wait for the worker to claim + fail the job.
    let after = await getById(jobId);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      after = await getById(jobId);
      if (after && after.status !== "pending" && after.status !== "running") break;
      // Could also be back in pending after markFailed with backoff — check attempt count.
      if (after && after.attemptCount > 0 && after.status === "pending") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await handle.stop();

    expect(after).not.toBeNull();
    // The empty-archive throw bumps attempt_count via markFailed → status
    // returns to 'pending' (retryable) with next_attempt_at scheduled, OR
    // 'permanently_failed' after WORKER_MAX_ATTEMPTS. Either is a NON-success
    // terminal — the key invariant is that the job is NOT 'completed' with
    // zero chunks.
    expect(after!.status).not.toBe("completed");
    expect(after!.attemptCount).toBeGreaterThanOrEqual(1);
    expect(after!.lastError).toContain("compact_worker_empty_archive_range");
  });
});
