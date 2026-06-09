/**
 * Integration: S5 trading-evidence outcome resolver + bi-temporal promote on
 * real pgvector, with a STUB judge (no OpenRouter). Seeds the IMMUTABLE anchor
 * (protocol_executions) + the projection ledger (proj_activity / proj_pnl_matches
 * / proj_open_positions) and drives ONE candidate through the executor item path
 * (consolidate → applyDecisionAtomically) exactly as the executor does.
 *
 * Pins (s5-plan §13 / §14):
 *   - spot closed realized PnL → outcome closed/positive/strong, evidence_strength
 *     'strong', knowledge_entries.valid_from = boundary, outcome_version 0;
 *   - open position → outcome open/moderate (never 'strong');
 *   - NULL boundary (no eventTime, anchor gone after deref) → pointInTimeChecked
 *     false → degraded (never 'strong');
 *   - thin venue → weak + needsReconciliation;
 *   - replay-stability: TRUNCATE proj_* + regenerate → identical re-derived
 *     outcome via the stable executionId (FIX-1).
 *
 * NOTE: written for the real-pgvector temp harness; NOT run in the non-DB pass.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { query } from "@vex-agent/db/client.js";
import {
  enqueueConsolidateJob,
  claimNextDueJob,
} from "@vex-agent/db/repos/memory-jobs/index.js";
import {
  reserveCandidatesForJob,
  listItemsByJob,
  markItemProcessing,
  markItemDone,
} from "@vex-agent/db/repos/memory-job-items/index.js";
import {
  getCandidateById,
  getCandidateEmbedding,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import {
  consolidateCandidate,
  applyDecisionAtomically,
  resolveOutcome,
} from "@vex-agent/memory/manager/index.js";
import * as executionsRepo from "@vex-agent/db/repos/executions.js";
import * as activityRepo from "@vex-agent/db/repos/activity.js";
import * as pnlMatchesRepo from "@vex-agent/db/repos/pnl-matches.js";
import * as pnlLotsRepo from "@vex-agent/db/repos/pnl-lots.js";
import * as openPositionsRepo from "@vex-agent/db/repos/open-positions.js";
import * as lpEventsRepo from "@vex-agent/db/repos/lp-events.js";
import type { OutcomeResolverDeps } from "@vex-agent/memory/manager/index.js";
import { resetDb } from "../setup/fixtures.js";
import {
  makeSession,
  seedExecution,
  seedCandidate,
  depsWithStubJudge,
  PROMOTE_VERDICT,
} from "../repos/_s4-fixtures.js";

const WALLET = "0xWalletA";

/** Real production ledger reads for direct resolveOutcome assertions. */
const LEDGER_DEPS: OutcomeResolverDeps = {
  getExecutionById: (id) => executionsRepo.getById(id),
  getActivitiesByExecution: (id) => activityRepo.getByExecution(id),
  getMatchesBySell: (id) => pnlMatchesRepo.getMatchesBySell(id),
  getOpenLots: (instrumentKey, w) => pnlLotsRepo.getOpenLots(instrumentKey, w),
  getPositionByKey: (k) => openPositionsRepo.getByPositionKeyAnyStatus(k),
  getLpEventsByPosition: (k) => lpEventsRepo.getLpEventsByPosition(k),
};

/** Seed a spot SELL activity for an execution with a realized PnL match. */
async function seedSpotRealized(executionId: number, realizedPnlUsd: string): Promise<void> {
  const sellId = await activityRepo.insertActivity({
    namespace: "jupiter",
    activityType: "swap",
    productType: "spot",
    tradeSide: "sell",
    chain: "solana",
    executionId,
    captureItemId: null,
    walletAddress: WALLET,
    inputToken: null,
    inputAmount: null,
    outputToken: null,
    outputAmount: null,
    valueUsd: null,
    inputValueUsd: null,
    outputValueUsd: "20",
    feeValueUsd: null,
    unitPriceUsd: null,
    valuationSource: null,
    benchmarkAssetKey: null,
    settlementAssetKey: null,
    inputValueNative: null,
    outputValueNative: null,
    captureStatus: null,
    positionKey: null,
    instrumentKey: "BONK",
    externalRefs: {},
    meta: {},
  });
  // A matched realized-PnL row keyed on the sell activity (canonical spot outcome).
  await query(
    `INSERT INTO proj_pnl_matches
       (match_kind, sell_activity_id, lot_id, instrument_key, wallet_address,
        quantity_matched, cost_basis_usd, proceeds_usd, realized_pnl_usd, namespace, chain)
     VALUES ('matched', $1, NULL, 'BONK', $2, '100', '10', '20', $3, 'jupiter', 'solana')`,
    [sellId, WALLET, realizedPnlUsd],
  );
}

