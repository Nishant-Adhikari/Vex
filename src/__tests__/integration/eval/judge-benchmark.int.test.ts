/**
 * Judge-decision benchmark — LIVE SHELL + SCORING (Wave 3). TEST-ONLY.
 *
 * A SEPARATE live-judge benchmark from the 130-item correctness eval: every
 * corpus item (`_judge-corpus.ts`) is engineered to reach the LIVE judge, so the
 * metric denominator is the JUDGE ITSELF (decision quality, not pipeline
 * routing). This shell wires four structures:
 *
 *   1. REAL-GEMMA ESCALATION HARD BUILD GATE (`beforeAll`): for EACH item, run
 *      the REAL deterministic stage over REAL Gemma embeddings (the candidate +
 *      any seeded predecessor) and assert the verdict is `escalate`. A
 *      non-escalating item FAILS THE BUILD with the terminating gate named
 *      (D5/D6/D7/D8/D9) + the relevant constant — the PRE-SPEND gate, so wasted
 *      items never reach a live judge call.
 *   2. RUN PROTOCOL: a per-item N-run loop (stratum-driven: N=1 clean, N=3
 *      trap/supersede/gray), modal-verdict aggregation, and a `verdict_instability`
 *      capture per item. Each item's aggregate (+ a per-run F7-4C DB snapshot,
 *      captured BEFORE the eval wipes the DB between items) accumulates for the
 *      Wave-3 scorer.
 *   3. SCORE + REPORT (`afterAll`): `_judge-scorer.ts` computes the confusion
 *      matrix / false-promote / clamp / F7 three-way (HARD `expect()`s) + the
 *      SOFT calibration / axis-mismatch / instability / F31 metrics against
 *      `_judge-oracle.ts`, and writes `memory-system/judge-benchmark-report.md`.
 *      A red HARD gate on a lenient judge is the intended SAFETY SIGNAL.
 *   4. REPORT HEADER: model + temperature + seed recorded up front so any A/B
 *      prompt delta can be checked against the measured noise band.
 *
 * GATING: `describe.skipIf(!OPENROUTER_API_KEY || VEX_JUDGE_BENCH !== '1')`. The
 * escalation build gate ALSO needs a key (it embeds with real Gemma) and so runs
 * only under the same gate. `VEX_JUDGE_BENCH_LIMIT=N` runs a stratified N-item
 * smoke (default: the whole corpus). Run with:
 *   VEX_JUDGE_BENCH=1 OPENROUTER_API_KEY=… pnpm test:bench:judge
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getCandidateById,
  getCandidateEmbedding,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import { getById as getKnowledgeById } from "@vex-agent/db/repos/knowledge.js";
import { recallLongMemoryTopK } from "@vex-agent/db/repos/knowledge.js";
import { embedDocument } from "@vex-agent/embeddings/client.js";
import { scanLiveState } from "@vex-agent/memory/exclusion-rules.js";
import { isTradeKind } from "@vex-agent/memory/manager/kind-families.js";
import {
  runDeterministicStage,
  type DeterministicVerdict,
  type KnowledgeMatch,
} from "@vex-agent/memory/manager/deterministic-stage.js";
import {
  derefAnchorExistence,
  countRecurrence,
  deriveEvidenceStrengthCeiling,
} from "@vex-agent/memory/manager/evidence-deref.js";
import { defaultConsolidateDeps } from "@vex-agent/memory/manager/index.js";
import { isSessionSoftDeleted } from "@vex-agent/db/repos/sessions.js";
import * as executionsRepo from "@vex-agent/db/repos/executions.js";
import {
  NEAR_DUP_COSINE,
  CONFLICT_COSINE,
  RECURRENCE_PROMOTE_MIN,
  RECURRENCE_CLUSTER_COSINE,
  MUNDANE_IMPORTANCE_MAX,
  LOW_CONFIDENCE_FLOOR,
} from "@vex-agent/engine/memory-manager/policy.js";

import { resetDb, makeSession } from "../setup/fixtures.js";
import {
  seedGemmaCandidate,
  seedGemmaKnowledgeEntry,
  driveConsolidateForBench,
  type BenchJudgeDrive,
} from "./_eval-fixtures.js";
import {
  JUDGE_CORPUS,
  STRATUM_REPEAT,
  type JudgeCorpusItem,
} from "./_judge-corpus.js";
import { JUDGE_ORACLE } from "./_judge-oracle.js";
import {
  scoreFalsePromote,
  scoreConfidenceClaimOverride,
  scoreClampApplied,
  scoreF7,
  scoreConfusionMatrix,
  scoreGroundingCalibration,
  scoreAxisMismatch,
  scoreInstabilityAndF31,
  writeBenchReport,
  type ScoredRunAggregate,
  type JudgeHardGate,
} from "./_judge-scorer.js";
import { reportCard } from "./_report-card.js";

const SUITE = "judge-benchmark";
const hasKey = !!process.env.OPENROUTER_API_KEY;
const benchEnabled = process.env.VEX_JUDGE_BENCH === "1";

/**
 * Optional smoke knob: `VEX_JUDGE_BENCH_LIMIT=N` runs only N corpus items (both
 * the escalation gate and the run protocol), so a tiny end-to-end smoke of the
 * scoring + report spends a handful of judge calls instead of the full ~334.
 * UNSET (the parent's full run) → the ENTIRE corpus. A non-positive / non-numeric
 * value is treated as "all".
 *
 * The N items are a STRATIFIED spread that deliberately exercises every scorer
 * path: one clean promote, one trap reject (with a junk subtype), one supersede
 * (with a seeded predecessor → the F7 3-way), and one gray — chosen by stratum +
 * the oracle expected verdict so the smoke hits the false-promote / confidence-
 * override / clamp / F7 gates with REAL data, not just the first N (which are all
 * clean promotes). The selection reads the oracle ONLY to pick a representative
 * sample for the smoke; the full run (knob unset) uses every item in id order.
 */
