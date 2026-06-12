/**
 * Eval: consolidation judge (live DeepSeek via OpenRouter) — F31 + F32.
 *
 * The candidate is GUARANTEED to escalate to the real judge: it carries TWO
 * distinct executionId anchors in its OWN evidence_refs. `countRecurrence`
 * counts distinct executionIds across the candidate's own anchors + cluster
 * anchors, so two own anchors → recurrence ≥ 2 WITHOUT depending on real-Gemma
 * vector clustering at cosine 0.9 (the F32 fragility the baseline exposed).
 *
 * F31 capture: the real judge (`deepseek/deepseek-v4-flash`) may THROW
 * `memory_judge_schema_invalid` / `memory_judge_timeout` on a genuine
 * consolidation. The capturing driver records that as a MEASURED judge-output
 * -invalid event (never a red test). HARD assertions are:
 *   (a) the judge was REACHED (a call was attempted — the candidate escalated),
 *   (b) IF a verdict validated, the deterministic post-conditions hold
 *       (clamp ≤ ceiling, probationary/advisory/activation<1, audit row,
 *       bumpJobInference).
 * F32: the same-lesson cosine between the sibling candidate texts is recorded as
 * a measured number.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { query } from "@vex-agent/db/client.js";
import { getJobById } from "@vex-agent/db/repos/memory-jobs/index.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import { resetDb } from "../setup/fixtures.js";
import {
  seedGemmaCandidate,
  driveConsolidateCapturingJudge,
  measureSameLessonCosine,
  getLatestDecision,
} from "./_eval-fixtures.js";
import { reportCard } from "./_report-card.js";

const SUITE = "consolidation-judge";
const hasKey = !!process.env.OPENROUTER_API_KEY;

const SIBLING = {
  title: "Sibling: wait for a confirmed breakout before adding size",
  summary:
    "Across multiple sessions, adding size only after a confirmed breakout avoided premature entries.",
};
const MAIN = {
  title: "Wait for a confirmed breakout before adding size",
  summary:
    "Adding size only after a confirmed breakout repeatedly avoided premature, low-quality entries.",
};

describe.skipIf(!hasKey)("eval: consolidation judge (live)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("escalates a recurring generalization to the real judge; clamp ≤ ceiling; audited", async () => {
    const session = await query<{ id: string }>(
      `INSERT INTO sessions (id) VALUES (gen_random_uuid()::text) RETURNING id`,
    ).then((r) => r[0]!.id);

    // Two distinct executions → the candidate anchors BOTH in its OWN
    // evidence_refs. countRecurrence counts distinct executionIds across the
    // candidate's own anchors, so recurrence ≥ 2 is guaranteed independent of
    // vector clustering (the F32 fix — escalation no longer rides on cosine 0.9).
    const execRows = await query<{ id: number }>(
      `INSERT INTO protocol_executions (tool_id, namespace, session_id, success)
       VALUES ('t','n',$1,TRUE),('t','n',$1,TRUE) RETURNING id`,
      [session],
    );
    const execA = execRows[0]!.id;
    const execB = execRows[1]!.id;

    // A sibling (same Gemma neighborhood) is still seeded so the cluster path is
    // exercised, but recurrence no longer depends on it.
    await seedGemmaCandidate({
      sessionId: session,
      kind: "strategy_lesson",
      title: SIBLING.title,
      summary: SIBLING.summary,
      evidenceRefs: [{ executionId: execB }],
      importance: 7,
    });
    const { candidateId } = await seedGemmaCandidate({
      sessionId: session,
      kind: "strategy_lesson",
      title: MAIN.title,
      summary: MAIN.summary,
      // TWO own anchors → recurrence ≥ 2 by the candidate's own evidence.
      evidenceRefs: [{ executionId: execA }, { executionId: execB }],
      importance: 7,
    });

    // F32: record the measured same-lesson cosine on REAL Gemma vectors.
    const cosine = await measureSameLessonCosine(MAIN, SIBLING);
    const clustersAt09 = cosine >= 0.9;
    reportCard.recordFinding({
      code: "F32",
      manifested: !clustersAt09,
      summary: `same-lesson cosine=${cosine.toFixed(4)} on real Gemma; clusters at RECURRENCE_CLUSTER_COSINE(0.9)=${clustersAt09 ? "yes" : "NO"} — escalation now driven by two own anchors, not clustering`,
    });
    reportCard.recordCheck(SUITE, {
      label: "F32 same-lesson cosine measured (real Gemma)",
      pass: true,
      note: `cosine=${cosine.toFixed(4)} clustersAt0.9=${clustersAt09 ? "yes" : "no"}`,
    });

    const captured = await driveConsolidateCapturingJudge(candidateId, "judge-w1");

    // F31 headline feed.
    reportCard.recordJudgeAttempt({
      scenario: `${SUITE}/breakout`,
      reached: captured.reached,
      valid: captured.verdictValid,
      invalidReason:
        captured.invalidReason === null
          ? null
          : captured.invalidReason === "judge_unknown"
            ? "judge_unknown"
            : captured.invalidReason,
    });

    // HARD: the judge was REACHED (the candidate escalated — a call was attempted).
    expect(captured.reached).toBe(true);
    reportCard.recordCheck(SUITE, {
      label: "judge reached (candidate escalated; call attempted)",
      pass: captured.reached,
      note: captured.verdictValid
        ? `verdict valid (decision=${captured.drive?.decisionType})`
        : `verdict invalid: ${captured.invalidReason}`,
    });

    if (!captured.verdictValid) {
      // F31 manifests on this model — record it, assert nothing judge-dependent.
      reportCard.recordFinding({
        code: "F31",
        manifested: true,
        summary: `judge reached but produced no valid verdict (reason=${captured.invalidReason}); fail-closed → no promotion (model-coupled)`,
      });
      reportCard.recordJudge({
        scenario: `${SUITE}/breakout`,
        llmCalls: 0,
        costUsd: null,
        latencyMs: captured.latencyMs,
        verdict: `invalid:${captured.invalidReason}`,
      });
      return;
    }

    // ── Verdict validated → deterministic post-conditions are HARD. ──
    const drive = captured.drive!;
    reportCard.recordJudge({
      scenario: `${SUITE}/breakout`,
      llmCalls: drive.llmCalls,
      costUsd: drive.costUsd,
      latencyMs: drive.latencyMs,
      verdict: drive.decisionType,
    });

    const decision = await getLatestDecision(candidateId);
    expect(decision).not.toBeNull();
    expect(decision!.decisionType).toBe(drive.decisionType);
    reportCard.recordCheck(SUITE, {
      label: "decision audited in memory_decisions",
      pass: decision !== null && decision.decisionType === drive.decisionType,
      note: `type=${drive.decisionType}`,
    });

    const job = await getJobById(drive.jobId);
    expect(job).not.toBeNull();
    expect(job!.llmCallCount).toBeGreaterThan(0);
    reportCard.recordCheck(SUITE, {
      label: "bumpJobInference landed llmCalls on job",
      pass: (job?.llmCallCount ?? 0) > 0,
      note: `job.llmCallCount=${job?.llmCallCount}`,
    });

    if (drive.decisionType === "promote" && drive.promotedKnowledgeId !== null) {
      const entry = await knowledgeRepo.getById(drive.promotedKnowledgeId);
      expect(entry).not.toBeNull();
      const rank: Record<string, number> = {
        hypothesis: 0,
        inferred: 1,
        observed: 2,
        user_confirmed: 3,
      };
      const ceilingOk = rank[entry!.source] <= rank.observed;
      expect(ceilingOk).toBe(true);
      expect(entry!.maturityState).toBe("probationary");
      expect(entry!.influenceScope).toBe("advisory");
      expect(entry!.activationStrength).toBeLessThan(1);
      reportCard.recordCheck(SUITE, {
        label: "promote: source≤ceiling AND probationary/advisory/activation<1",
        pass:
          ceilingOk &&
          entry!.maturityState === "probationary" &&
          entry!.influenceScope === "advisory" &&
          entry!.activationStrength < 1,
        note: `source=${entry!.source} maturity=${entry!.maturityState} act=${entry!.activationStrength}`,
      });
    } else {
      reportCard.recordCheck(SUITE, {
        label: "judge non-promote verdict (measured)",
        pass: true,
        note: `verdict=${drive.decisionType}`,
      });
    }
  });
});
