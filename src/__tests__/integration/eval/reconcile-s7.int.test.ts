/**
 * Eval: S7 reconcile — ledger flip → wake → reconcile judge (F31) (live Gemma).
 *
 * Seeds a PROMOTED trade lesson (direct insert + real Gemma) whose promoted
 * candidate anchors a real confirmed-spot SELL execution and carries a semantic
 * `instrumentKey`. The candidate stores a POSITIVE old outcome (the lesson's
 * recorded win), but the underlying ledger is seeded as a LOSS, so the S7
 * re-resolve flips the signal. A NEW closing trade carrying the same
 * `instrumentKey` fires `enqueueLedgerWake` through the production capture seam.
 *
 * HARD assertions (deterministic — no judge needed):
 *   - the wake MATCHED the promoted lesson (findPromotedWakeTargets) and a
 *     reconcile job was ENQUEUED,
 *   - the outcome RE-RESOLVES negative from the seeded loss ledger.
 *
 * F31 capture: the flip consults the reconcile judge, which on
 * `deepseek/deepseek-v4-flash` hits `judge_schema_invalid` / `judge_timeout`.
 * `processReconcileJob` catches it and marks the job failed (fail-closed). We
 * READ the job's terminal state and record the reconcile-judge valid-rate; if
 * the judge blocked it, we record "blocked by F31" and still assert the
 * wake+enqueue+re-resolve.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { query } from "@vex-agent/db/client.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import {
  getCandidateById,
  updateCandidateOutcome,
  updateCandidateStatus,
  findPromotedWakeTargets,
  type WakeAnchorProbe,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import {
  claimNextDueJob,
  getJobById,
} from "@vex-agent/db/repos/memory-jobs/index.js";
import { resolveOutcome, type OutcomeResolverDeps } from "@vex-agent/memory/manager/index.js";
import { processReconcileJob } from "@vex-agent/engine/memory-manager/reconcile.js";
import { memoryOutcomeSummarySchema } from "@vex-agent/memory/schema/memory-outcome.js";
import { resetDb } from "../setup/fixtures.js";
import {
  seedFaithfulConfirmedSpotTrade,
  seedFaithfulClosingTradeForWake,
  seedGemmaCandidate,
  seedPromotedLessonDirect,
} from "./_eval-fixtures.js";
import { reportCard } from "./_report-card.js";

// Ledger read deps for the resolver (read-only, real repos).
import { getById as execGetById } from "@vex-agent/db/repos/executions.js";
import { getByExecution as activitiesByExecution } from "@vex-agent/db/repos/activity.js";
import { getMatchesBySell } from "@vex-agent/db/repos/pnl-matches.js";
import { getOpenLots } from "@vex-agent/db/repos/pnl-lots.js";
import { getByPositionKeyAnyStatus } from "@vex-agent/db/repos/open-positions.js";
import { getLpEventsByPosition } from "@vex-agent/db/repos/lp-events.js";

const SUITE = "reconcile-s7";
const WALLET = "WaLLetS7111111111111111111111111111111111111";
const hasKey = !!process.env.OPENROUTER_API_KEY;

function ledgerDeps(): OutcomeResolverDeps {
  return {
    getExecutionById: (id) => execGetById(id),
    getActivitiesByExecution: (id) => activitiesByExecution(id),
    getMatchesBySell: (id) => getMatchesBySell(id),
    getOpenLots: (instrumentKey, walletAddress) => getOpenLots(instrumentKey, walletAddress),
    getPositionByKey: (positionKey) => getByPositionKeyAnyStatus(positionKey),
    getLpEventsByPosition: (positionKey) => getLpEventsByPosition(positionKey),
  };
}

describe.skipIf(!hasKey)("eval: S7 reconcile (live)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("ledger flip wakes the lesson, enqueues a reconcile job, re-resolves negative; reconcile judge measured (F31)", async () => {
    const session = await query<{ id: string }>(
      `INSERT INTO sessions (id) VALUES (gen_random_uuid()::text) RETURNING id`,
    ).then((r) => r[0]!.id);
    const instrument = "solana:S7FLIP";

    // 1. A real confirmed spot trade seeded as a LOSS (buy 75 → sell 50 = -25)
    //    → the ledger now resolves NEGATIVE for this candidate's SELL anchor.
    const spot = await seedFaithfulConfirmedSpotTrade({
      sessionId: session,
      instrumentKey: instrument,
      walletAddress: WALLET,
      buyQtyRaw: "1000000000",
      buyValueUsd: "75.00",
      sellQtyRaw: "1000000000",
      sellValueUsd: "50.00", // loss → negative lesson signal
    });

    // 2. The promoted candidate anchors the SELL execution + the semantic key.
    const eventTime = new Date(Date.now() - 60_000);
    const { candidateId } = await seedGemmaCandidate({
      sessionId: session,
      kind: "trade_lesson",
      title: "Scaling into confirmed momentum on this name pays off",
      summary:
        "Adding to a winning spot position on confirmed momentum tends to realize gains.",
      evidenceRefs: [{ executionId: spot.sellExecutionId, instrumentKey: instrument }],
      importance: 8,
      eventTime,
    });

    // 3. Store a POSITIVE old outcome (the lesson's recorded win) while pending —
    //    this is what the negative re-resolve will FLIP against.
    const oldOutcome = memoryOutcomeSummarySchema.parse({
      status: "closed",
      lessonSignal: "positive",
      evidenceQuality: "strong",
      pointInTimeChecked: true,
      outcomeComputedBy: "memory_manager",
      pnlSource: "pnl_matches",
      outcomeVersion: 0,
    });
    const outRes = await updateCandidateOutcome(candidateId, oldOutcome, eventTime);
    expect(outRes.ok).toBe(true);

    // 4. Direct-promote the knowledge entry (real insert + Gemma), bypass the judge.
    const entry = await seedPromotedLessonDirect({
      kind: "trade_lesson",
      title: "Scaling into confirmed momentum on this name pays off",
      summary:
        "Adding to a winning spot position on confirmed momentum tends to realize gains.",
      source: "observed",
      validFrom: eventTime,
      outcomeVersion: 0,
    });
    // 5. Link the promoted candidate → the active entry (the wake-target shape).
    const statusRes = await updateCandidateStatus(candidateId, "promoted", {
      expectedFromStatus: "pending",
      promotedKnowledgeId: entry.id,
    });
    expect(statusRes.ok).toBe(true);

    // Sanity: the entry is active so findPromotedWakeTargets can see it.
    const e = await knowledgeRepo.getById(entry.id);
    expect(e?.status).toBe("active");

    // 6. A NEW closing trade carrying the SAME instrumentKey → production capture
    //    seam fires enqueueLedgerWake. Assert the wake matched + enqueued.
    await seedFaithfulClosingTradeForWake({
      sessionId: session,
      instrumentKey: instrument,
      walletAddress: WALLET,
      sellValueUsd: "40.00",
      sellQtyRaw: "500000000",
    });

    // HARD: the wake mapped the semantic key to the promoted lesson.
    const probes: WakeAnchorProbe[] = [{ instrumentKey: instrument }];
    const targets = await findPromotedWakeTargets(probes);
    const matched = targets.some((t) => t.entryId === entry.id);
    expect(matched).toBe(true);
    reportCard.recordCheck(SUITE, {
      label: "ledger wake matched the promoted lesson (findPromotedWakeTargets)",
      pass: matched,
      note: `matchedEntries=${targets.length}`,
    });

    // HARD: a reconcile job was enqueued for this entry (the capture seam did it).
    const reconcileRows = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memory_jobs
        WHERE job_kind = 'reconcile' AND reconcile_entry_id = $1`,
      [entry.id],
    );
    const enqueued = Number(reconcileRows[0]!.n);
    expect(enqueued).toBeGreaterThan(0);
    reportCard.recordCheck(SUITE, {
      label: "reconcile job enqueued by the ledger wake",
      pass: enqueued > 0,
      note: `reconcileJobs=${enqueued}`,
    });

    // HARD: the outcome RE-RESOLVES negative from the seeded loss ledger.
    const candidate = await getCandidateById(candidateId);
    const reResolved = await resolveOutcome(candidate!, true, ledgerDeps());
    expect(reResolved).not.toBeNull();
    expect(reResolved!.lessonSignal).toBe("negative");
    reportCard.recordCheck(SUITE, {
      label: "outcome re-resolves negative from the loss ledger (flip vs stored positive)",
      pass: reResolved !== null && reResolved.lessonSignal === "negative",
      note: `oldSignal=positive newSignal=${reResolved?.lessonSignal}`,
    });

    // 7. Claim + process the reconcile job. processReconcileJob never throws — on
    //    the flip it consults the reconcile judge; F31 makes that judge fail on
    //    this model, so the job ends `failed` with a bounded errorCode. READ it.
    const job = await claimNextDueJob("s7-recon-w");
    expect(job).not.toBeNull();
    expect(job!.jobKind).toBe("reconcile");
    await processReconcileJob(job!, "s7-recon-w");

    const after = await getJobById(job!.id);
    const status = after?.status ?? "unknown";
    const lastError = after?.lastError ?? null;
    const judgeReached = status === "failed" || status === "permanently_failed" || status === "completed";
    const judgeBlockedByF31 =
      (status === "failed" || status === "permanently_failed") &&
      (lastError === "judge_schema_invalid" ||
        lastError === "judge_timeout" ||
        lastError === "judge_malformed");
    const judgeValid = status === "completed";

    // F31 headline feed for the RECONCILE judge.
    reportCard.recordJudgeAttempt({
      scenario: `${SUITE}/flip`,
      reached: judgeReached,
      valid: judgeValid,
      invalidReason: judgeValid
        ? null
        : lastError === "judge_timeout"
          ? "judge_timeout"
          : lastError === "judge_malformed"
            ? "judge_malformed"
            : lastError === "judge_schema_invalid"
              ? "schema_invalid"
              : "judge_unknown",
    });

    // Judge-detail row (latency + nullable cost from the job telemetry) — the
    // ONLY validated path captures real latency + cost here.
    const reconcileLatencyMs =
      after?.startedAt && after?.completedAt
        ? Date.parse(after.completedAt) - Date.parse(after.startedAt)
        : 0;
    reportCard.recordJudge({
      scenario: `${SUITE}/flip`,
      llmCalls: after?.llmCallCount ?? 0,
      costUsd: after?.costUsd ?? null,
      latencyMs: reconcileLatencyMs,
      verdict: judgeValid ? `reconcile:${status}` : `invalid:${lastError ?? "unknown"}`,
    });
    reportCard.recordCheck(SUITE, {
      label: "reconcile judge outcome measured (F31)",
      pass: true,
      note: `jobStatus=${status} lastError=${lastError ?? "—"} ${judgeBlockedByF31 ? "(blocked by F31)" : ""}`.trim(),
    });
    reportCard.recordFinding({
      code: "F31",
      manifested: judgeBlockedByF31,
      summary: judgeBlockedByF31
        ? `reconcile flip BLOCKED by F31 — reconcile judge failed (reason=${lastError}); job=${status}, wake+enqueue+re-resolve verified deterministically`
        : `reconcile judge produced a valid verdict (job=${status}) — F31 did not block this reconcile`,
    });
  });
});