const BENCH_LIMIT: number | null = (() => {
  const raw = process.env.VEX_JUDGE_BENCH_LIMIT;
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();

/** Pick up to `limit` items spanning strata + verdict classes (smoke coverage). */
function stratifiedSample(limit: number): readonly JudgeCorpusItem[] {
  const items = JUDGE_CORPUS.items;
  const picked: JudgeCorpusItem[] = [];
  const seen = new Set<string>();
  const take = (predicate: (i: JudgeCorpusItem) => boolean): void => {
    if (picked.length >= limit) return;
    const hit = items.find((i) => !seen.has(i.id) && predicate(i));
    if (hit) {
      picked.push(hit);
      seen.add(hit.id);
    }
  };
  const oracleVerdict = (i: JudgeCorpusItem): string | undefined =>
    JUDGE_ORACLE.predictions[i.id]?.expectedVerdict;
  // Priority order: a clean promote, a trap reject, a supersede w/ predecessor, a gray.
  take((i) => i.stratum === "clean" && oracleVerdict(i) === "promote");
  take((i) => i.stratum === "trap" && oracleVerdict(i) === "reject");
  take((i) => i.stratum === "supersede" && i.predecessor !== undefined);
  take((i) => i.stratum === "gray");
  // Fill any remaining budget with the next unseen items in id order.
  for (const i of items) {
    if (picked.length >= limit) break;
    if (!seen.has(i.id)) {
      picked.push(i);
      seen.add(i.id);
    }
  }
  return picked;
}

/** The corpus slice the suite actually drives (full corpus unless limited). */
const BENCH_ITEMS: readonly JudgeCorpusItem[] =
  BENCH_LIMIT === null ? JUDGE_CORPUS.items : stratifiedSample(BENCH_LIMIT);

// ════════════════════════════════════════════════════════════════════════════
//  ESCALATION BUILD GATE — REAL deterministic stage over REAL Gemma.
// ════════════════════════════════════════════════════════════════════════════

/** A seeded item ready to drive: the candidate id + its live session. */
interface SeededItem {
  readonly item: JudgeCorpusItem;
  readonly candidateId: string;
  readonly sessionId: string;
  /** The ACTIVE predecessor entry id seeded for a supersede/conflict probe, or null. */
  readonly predecessorEntryId: number | null;
  /** The predecessor's title/summary (for the F7-4C non-retrievable re-embed), or null. */
  readonly predecessorText: { readonly title: string; readonly summary: string } | null;
}

/**
 * Seed ONE corpus item into a fresh session: any active predecessor (real Gemma
 * entry), N distinct live executions, and the candidate with those executions in
 * its OWN evidence_refs (real Gemma vector). Returns the candidate id for the
 * escalation probe + the live drive, plus the predecessor id/text for the F7
 * three-way.
 *
 * The run protocol RESETS the DB before each of the N modal-vote runs and calls
 * this once per run, so each run is a fully independent draw with its OWN fresh
 * active predecessor (the v1 a supersede retires). Because the DB is wiped between
 * runs there is no `idx_ke_content_hash` collision — the identical predecessor
 * text is reseeded cleanly each run, so no per-run content-hash disambiguator is
 * needed.
 */
async function seedItem(item: JudgeCorpusItem): Promise<SeededItem> {
  const sessionId = await makeSession();

  // Optional active predecessor (supersede/conflict probe). Real Gemma entry so
  // the deterministic recall (D5/D6) sees it at a real cosine. Keep its id + text
  // so the F7 three-way (4B target match, 4C retired+non-retrievable) can score it.
  let predecessorEntryId: number | null = null;
  let predecessorText: { readonly title: string; readonly summary: string } | null = null;
  if (item.predecessor) {
    const seededPred = await seedGemmaKnowledgeEntry({
      kind: item.predecessor.kind,
      title: item.predecessor.title,
      summary: item.predecessor.summary,
      status: "active",
      source: "observed",
      maturityState: "established",
    });
    predecessorEntryId = seededPred.id;
    predecessorText = { title: item.predecessor.title, summary: item.predecessor.summary };
  }

  // N distinct live executions → bound into the candidate's OWN evidence_refs so
  // countRecurrence ≥ N (clears D7 for generalization kinds at N≥2).
  const execIds: number[] = [];
  for (let i = 0; i < item.ownAnchorCount; i++) {
    const eid = await executionsRepo.recordExecution(
      "bench.tool",
      "solana",
      sessionId,
      {},
      {},
      true,
      {},
      {},
      100,
    );
    execIds.push(eid);
  }
  const evidenceRefs = execIds.map((executionId) => ({ executionId }));

  const { candidateId } = await seedGemmaCandidate({
    sessionId,
    kind: item.kind,
    title: item.suggest.title,
    summary: item.suggest.summary,
    ...(item.suggest.contentMd !== undefined ? { contentMd: item.suggest.contentMd } : {}),
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
    ...(item.suggest.importance !== undefined ? { importance: item.suggest.importance } : {}),
    ...(item.suggest.confidence !== undefined ? { confidence: item.suggest.confidence } : {}),
    eventTime: new Date(),
  });

  return { item, candidateId, sessionId, predecessorEntryId, predecessorText };
}

/**
 * Run the REAL `runDeterministicStage` over REAL Gemma recall for one seeded
 * candidate (mirrors the consolidate.ts prelude — recall, deref, recurrence,
 * ceiling — but stops BEFORE the judge so it spends ZERO judge tokens). D5/D6/D7
 * are embedding-dependent, so this uses the production recall deps over real
 * Gemma vectors. Returns the deterministic verdict.
 */
async function probeDeterministic(candidateId: string): Promise<DeterministicVerdict> {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) throw new Error(`probeDeterministic: candidate ${candidateId} missing`);
  const embedding = await getCandidateEmbedding(candidateId);
  if (!embedding) throw new Error(`probeDeterministic: embedding ${candidateId} missing`);

  const deps = defaultConsolidateDeps();

  // D1 live-state rescan on the redacted aggregate (same shape as consolidate.ts).
  const aggregate = [
    candidate.title,
    candidate.summary,
    candidate.contentMd,
    ...candidate.entities,
    ...candidate.tags,
  ].join("\n");
  const liveStateRejected = scanLiveState(aggregate).liveFraction >= 0.3;

  // D2/D3 anchor deref.
  const anchorRes = await derefAnchorExistence(candidate.evidenceRefs, {
    getExecutionSession: deps.getExecutionSession,
    isSessionSoftDeleted,
  });

  // D7 recurrence: candidate own anchors + cluster anchors (real Gemma recall).
  const similar = await deps.recallSimilarCandidates(
    embedding.embedding,
    embedding.embeddingModel,
    embedding.embeddingDim,
    16,
  );
  const clusterAnchors = similar
    .filter((r) => r.similarity >= RECURRENCE_CLUSTER_COSINE)
    .map((r) => r.evidenceRefs);
  const recurrenceCount = countRecurrence(candidate.evidenceRefs, clusterAnchors);

  const evidenceStrengthCeiling = deriveEvidenceStrengthCeiling({
    anchorExists: anchorRes.anchorExists,
    recurrenceCount,
    isTradeKind: isTradeKind(candidate.kind),
  });

  // D4 exact-dup + D5/D6 near-dup/conflict (real Gemma knowledge recall).
  const contentHash = computeContentHash({
    kind: candidate.kind,
    title: candidate.title,
    summary: candidate.summary,
    contentMd: candidate.contentMd,
  });
  const exactDuplicate = await deps.exactDuplicateExists(contentHash);
  const knowledgeMatches: KnowledgeMatch[] = await deps.recallKnowledge(
    embedding.embedding,
    embedding.embeddingModel,
    embedding.embeddingDim,
    8,
  );

  return runDeterministicStage({
    candidate,
    liveStateRejected,
    evidenceSoftDeleted: anchorRes.softDeleted,
    anchorExists: anchorRes.anchorExists,
    evidenceStrengthCeiling,
    exactDuplicate,
    knowledgeMatches,
    recurrenceCount,
    isUserAffirmed: false,
  });
}

/**
 * Name the terminating gate + the constant for a NON-escalating verdict, so a
 * build failure tells the author exactly which deterministic terminal must be
 * authored around. The message is metrics-only (no candidate text).
 */
function describeTerminal(v: Exclude<DeterministicVerdict, { kind: "escalate" }>): string {
  if (v.kind === "reject" && v.reason === "duplicate") {
    return v.reinforcesKnowledgeId !== undefined
      ? `D5 near-dup (NEAR_DUP_COSINE=${NEAR_DUP_COSINE}) reject:duplicate → reinforces ${v.reinforcesKnowledgeId}`
      : `D4 exact content-hash reject:duplicate`;
  }
  if (v.kind === "retain" && v.reason === "premature_generalization") {
    return `D7 recurrence gate (RECURRENCE_PROMOTE_MIN=${RECURRENCE_PROMOTE_MIN}, cluster cosine=${RECURRENCE_CLUSTER_COSINE}) retain:premature_generalization`;
  }
  if (v.kind === "retain" && v.reason === "mundane") {
    return `D8 mundane (MUNDANE_IMPORTANCE_MAX=${MUNDANE_IMPORTANCE_MAX}) retain:mundane`;
  }
  if (v.reason === "low_confidence") {
    return `D9 low-confidence (LOW_CONFIDENCE_FLOOR=${LOW_CONFIDENCE_FLOOR}) ${v.kind}:low_confidence`;
  }
  if (v.kind === "reject" && v.reason === "secret_or_live_state") {
    return `D1 live-state rescan reject:secret_or_live_state`;
  }
  if (v.kind === "reject" && v.reason === "insufficient_evidence") {
    return `D2 stale-evidence reject:insufficient_evidence`;
  }
  if (v.kind === "expire") {
    return `D10 TTL expire:${v.reason} (CONFLICT_COSINE=${CONFLICT_COSINE} unused on this path)`;
  }
  return `${v.kind}:${"reason" in v ? v.reason : "?"}`;
}

// ════════════════════════════════════════════════════════════════════════════
//  RUN PROTOCOL — stratified N-run loop + modal aggregation + instability.
// ════════════════════════════════════════════════════════════════════════════

/** The aggregate of N live judge runs for one item. */
interface ItemRunAggregate {
  readonly itemId: string;
  /** Decision type per valid run (excludes not-reached + F31-invalid runs). */
  readonly verdicts: readonly string[];
  /** The modal (most frequent) valid verdict, or null if no valid run. */
  readonly modalVerdict: string | null;
  /** Instability = 1 − (modal count / valid runs); 0 = perfectly stable. */
  readonly verdictInstability: number;
  /**
   * Runs that NEVER reached the judge (deterministic terminal — llmCalls=0). NOT
   * an F31 failure: the LLM was never called. Reported SEPARATELY from F31.
   */
  readonly notReachedRuns: number;
  /**
   * Runs that REACHED the judge but returned no valid verdict (true F31:
   * reached-but-invalid). The honest F31 numerator.
   */
  readonly judgeInvalidRuns: number;
  /** Runs that reached the judge AND returned a valid verdict (= verdicts.length). */
  readonly validRuns: number;
  /** The per-run captures (incl. the raw judge reasoning seam). */
  readonly drives: readonly BenchJudgeDrive[];
}

/**
 * Modal verdict + instability over the valid runs, with the honest three-way
 * outcome split per run: `not_reached` (deterministic terminal — never called the
 * LLM), `judge_invalid` (reached the LLM, no valid verdict — true F31), `valid`.
 * The modal verdict + instability are computed over the VALID runs only.
 */
function aggregateRuns(itemId: string, drives: readonly BenchJudgeDrive[]): ItemRunAggregate {
  const verdicts: string[] = [];
  let notReachedRuns = 0;
  let judgeInvalidRuns = 0;
  for (const d of drives) {
    if (d.verdictValid && d.drive) {
      verdicts.push(d.drive.decisionType);
    } else if (d.reached) {
      // Reached the judge but no valid verdict → true F31 (reached-but-invalid).
      judgeInvalidRuns += 1;
    } else {
      // Deterministic terminal — the LLM was never called. NOT an F31 failure.
      notReachedRuns += 1;
    }
  }
  const counts = new Map<string, number>();
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
  let modalVerdict: string | null = null;
  let modalCount = 0;
  for (const [v, n] of counts) {
    if (n > modalCount) {
      modalVerdict = v;
      modalCount = n;
    }
  }
  const verdictInstability = verdicts.length === 0 ? 0 : 1 - modalCount / verdicts.length;
  return {
    itemId,
    verdicts,
    modalVerdict,
    verdictInstability,
    notReachedRuns,
    judgeInvalidRuns,
    validRuns: verdicts.length,
    drives,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  THE SHELL
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasKey || !benchEnabled)("judge benchmark (live, gated)", () => {
  // The run header (recorded in beforeAll, reused by the afterAll report writer).
  const RUN_MODEL = process.env.AGENT_MODEL ?? "unknown";
  const RUN_TEMPERATURE = process.env.AGENT_TEMPERATURE ?? "default";
  // The judge call (judge.ts → chatCompletionSimple) passes NO seed param, so
  // determinism rests on temperature alone — recorded honestly as "unset".
  const RUN_SEED = "unset";

  // The cross-`it` accumulator: one ScoredRunAggregate per driven item. Populated
  // inside each run-protocol `it` (DB-derived facts captured there, because the
  // eval `beforeEach(resetDb)` wipes the DB between items); CONSUMED in afterAll
  // for the pure-computation scoring + report.
  const aggregates: ScoredRunAggregate[] = [];

  // ── Report header: pin model + temperature + seed up front. ──
  beforeAll(() => {
    reportCard.recordCheck(SUITE, {
      label: "run-header model+temperature+seed",
      pass: true,
      note: `model=${RUN_MODEL} temperature=${RUN_TEMPERATURE} seed=${RUN_SEED} corpus=${BENCH_ITEMS.length}`,
    });
  });

  beforeEach(async () => {
    await resetDb();
  });

  // ── 1. ESCALATION HARD BUILD GATE (pre-spend; one per item). ──
  // Each item MUST reach the judge; a deterministic terminal FAILS THE BUILD with
  // the gate + constant named, BEFORE any live judge call is spent.
  describe("escalation build gate (real Gemma, no judge spend)", () => {
    for (const item of BENCH_ITEMS) {
      it(`${item.id} escalates past the deterministic stage`, async () => {
        const seeded = await seedItem(item);
        const verdict = await probeDeterministic(seeded.candidateId);
        const escalated = verdict.kind === "escalate";
        const detail = escalated
          ? "escalate"
          : describeTerminal(verdict as Exclude<DeterministicVerdict, { kind: "escalate" }>);
        reportCard.recordCheck(SUITE, {
          label: `escalation-gate ${item.id}`,
          pass: escalated,
          note: detail,
        });
        // HARD: a non-escalating item is an authoring bug — fail the build loudly.
        expect(escalated, `${item.id} did not escalate — terminated at ${detail}`).toBe(true);
      });
    }
  });

  // ── 2. RUN PROTOCOL: stratified N-run loop + modal aggregation + instability.
  //      Each item's aggregate accumulates for the afterAll scorer (4). ──
  describe("run protocol (stratified N-run + modal aggregation)", () => {
    for (const item of BENCH_ITEMS) {
      const n = STRATUM_REPEAT[item.stratum];
      it(`${item.id} runs ${n}× (stratum=${item.stratum})`, async () => {
        // N live judge runs, each a FULLY INDEPENDENT draw. The DB is RESET before
        // EACH run and the candidate (+ any supersede predecessor) is re-seeded
        // fresh — so a promote/supersede in run 0 cannot create an entry that
        // makes runs 1..N-1 hit a D4/D5 dup (which would silently collapse the
        // modal vote to N=1). A clean reset reseeds the predecessor fresh each run,
        // so no per-run content-hash disambiguation is needed. Track each run's
        // seed so a fired supersede can be tied back to ITS predecessor for the F7
        // snapshot.
        const runs: Array<{
          drive: BenchJudgeDrive;
          seeded: SeededItem;
          /**
           * The F7-4C predecessor end-state, captured INSIDE this run's iteration
           * (before the NEXT run's `resetDb` wipes it). Non-null ONLY when this run
           * fired a supersede against a seeded predecessor. With per-run reset the
           * snapshot CANNOT be deferred to after the loop — the predecessor row
           * lives only until the next reset.
           */
          predecessorEndState: ScoredRunAggregate["predecessorEndState"];
        }> = [];
        for (let run = 0; run < n; run++) {
          // Independent draw: wipe the DB, then re-seed the candidate + a fresh
          // active predecessor (a fired supersede retires it; the next run needs
          // its own active v1 to point at — the reset reproduces it exactly).
          await resetDb();
          const seeded = await seedItem(item);
          const drive = await driveConsolidateForBench(seeded.candidateId, `${SUITE}-${item.id}-r${run}`);

          // ── F7-4C SNAPSHOT (captured HERE, INSIDE the run — the next run's
          //    `resetDb` wipes this run's predecessor row). When THIS run fired a
          //    supersede against a seeded predecessor, snapshot its end-state:
          //    retired (status != active) AND non-retrievable (recall on its own
          //    embedding misses it). The representative selection below picks the
          //    snapshot for the modal-representative run. ──
          let predecessorEndState: ScoredRunAggregate["predecessorEndState"] = null;
          const firedSupersede =
            drive.drive?.decisionType === "supersede" && seeded.predecessorEntryId != null;
          if (firedSupersede && seeded.predecessorEntryId !== null) {
            const row = await getKnowledgeById(seeded.predecessorEntryId);
            const status = row?.status ?? "unknown";
            const inactive = status !== "active";
            let retrievable = false;
            if (seeded.predecessorText) {
              const { embedding, providerModel } = await embedDocument(
                seeded.predecessorText.title,
                seeded.predecessorText.summary,
              );
              const hits = await recallLongMemoryTopK(
                embedding,
                { embeddingModel: providerModel, embeddingDim: embedding.length, includeExpired: false },
                12,
              );
              retrievable = hits.some((h) => h.id === seeded.predecessorEntryId);
            }
            predecessorEndState = { inactive, retrievable, status };
          }

          runs.push({ drive, seeded, predecessorEndState });

          // F31 headline feed (one row per escalation).
          reportCard.recordJudgeAttempt({
            scenario: `${SUITE}/${item.id}/r${run}`,
            reached: drive.reached,
            valid: drive.verdictValid,
            invalidReason:
              drive.invalidReason === null
                ? null
                : drive.invalidReason === "judge_unknown"
                  ? "judge_unknown"
                  : drive.invalidReason,
          });
        }

        const drives = runs.map((r) => r.drive);
        const agg = aggregateRuns(item.id, drives);

        // ── Pick the MODAL-representative valid run: the first valid run whose
        //    decision equals the modal verdict (so the captured reasoning + the
        //    predecessor snapshot reflect the decision the gates score). Falls back
        //    to the first valid run when none matches (defensive). ──
        const validRuns = runs.filter((r) => r.drive.verdictValid && r.drive.drive);
        const representative =
          validRuns.find((r) => r.drive.drive?.decisionType === agg.modalVerdict) ??
          validRuns[0] ??
          null;
        const reasoning = representative?.drive.reasoning ?? null;
        const repSeeded = representative?.seeded ?? null;
        // The end-state captured DURING the representative run (null unless it
        // fired a supersede against a seeded predecessor).
        const predecessorEndState = representative?.predecessorEndState ?? null;

        // ── Build the scoreable aggregate + accumulate for the afterAll scorer. ──
        const scored: ScoredRunAggregate = {
          itemId: item.id,
          verdicts: agg.verdicts,
          modalVerdict: agg.modalVerdict,
          verdictInstability: agg.verdictInstability,
          notReachedRuns: agg.notReachedRuns,
          judgeInvalidRuns: agg.judgeInvalidRuns,
          validRuns: agg.validRuns,
          totalRuns: n,
          stratum: item.stratum,
          reasoning,
          predecessorEntryId: repSeeded?.predecessorEntryId ?? null,
          predecessorEndState,
        };
        aggregates.push(scored);

        reportCard.recordCheck(SUITE, {
          label: `run-protocol ${item.id}`,
          pass: true,
          note:
            `runs=${n} modal=${agg.modalVerdict ?? "none"} instability=${agg.verdictInstability.toFixed(2)} ` +
            `valid=${agg.validRuns} judgeInvalid=${agg.judgeInvalidRuns} notReached=${agg.notReachedRuns} (of ${n})` +
            (reasoning
              ? ` judgeRawTier=${reasoning.judgeSourceTier} clampedTier=${reasoning.clampedSourceTier ?? "—"} ` +
                `ceiling=${reasoning.evidenceStrengthCeiling}`
              : " (no valid verdict — F31)"),
        });

        // The N-run loop is real; the only thing that can fail here is a harness
        // bug (a thrown non-judge error already surfaced). Sanity: we attempted N.
        expect(drives.length).toBe(n);
      });
    }
  });

  // ── 4. SCORE + REPORT (afterAll, over the accumulated aggregates). The HARD
  //      gates are asserted here; SOFT metrics are recorded; the bench report is
  //      written to memory-system/judge-benchmark-report.md. A red HARD gate on a
  //      lenient judge is the intended signal — NOT softened to pass. ──
  afterAll(() => {
    if (aggregates.length === 0) return; // gated/empty run — nothing to score.

    // SOFT metrics (record-only; computed over verdictValid runs).
    const confusion = scoreConfusionMatrix(aggregates);
    const calibration = scoreGroundingCalibration(aggregates);
    const axisMismatch = scoreAxisMismatch(aggregates);
    const instability = scoreInstabilityAndF31(aggregates);

    // HARD gates (each function records its SOFT rows too).
    const hardGates: JudgeHardGate[] = [
      ...scoreFalsePromote(aggregates),
      ...scoreConfidenceClaimOverride(aggregates),
      ...scoreClampApplied(aggregates),
      ...scoreF7(aggregates),
    ];

    // The bench-specific report (NOT eval-report-latest.md).
    writeBenchReport({
      aggs: aggregates,
      confusion,
      calibration,
      axisMismatch,
      instability,
      hardGates,
      model: RUN_MODEL,
      temperature: RUN_TEMPERATURE,
      seed: RUN_SEED,
      corpusSize: BENCH_ITEMS.length,
    });

    // HARD assertion firewall: every non-knownGap gate MUST pass. A failure here
    // reds the suite (the pre-registered safety signal). knownGap gates (F7-4B
    // target selection) are recorded but NEVER asserted.
    for (const gate of hardGates) {
      if (gate.knownGap) continue;
      expect(gate.pass, `HARD gate ${gate.id} failed: ${gate.detail}`).toBe(true);
    }
  });
});

// ── A non-gated sanity check: the corpus + oracle modules load (coverage asserts
//    in those files run at import). This runs even WITHOUT a key so a structural
//    authoring slip is caught in CI before the gated live run. ──
describe("judge benchmark scaffold (structural, ungated)", () => {
  it("corpus and oracle are coherent (ids covered, one row each)", () => {
    // Importing the modules already ran their module-load asserts; re-assert the
    // 1:1 coverage here as an explicit, always-on CI signal.
    const corpusIds = new Set(JUDGE_CORPUS.items.map((i) => i.id));
    const oracleIds = new Set(Object.keys(JUDGE_ORACLE.predictions));
    expect(oracleIds).toEqual(corpusIds);
    expect(corpusIds.size).toBeGreaterThan(0);
  });

  it("escalation policy constants are present (pre-spend gate inputs)", () => {
    // The gate names these on failure; assert they imported (catch a policy rename).
    expect(NEAR_DUP_COSINE).toBeGreaterThan(0);
    expect(CONFLICT_COSINE).toBeGreaterThan(0);
    expect(RECURRENCE_PROMOTE_MIN).toBeGreaterThan(0);
  });
});
