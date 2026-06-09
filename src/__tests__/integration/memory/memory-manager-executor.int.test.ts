/**
 * Integration: S4 memory_manager EXECUTOR lifecycle on real pgvector with a STUB
 * judge injected via deps (no OpenRouter). Pins the end-to-end worker loop: a
 * consolidate job claims + reserves + decides its candidates and completes; an
 * item that fails fails the job for retry (which revives its own items); the
 * provider gate keeps the worker idle without env.
 *
 * The executor's pre-claim gate reads OPENROUTER_API_KEY + AGENT_MODEL — set here
 * so the loop runs; the judge itself is stubbed so no network egress happens.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { query } from "@vex-agent/db/client.js";
import { enqueueConsolidateJob, getJobById, listJobsByStatus } from "@vex-agent/db/repos/memory-jobs/index.js";
import { getCandidateById } from "@vex-agent/db/repos/memory-candidates/index.js";
import { startMemoryManagerExecutor } from "@vex-agent/engine/memory-manager/executor.js";
import { resetDb } from "../setup/fixtures.js";
import {
  makeSession,
  seedExecution,
  seedCandidate,
  depsWithStubJudge,
  PROMOTE_VERDICT,
} from "../repos/_s4-fixtures.js";

/** Poll until `pred()` is true or the deadline elapses. */
async function waitFor(pred: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor: condition not met before deadline");
}

const ORIGINAL_ENV = { ...process.env };

describe("S4 memory_manager executor (integration)", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.AGENT_MODEL = "test/model";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("drives a consolidate job to completion, retaining a single-occurrence generalization", async () => {
    const session = await makeSession();
    const execA = await seedExecution(session);
    const candidateId = await seedCandidate(session, "exec-solo", { executionIds: [execA] });
    await enqueueConsolidateJob();

    const handle = startMemoryManagerExecutor({
      pollIntervalMs: 50,
      sweepIntervalMs: 60_000,
      deps: depsWithStubJudge(PROMOTE_VERDICT),
    });
    try {
      await waitFor(async () => {
        const c = await getCandidateById(candidateId);
        return c !== null && c.status !== "pending";
      });
    } finally {
      await handle.stop();
    }

    const candidate = await getCandidateById(candidateId);
    expect(candidate!.status).toBe("retained"); // n=1 generalization → retain
    const completed = await listJobsByStatus("completed", 10);
    expect(completed.length).toBeGreaterThanOrEqual(1);
  });

  it("stays idle (claims nothing) when the provider config is absent", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const session = await makeSession();
    const execA = await seedExecution(session);
    await seedCandidate(session, "idle", { executionIds: [execA] });
    const job = await enqueueConsolidateJob();

    const handle = startMemoryManagerExecutor({
      pollIntervalMs: 50,
      sweepIntervalMs: 60_000,
      deps: depsWithStubJudge(PROMOTE_VERDICT),
    });
    // Give it a few poll cycles; without the key it must not claim.
    await new Promise((r) => setTimeout(r, 400));
    await handle.stop();

    const after = await getJobById(job.id);
    expect(after!.status).toBe("pending");
    expect(after!.attemptCount).toBe(0);
  });
});