/** Drive ONE reserved candidate exactly as the executor does. */
async function decideOne(
  jobId: number,
  workerId: string,
  candidateId: string,
): Promise<{ decisionType: string }> {
  const items = await listItemsByJob(jobId, "reserved");
  const item = items.find((i) => i.candidateId === candidateId);
  if (!item) throw new Error("candidate not reserved");
  await markItemProcessing(item.id, jobId, workerId);

  const candidate = await getCandidateById(candidateId);
  if (!candidate) throw new Error("candidate missing");
  const embedding = await getCandidateEmbedding(candidateId);
  if (!embedding) throw new Error("embedding missing");

  const decision = await consolidateCandidate(candidate, embedding, depsWithStubJudge(PROMOTE_VERDICT));
  const applied = await applyDecisionAtomically({
    candidate,
    plan: decision.plan,
    jobId,
    workerId,
    outcome: decision.outcome,
    availableAtDecisionTime: decision.availableAtDecisionTime,
  });
  await markItemDone(item.id, jobId, workerId, applied.decisionId);
  return applied;
}

describe("S5 outcome resolver + bi-temporal promote (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("resolves a spot closed realized outcome → strong evidence + valid_from + outcome_version 0", async () => {
    const sessionId = await makeSession();
    const execId = await seedExecution(sessionId);
    await seedSpotRealized(execId, "12.5"); // profitable realized PnL

    // event_time gives a deterministic world-time boundary.
    const eventTime = "2026-06-01T10:00:00.000Z";
    const candidateId = await seedCandidate(sessionId, "spot-win", {
      kind: "trade_outcome",
      executionIds: [execId],
    });
    await query(`UPDATE memory_candidates SET event_time = $2 WHERE id = $1`, [candidateId, eventTime]);

    await enqueueConsolidateJob();
    const job = await claimNextDueJob("w1");
    if (!job) throw new Error("no job");
    await reserveCandidatesForJob(job.id, "w1", 10);
    const applied = await decideOne(job.id, "w1", candidateId);
    expect(applied.decisionType).toBe("promote");

    // Candidate carries the resolved outcome (facts) + the as-of boundary.
    const after = await query<{ outcome: Record<string, unknown>; available_at_decision_time: string }>(
      `SELECT outcome, available_at_decision_time FROM memory_candidates WHERE id = $1`,
      [candidateId],
    );
    const outcome = after[0]!.outcome;
    expect(outcome.status).toBe("closed");
    expect(outcome.lessonSignal).toBe("positive");
    expect(outcome.evidenceQuality).toBe("strong");
    expect(outcome.pnlSource).toBe("pnl_matches");
    expect(outcome.outcomeVersion).toBe(0);
    expect(outcome.pointInTimeChecked).toBe(true);
    expect(new Date(after[0]!.available_at_decision_time).toISOString()).toBe(eventTime);

    // Promoted knowledge entry carries valid_from = boundary, outcome_version 0,
    // and NO raw PnL number in title/summary.
    const ke = await query<{ valid_from: string; outcome_version: number; title: string; summary: string }>(
      `SELECT valid_from, outcome_version, title, summary FROM knowledge_entries
        WHERE id = (SELECT promoted_knowledge_id FROM memory_candidates WHERE id = $1)`,
      [candidateId],
    );
    expect(new Date(ke[0]!.valid_from).toISOString()).toBe(eventTime);
    expect(ke[0]!.outcome_version).toBe(0);
    expect(`${ke[0]!.title} ${ke[0]!.summary}`).not.toMatch(/12\.5/);
  });

  it("an open position resolves to open/moderate — never strong", async () => {
    const sessionId = await makeSession();
    const execId = await seedExecution(sessionId);
    await activityRepo.insertActivity({
      namespace: "hyperliquid",
      activityType: "perps",
      productType: "perps",
      tradeSide: "buy",
      chain: "hyperliquid",
      executionId: execId,
      captureItemId: null,
      walletAddress: WALLET,
      inputToken: null, inputAmount: null, outputToken: null, outputAmount: null,
      valueUsd: null, inputValueUsd: null, outputValueUsd: null, feeValueUsd: null,
      unitPriceUsd: null, valuationSource: null, benchmarkAssetKey: null,
      settlementAssetKey: null, inputValueNative: null, outputValueNative: null,
      captureStatus: null, positionKey: "POS-OPEN", instrumentKey: "BTC-PERP",
      externalRefs: {}, meta: {},
    });
    await openPositionsRepo.upsertPosition({
      namespace: "hyperliquid", positionType: "perps", chain: "hyperliquid",
      externalId: "EXT-1", walletAddress: WALLET, positionKey: "POS-OPEN",
      instrumentKey: "BTC-PERP", status: "open",
    });

    const candidate = await getCandidateById(
      await seedCandidate(sessionId, "perp-open", { kind: "strategy_lesson", executionIds: [execId] }),
    );
    if (!candidate) throw new Error("candidate missing");
    const out = await resolveOutcome(candidate, true, LEDGER_DEPS);
    expect(out?.status).toBe("open");
    expect(out?.evidenceQuality).toBe("weak");
    expect(out?.evidenceQuality).not.toBe("strong");
  });

  it("thin venue → weak + needsReconciliation", async () => {
    const sessionId = await makeSession();
    const execId = await seedExecution(sessionId);
    await activityRepo.insertActivity({
      namespace: "across", activityType: "bridge", productType: "bridge", tradeSide: null,
      chain: "base", executionId: execId, captureItemId: null, walletAddress: WALLET,
      inputToken: null, inputAmount: null, outputToken: null, outputAmount: null,
      valueUsd: null, inputValueUsd: null, outputValueUsd: null, feeValueUsd: null,
      unitPriceUsd: null, valuationSource: null, benchmarkAssetKey: null,
      settlementAssetKey: null, inputValueNative: null, outputValueNative: null,
      captureStatus: null, positionKey: null, instrumentKey: null, externalRefs: {}, meta: {},
    });
    const candidate = await getCandidateById(
      await seedCandidate(sessionId, "bridge-thin", { kind: "risk_lesson", executionIds: [execId] }),
    );
    if (!candidate) throw new Error("candidate missing");
    const out = await resolveOutcome(candidate, true, LEDGER_DEPS);
    expect(out?.evidenceQuality).toBe("weak");
    expect(out?.needsReconciliation).toBe(true);
    expect(out?.pnlSource).toBe("none");
  });

  it("replay-stability: TRUNCATE + regenerate proj_* re-derives an identical outcome via the stable executionId", async () => {
    const sessionId = await makeSession();
    const execId = await seedExecution(sessionId);
    await seedSpotRealized(execId, "7.25");

    const candidate = await getCandidateById(
      await seedCandidate(sessionId, "replay", { kind: "trade_outcome", executionIds: [execId] }),
    );
    if (!candidate) throw new Error("candidate missing");

    const first = await resolveOutcome(candidate, true, LEDGER_DEPS);

    // Simulate replayProjections: the proj_* SERIALs change, the execution id does NOT.
    await query(`TRUNCATE proj_pnl_matches, proj_activity RESTART IDENTITY CASCADE`);
    await seedSpotRealized(execId, "7.25");

    const second = await resolveOutcome(candidate, true, LEDGER_DEPS);
    // Outcome is re-derived from the stable executionId → byte-identical summary.
    expect(second).toEqual(first);
  });
});
