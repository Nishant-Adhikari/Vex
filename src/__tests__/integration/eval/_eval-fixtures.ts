/**
 * Faithful eval-only seeders (Phase 0). NOT a test file (underscore prefix).
 *
 * These drive the PRODUCTION seam — `recordExecution` → `populateCaptureItems`
 * (→ activity-populator → projectors → proj_pnl_lots / proj_pnl_matches /
 * proj_open_positions) — exactly like the live runtime, so the S5 outcome
 * resolver and the S7 ledger-wake fire on REAL ledger rows. They are named
 * `seedFaithful*` so they can never be confused with the raw-SQL legacy seeders
 * in `repos/_s4-fixtures.ts` (those are left untouched).
 *
 * Embeddings: the candidate/knowledge seeders embed title+summary with the REAL
 * Gemma (`embedDocument`) and store the real providerModel + dim 768 — NOT the
 * dim-8 `test-model` fixtures (those would give recall precision 0 against the
 * live providerModel/dim).
 */

import { recordExecution } from "@vex-agent/db/repos/executions.js";
import { populateCaptureItems } from "@vex-agent/tools/protocols/capture-pipeline.js";
import { extractExternalRefs } from "@vex-agent/tools/protocols/capture-pipeline.js";
import { execute, query } from "@vex-agent/db/client.js";
import {
  insertCandidate,
  getCandidateById,
  getCandidateEmbedding,
  type InsertCandidateInput,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
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
  consolidateCandidate,
  applyDecisionAtomically,
  defaultConsolidateDeps,
} from "@vex-agent/memory/manager/index.js";
import { bumpJobInference } from "@vex-agent/db/repos/memory-jobs/index.js";
import { getLatestDecision } from "@vex-agent/db/repos/memory-decisions/index.js";
import { embedDocument } from "@vex-agent/embeddings/client.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import { insertEntry } from "@vex-agent/db/repos/knowledge.js";
import type { EvidenceRefs } from "@vex-agent/memory/schema/memory-candidate.js";
import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";
import type {
  DecayPolicy,
  InfluenceScope,
  MaturityState,
} from "@vex-agent/memory/schema/long-memory-enums.js";
import { makeSession } from "../setup/fixtures.js";

const NAMESPACE = "solana";
const CHAIN = "solana";

/** Live Gemma dim — must match EMBEDDING_DIM in eval-setup. */
export const GEMMA_DIM = 768;

// ── Faithful confirmed SPOT trade (buy lot → sell match → realized PnL) ──

export interface FaithfulSpotArgs {
  sessionId: string;
  instrumentKey: string;
  walletAddress: string;
  /** Raw integer string of base-asset units bought. */
  buyQtyRaw: string;
  /** Decimal string USD paid (cost basis). */
  buyValueUsd: string;
  /** Raw integer string of base-asset units sold (≤ buyQtyRaw for a full match). */
  sellQtyRaw: string;
  /** Decimal string USD proceeds → drives realized_pnl_usd. */
  sellValueUsd: string;
}

export interface FaithfulSpotResult {
  buyExecutionId: number;
  sellExecutionId: number;
  instrumentKey: string;
  walletAddress: string;
}

/**
 * Drive a real confirmed spot trade through the production capture seam. The buy
 * opens a `proj_pnl_lots` lot; the sell creates a `proj_pnl_matches`
 * `match_kind='matched'` row with non-null `realized_pnl_usd`.
 *
 * Token amounts are RAW INTEGER STRINGS; USD values are DECIMAL STRINGS (numbers
 * would leave the NUMERIC column NULL and break the projector math). The
 * camelCase `tradeSide` is explicit — a bare tool id never derives the side.
 */
export async function seedFaithfulConfirmedSpotTrade(
  args: FaithfulSpotArgs,
): Promise<FaithfulSpotResult> {
  const buyCapture: Record<string, unknown> = {
    type: "swap",
    tradeSide: "buy",
    chain: CHAIN,
    walletAddress: args.walletAddress,
    instrumentKey: args.instrumentKey,
    inputTokenAddress: "So11111111111111111111111111111111111111112", // wSOL (cost asset)
    outputTokenAddress: args.instrumentKey,
    inputAmount: args.buyValueUsd, // not load-bearing for the lot
    outputAmount: args.buyQtyRaw, // raw base units bought → lot quantity
    inputValueUsd: args.buyValueUsd, // cost basis (decimal string)
    outputValueUsd: args.buyValueUsd,
    unitPriceUsd: "0.05",
    valuationSource: "jupiter_exact",
    status: "executed",
  };
  const buyRefs = { instrumentKey: args.instrumentKey };
  const buyExecutionId = await recordExecution(
    "solana.swap.execute",
    NAMESPACE,
    args.sessionId,
    { side: "buy" },
    { signature: `buy-${args.instrumentKey}` },
    true,
    buyCapture,
    extractExternalRefs({ _tradeCapture: buyCapture, ...buyRefs }),
    100,
  );
  await populateCaptureItems(
    buyExecutionId,
    "solana.swap.execute",
    NAMESPACE,
    buyCapture,
    undefined,
    extractExternalRefs({ _tradeCapture: buyCapture, ...buyRefs }),
  );

  const sellCapture: Record<string, unknown> = {
    type: "swap",
    tradeSide: "sell",
    chain: CHAIN,
    walletAddress: args.walletAddress,
    instrumentKey: args.instrumentKey,
    inputTokenAddress: args.instrumentKey,
    outputTokenAddress: "So11111111111111111111111111111111111111112",
    inputAmount: args.sellQtyRaw, // raw base units to sell → FIFO match qty
    outputAmount: args.sellValueUsd,
    inputValueUsd: args.sellValueUsd,
    outputValueUsd: args.sellValueUsd, // total proceeds → realized_pnl_usd
    unitPriceUsd: "0.06",
    valuationSource: "jupiter_exact",
    status: "executed",
  };
  const sellRefs = { instrumentKey: args.instrumentKey };
  const sellExecutionId = await recordExecution(
    "solana.swap.execute",
    NAMESPACE,
    args.sessionId,
    { side: "sell" },
    { signature: `sell-${args.instrumentKey}` },
    true,
    sellCapture,
    extractExternalRefs({ _tradeCapture: sellCapture, ...sellRefs }),
    100,
  );
  await populateCaptureItems(
    sellExecutionId,
    "solana.swap.execute",
    NAMESPACE,
    sellCapture,
    undefined,
    extractExternalRefs({ _tradeCapture: sellCapture, ...sellRefs }),
  );

  return {
    buyExecutionId,
    sellExecutionId,
    instrumentKey: args.instrumentKey,
    walletAddress: args.walletAddress,
  };
}

/** Probe the live projector: did a matched, realized row land for this instrument? */
export async function countMatchedRealized(
  instrumentKey: string,
  walletAddress: string,
): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM proj_pnl_matches
       WHERE instrument_key = $1 AND wallet_address = $2
         AND match_kind = 'matched' AND realized_pnl_usd IS NOT NULL`,
    [instrumentKey, walletAddress],
  );
  return Number(rows[0]!.n);
}

// ── Faithful CLOSED perps position (open → close → signed MTM) ──────

export interface FaithfulPerpsArgs {
  sessionId: string;
  positionKey: string;
  instrumentKey: string;
  walletAddress: string;
  /** Decimal string. Signed MTM written AFTER close (medium-quality outcome). */
  closedPnlUsd: string;
}

export interface FaithfulPerpsResult {
  openExecutionId: number;
  closeExecutionId: number;
  positionKey: string;
}

/**
 * Drive a real perps position open then close through the capture seam. Because
 * `closePosition` NULLs `unrealized_pnl_usd`, we write a signed MTM AFTER the
 * close (direct UPDATE) so the perps lesson signal is non-neutral. The S5
 * resolver caps a closed perps outcome at `medium` quality (MTM, not FIFO).
 */
export async function seedClosedPerpsPosition(
  args: FaithfulPerpsArgs,
): Promise<FaithfulPerpsResult> {
  const openCapture: Record<string, unknown> = {
    type: "perps",
    chain: CHAIN,
    walletAddress: args.walletAddress,
    instrumentKey: args.instrumentKey,
    positionKey: args.positionKey,
    unitPriceUsd: "1.00",
    inputValueUsd: "100.00",
    feeValueUsd: "0.10",
    status: "open",
    meta: { side: "long" },
  };
  const openRefs = { instrumentKey: args.instrumentKey, positionKey: args.positionKey };
  const openExecutionId = await recordExecution(
    "perps.open",
    NAMESPACE,
    args.sessionId,
    {},
    {},
    true,
    openCapture,
    extractExternalRefs({ _tradeCapture: openCapture, ...openRefs }),
    100,
  );
  await populateCaptureItems(
    openExecutionId,
    "perps.open",
    NAMESPACE,
    openCapture,
    undefined,
    extractExternalRefs({ _tradeCapture: openCapture, ...openRefs }),
  );

  const closeCapture: Record<string, unknown> = {
    type: "perps",
    chain: CHAIN,
    walletAddress: args.walletAddress,
    instrumentKey: args.instrumentKey,
    positionKey: args.positionKey,
    unitPriceUsd: "1.10",
    status: "closed",
    meta: { side: "long" },
  };
  const closeRefs = { instrumentKey: args.instrumentKey, positionKey: args.positionKey };
  const closeExecutionId = await recordExecution(
    "perps.close",
    NAMESPACE,
    args.sessionId,
    {},
    {},
    true,
    closeCapture,
    extractExternalRefs({ _tradeCapture: closeCapture, ...closeRefs }),
    100,
  );
  await populateCaptureItems(
    closeExecutionId,
    "perps.close",
    NAMESPACE,
    closeCapture,
    undefined,
    extractExternalRefs({ _tradeCapture: closeCapture, ...closeRefs }),
  );

  // closePosition NULLed unrealized_pnl_usd — write the signed MTM back so the
  // resolver derives a signed lesson signal (medium ceiling, never strong).
  await execute(
    `UPDATE proj_open_positions SET unrealized_pnl_usd = $1
       WHERE position_key = $2 AND status = 'closed'`,
    [args.closedPnlUsd, args.positionKey],
  );

  return {
    openExecutionId,
    closeExecutionId,
    positionKey: args.positionKey,
  };
}

// ── Faithful closing trade that FLIPS the ledger (S7 wake) ──────────

export interface FaithfulClosingTradeArgs {
  sessionId: string;
  instrumentKey: string;
  walletAddress: string;
  /** Decimal string USD proceeds for the flipping sell. */
  sellValueUsd: string;
  /** Raw integer string units sold. */
  sellQtyRaw: string;
}

/**
 * A NEW confirmed closing trade carrying the SAME semantic key (instrumentKey)
 * via `populateCaptureItems` → fires `enqueueLedgerWake` exactly like production.
 * Used to flip a promoted lesson's outcome and trigger an S7 reconcile job.
 */
export async function seedFaithfulClosingTradeForWake(
  args: FaithfulClosingTradeArgs,
): Promise<{ executionId: number }> {
  const sellCapture: Record<string, unknown> = {
    type: "swap",
    tradeSide: "sell",
    chain: CHAIN,
    walletAddress: args.walletAddress,
    instrumentKey: args.instrumentKey,
    inputTokenAddress: args.instrumentKey,
    outputTokenAddress: "So11111111111111111111111111111111111111112",
    inputAmount: args.sellQtyRaw,
    outputAmount: args.sellValueUsd,
    inputValueUsd: args.sellValueUsd,
    outputValueUsd: args.sellValueUsd,
    unitPriceUsd: "0.04",
    valuationSource: "jupiter_exact",
    status: "executed",
  };
  const refs = { instrumentKey: args.instrumentKey };
  const executionId = await recordExecution(
    "solana.swap.execute",
    NAMESPACE,
    args.sessionId,
    { side: "sell" },
    { signature: `flip-${args.instrumentKey}` },
    true,
    sellCapture,
    extractExternalRefs({ _tradeCapture: sellCapture, ...refs }),
    100,
  );
  await populateCaptureItems(
    executionId,
    "solana.swap.execute",
    NAMESPACE,
    sellCapture,
    undefined,
    extractExternalRefs({ _tradeCapture: sellCapture, ...refs }),
  );
  return { executionId };
}

// ── Real-Gemma candidate seeder ─────────────────────────────────────

export interface SeedGemmaCandidateOpts {
  sessionId: string;
  kind?: string;
  title: string;
  summary: string;
  contentMd?: string;
  evidenceRefs?: EvidenceRefs;
  importance?: number;
  confidence?: number | null;
  eventTime?: Date | null;
  source?: InsertCandidateInput["source"];
}

/**
 * Insert ONE pending candidate whose embedding is the REAL Gemma vector of
 * title+summary, with the real providerModel + dim. Used wherever recall
 * precision or judge escalation must match the live provider/dim.
 */
export async function seedGemmaCandidate(
  opts: SeedGemmaCandidateOpts,
): Promise<{ candidateId: string; providerModel: string }> {
  const kind = opts.kind ?? "strategy_lesson";
  const contentMd = opts.contentMd ?? "Process narrative only.";
  const { embedding, providerModel } = await embedDocument(opts.title, opts.summary);
  const input: InsertCandidateInput = {
    sessionId: opts.sessionId,
    proposedBy: "parent",
    kind,
    title: opts.title,
    summary: opts.summary,
    contentMd,
    entities: [],
    tags: [],
    sourceRefs: { messageIds: [] },
    evidenceRefs: opts.evidenceRefs ?? [],
    source: opts.source ?? "hypothesis",
    confidence: opts.confidence === undefined ? 0.7 : opts.confidence,
    importance: opts.importance ?? 7,
    sensitivity: "normal",
    evidenceStrength: "none",
    retrievalVisibility: "not_consolidated",
    retrievalUntil: null,
    retainUntil: null,
    embedding,
    embeddingModel: providerModel,
    embeddingDim: embedding.length,
    contentHash: computeContentHash({ kind, title: opts.title, summary: opts.summary, contentMd }),
    eventTime: opts.eventTime ?? null,
    observedAt: null,
    availableAtDecisionTime: null,
  };
  const { candidate } = await insertCandidate(input);
  return { candidateId: candidate.id, providerModel };
}

/**
 * Insert an ACTIVE knowledge entry directly with a REAL Gemma vector — for
 * retrieval-precision corpora that don't need a full promote path. `status`,
 * `source`, `maturityState`, `validUntil`, and `pinned` are settable so a suite
 * can characterize hot-context / expiry / supersede behavior.
 */
export interface SeedGemmaKnowledgeOpts {
  kind?: string;
  title: string;
  summary: string;
  source?: string;
  maturityState?: string;
  activationStrength?: number;
  status?: string;
  validUntil?: Date | null;
  pinned?: boolean;
}

export async function seedGemmaKnowledgeEntry(
  opts: SeedGemmaKnowledgeOpts,
): Promise<{ id: number; providerModel: string }> {
  const kind = opts.kind ?? "trade_lesson";
  const { embedding, providerModel } = await embedDocument(opts.title, opts.summary);
  const contentHash = computeContentHash({
    kind,
    title: opts.title,
    summary: opts.summary,
    contentMd: "",
  });
  const vectorLiteral = `[${embedding.join(",")}]`;
  const rows = await query<{ id: number }>(
    `INSERT INTO knowledge_entries
       (kind, title, summary, content_md, content_hash, embedding_model, embedding_dim, embedding,
        source, status, maturity_state, activation_strength, influence_scope, decay_policy,
        valid_from, valid_until, pinned, first_promoted_at, last_reinforced_at, outcome_version)
     VALUES ($1, $2, $3, '', $4, $5, $6, $7::vector,
        $8, $9, $10, $11, 'advisory', 'none',
        NOW(), $12, $13, NOW(), NOW(), 0)
     RETURNING id`,
    [
      kind,
      opts.title,
      opts.summary,
      contentHash,
      providerModel,
      embedding.length,
      vectorLiteral,
      opts.source ?? "observed",
      opts.status ?? "active",
      opts.maturityState ?? "established",
      opts.activationStrength ?? 1.0,
      opts.validUntil ?? null,
      opts.pinned ?? false,
    ],
  );
  return { id: rows[0]!.id, providerModel };
}

// ── Direct-promote seeder (faithful insertEntry + real Gemma — bypass judge) ──

export interface SeedPromotedLessonDirectOpts {
  kind?: string;
  title: string;
  summary: string;
  contentMd?: string;
  /** Provenance tier. `observed`/`user_confirmed` are hot-context-eligible. */
  source?: KnowledgeSource;
  /** Lesson-confidence FSM tier. `probationary` is excluded from hot context. */
  maturityState?: MaturityState;
  activationStrength?: number;
  influenceScope?: InfluenceScope;
  decayPolicy?: DecayPolicy;
  /** Bi-temporal expiry. NULL = no TTL (the F1 case). A past date = expired. */
  validUntil?: Date | null;
  /** Bi-temporal validity floor. Defaults to NOW(). */
  validFrom?: Date;
  pinned?: boolean;
  /** Source-refs (kept for parity; never carries the FIX-1 anchor — that's evidenceRefs on the candidate). */
  sourceRefs?: Record<string, unknown>;
  outcomeVersion?: number;
  regimeTags?: string[];
}

/**
 * Insert a PROMOTED knowledge entry directly through the REAL `insertEntry`
 * repo with a REAL Gemma embedding (embedDocument, dim 768, real providerModel)
 * — deterministically reproducing the end-state the judge would otherwise
 * produce, WITHOUT depending on the (F31-broken) live judge. Faithful because it
 * uses the production insert path + real embeddings; only the judge verdict is
 * short-circuited. Lifecycle/retrieval/reconcile scenarios seed with this so
 * they run green regardless of the judge's model-compat state.
 *
 * Returns the inserted entry id + the real provider model string (for the
 * recall model/dim filter).
 */
export async function seedPromotedLessonDirect(
  opts: SeedPromotedLessonDirectOpts,
): Promise<{ id: number; providerModel: string; contentHash: string }> {
  const kind = opts.kind ?? "trade_lesson";
  const contentMd = opts.contentMd ?? "";
  const { embedding, providerModel } = await embedDocument(opts.title, opts.summary);
  const contentHash = computeContentHash({
    kind,
    title: opts.title,
    summary: opts.summary,
    contentMd,
  });
  const { entry } = await insertEntry({
    kind,
    title: opts.title,
    summary: opts.summary,
    contentMd,
    tags: [],
    sourceRefs: opts.sourceRefs ?? {},
    confidence: null,
    pinned: opts.pinned ?? false,
    validUntil: opts.validUntil ?? null,
    ...(opts.validFrom ? { validFrom: opts.validFrom } : {}),
    contentHash,
    embeddingModel: providerModel,
    embeddingDim: embedding.length,
    embedding,
    source: opts.source ?? "observed",
    maturityState: opts.maturityState ?? "established",
    activationStrength: opts.activationStrength ?? 1.0,
    influenceScope: opts.influenceScope ?? "advisory",
    decayPolicy: opts.decayPolicy ?? "none",
    regimeTags: opts.regimeTags ?? [],
    outcomeVersion: opts.outcomeVersion ?? 0,
  });
  return { id: entry.id, providerModel, contentHash };
}

// ── The pipeline driver (synchronous decideOneItem with the REAL judge) ──

export interface DriveResult {
  decisionType: string;
  decisionId: string;
  promotedKnowledgeId: number | null;
  llmCalls: number;
  costUsd: number | null;
  latencyMs: number;
  jobId: number;
}

/**
 * Drive ONE candidate through the executor's item path with the REAL judge and
 * the REAL graph extractor (default deps): enqueue → claim → reserve → list →
 * markProcessing → consolidate (live DeepSeek) → applyDecisionAtomically (full
 * arg shape so S5 + S8 run) → bumpJobInference (mirror) → markItemDone.
 *
 * Returns the resolved decision + judge telemetry. `llmCalls > 0` is the
 * judge-ran proof; cost is best-effort (nullable).
 */
export async function driveConsolidateWithRealJudge(
  candidateId: string,
  workerId: string,
): Promise<DriveResult> {
  await enqueueConsolidateJob();
  const job = await claimNextDueJob(workerId);
  if (!job) throw new Error("driveConsolidate: no consolidate job");
  await reserveCandidatesForJob(job.id, workerId, 16);

  const items = await listItemsByJob(job.id, "reserved");
  const item = items.find((i) => i.candidateId === candidateId);
  if (!item) throw new Error("driveConsolidate: candidate not reserved");
  const ok = await markItemProcessing(item.id, job.id, workerId);
  if (!ok) throw new Error("driveConsolidate: markItemProcessing failed");

  const candidate = await getCandidateById(candidateId);
  if (!candidate) throw new Error("driveConsolidate: candidate missing");
  const embedding = await getCandidateEmbedding(candidateId);
  if (!embedding) throw new Error("driveConsolidate: embedding missing");

  const startedAt = Date.now();
  const decision = await consolidateCandidate(
    candidate,
    embedding,
    defaultConsolidateDeps(),
  );
  const latencyMs = Date.now() - startedAt;

  const applied = await applyDecisionAtomically({
    candidate,
    plan: decision.plan,
    jobId: job.id,
    workerId,
    outcome: decision.outcome,
    availableAtDecisionTime: decision.availableAtDecisionTime,
    reinforce: decision.reinforce,
    graphPlan: decision.graphPlan,
  });

  // Mirror the executor's job-inference bump so llmCalls/costUsd land on the job.
  if (decision.llmCalls > 0 || decision.costUsd !== null) {
    await bumpJobInference(job.id, {
      llmCalls: decision.llmCalls,
      ...(decision.costUsd !== null ? { costUsd: decision.costUsd } : {}),
    });
  }

  await markItemDone(item.id, job.id, workerId, applied.decisionId);

  const after = await getCandidateById(candidateId);
  return {
    decisionType: applied.decisionType,
    decisionId: applied.decisionId,
    promotedKnowledgeId: after?.promotedKnowledgeId ?? null,
    llmCalls: decision.llmCalls,
    costUsd: decision.costUsd,
    latencyMs,
    jobId: job.id,
  };
}

// ── F31-aware capturing driver (RECORD schema-invalid, never crash) ──

/** Bounded judge-failure category — never carries raw model text (memLog-safe). */
export type JudgeFailureReason =
  | "schema_invalid"
  | "judge_timeout"
  | "judge_malformed"
  | "provider_config"
  | "judge_unknown";

/**
 * Outcome of one judge-path drive that captures F31:
 *   - `reached` — the candidate escalated and a judge call was attempted. True
 *     on BOTH a valid verdict AND a thrown `memory_judge_*` error (only the
 *     judge path raises those; a deterministic terminal never does).
 *   - `verdictValid` — a verdict validated against `judgeVerdictSchema`.
 *   - `drive` — present iff a verdict validated (the deterministic post-conditions
 *     are asserted off this); absent when the judge threw.
 *   - `invalidReason` — the bounded category when reached but not valid.
 *   - `latencyMs` — wall-clock of the consolidate call (judge round-trip), even
 *     on a thrown verdict (so a 30s timeout is measured, not hidden).
 */
export interface CapturedJudgeDrive {
  reached: boolean;
  verdictValid: boolean;
  invalidReason: JudgeFailureReason | null;
  drive: DriveResult | null;
  latencyMs: number;
}

/**
 * Map a thrown error to a bounded judge-failure reason. The judge throws
 * `memory_judge_schema_invalid` / `memory_judge_timeout` /
 * `memory_judge_malformed_json` / `memory_judge_provider_config_load_failed`
 * (judge.ts). A non-`memory_judge_*` error is re-classified `judge_unknown` —
 * but the caller only treats a `memory_judge_*` message as "reached".
 */
function classifyJudgeError(err: unknown): {
  isJudge: boolean;
  reason: JudgeFailureReason;
} {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("memory_judge_schema_invalid")) {
    return { isJudge: true, reason: "schema_invalid" };
  }
  if (msg.includes("memory_judge_timeout")) {
    return { isJudge: true, reason: "judge_timeout" };
  }
  if (msg.includes("memory_judge_malformed")) {
    return { isJudge: true, reason: "judge_malformed" };
  }
  if (msg.includes("memory_judge_provider_config")) {
    return { isJudge: true, reason: "provider_config" };
  }
  return { isJudge: false, reason: "judge_unknown" };
}

/**
 * Drive ONE candidate through the judge path, CAPTURING F31. A thrown
 * `memory_judge_*` error (schema-invalid / timeout / malformed) is caught and
 * reported as `{ reached:true, verdictValid:false, invalidReason }` — NEVER
 * propagated as a test failure. A successful verdict returns
 * `{ reached:true, verdictValid:true, drive }`. A NON-judge throw (a real bug in
 * seeding/apply) is re-thrown so it still fails loudly.
 *
 * The escalation/reach signal is the thrown `memory_judge_*` message itself (only
 * the judge path raises it) OR `llmCalls>0` on success. With
 * deepseek/deepseek-v4-flash today, valid-rate ≈ 0% and that IS the measured F31
 * result.
 */
export async function driveConsolidateCapturingJudge(
  candidateId: string,
  workerId: string,
): Promise<CapturedJudgeDrive> {
  const startedAt = Date.now();
  try {
    const drive = await driveConsolidateWithRealJudge(candidateId, workerId);
    // A deterministic terminal returns llmCalls=0 — that means the candidate did
    // NOT escalate (the judge was never reached). The caller asserts on `reached`.
    const reached = drive.llmCalls > 0;
    return {
      reached,
      verdictValid: reached,
      invalidReason: null,
      drive,
      latencyMs: drive.latencyMs,
    };
  } catch (err: unknown) {
    const { isJudge, reason } = classifyJudgeError(err);
    if (!isJudge) throw err; // a non-judge error is a real bug — fail loudly.
    return {
      reached: true,
      verdictValid: false,
      invalidReason: reason,
      drive: null,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/**
 * Cosine similarity between the REAL Gemma embeddings of two title+summary
 * pairs — the F32 same-lesson-cosine signal. embedDocument returns unit-norm
 * vectors, so a plain dot product is the cosine. No DB round-trip.
 */
export async function measureSameLessonCosine(
  a: { title: string; summary: string },
  b: { title: string; summary: string },
): Promise<number> {
  const [ea, eb] = await Promise.all([
    embedDocument(a.title, a.summary),
    embedDocument(b.title, b.summary),
  ]);
  const va = ea.embedding;
  const vb = eb.embedding;
  const n = Math.min(va.length, vb.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += va[i]! * vb[i]!;
    na += va[i]! * va[i]!;
    nb += vb[i]! * vb[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Run the REAL consolidate→apply path to a genuine promote so an S7 reconcile
 * can target it: seeds a sibling (recurrence ≥ 2) in the same Gemma neighborhood
 * + a confirmed spot trade whose SELL execution anchors the candidate, then
 * drives the judge. Returns the promoted knowledge id (or throws if the judge
 * did not promote). The promoted entry's evidence_refs carry the instrumentKey
 * semantic key so `findPromotedWakeTargets` matches the later closing trade.
 */
export interface PromoteForReconcileArgs {
  instrumentKey: string;
  walletAddress: string;
  workerId: string;
}

export interface PromoteForReconcileResult {
  knowledgeId: number;
  candidateId: string;
  sellExecutionId: number;
  drive: DriveResult;
}

export async function promoteLessonForReconcile(
  args: PromoteForReconcileArgs,
): Promise<PromoteForReconcileResult> {
  const session = await makeSession();
  const spot = await seedFaithfulConfirmedSpotTrade({
    sessionId: session,
    instrumentKey: args.instrumentKey,
    walletAddress: args.walletAddress,
    buyQtyRaw: "1000000000",
    buyValueUsd: "50.00",
    sellQtyRaw: "1000000000",
    sellValueUsd: "75.00", // win → positive lesson signal
  });

  // A sibling in the same Gemma neighborhood + a 2nd execution anchor so the
  // recurrence gate (≥2) is satisfied for the generalization kind.
  await seedGemmaCandidate({
    sessionId: session,
    kind: "trade_lesson",
    title: `Scaling into ${args.instrumentKey} strength paid off across the run`,
    summary:
      "Adding to a winning spot position on confirmed momentum produced realized gains.",
    evidenceRefs: [
      { executionId: spot.buyExecutionId, instrumentKey: args.instrumentKey },
    ],
    importance: 8,
  });

  // Main candidate: anchor on the SELL execution FIRST (the resolver reads the
  // first surviving anchor), trade-family kind, explicit event_time.
  const { candidateId } = await seedGemmaCandidate({
    sessionId: session,
    kind: "trade_lesson",
    title: `Scaling into ${args.instrumentKey} strength on confirmed momentum`,
    summary:
      "Adding to a winning spot position when momentum is confirmed tends to realize gains.",
    evidenceRefs: [
      { executionId: spot.sellExecutionId, instrumentKey: args.instrumentKey },
      { executionId: spot.buyExecutionId, instrumentKey: args.instrumentKey },
    ],
    importance: 8,
    eventTime: new Date(),
  });

  const drive = await driveConsolidateWithRealJudge(candidateId, args.workerId);
  if (drive.decisionType !== "promote" || drive.promotedKnowledgeId === null) {
    throw new Error(
      `promoteLessonForReconcile: judge did not promote (decision=${drive.decisionType})`,
    );
  }

  // Sanity: the promoted entry must be ACTIVE (so findPromotedWakeTargets sees it).
  const entry = await knowledgeRepo.getById(drive.promotedKnowledgeId);
  if (!entry || entry.status !== "active") {
    throw new Error("promoteLessonForReconcile: promoted entry not active");
  }

  return {
    knowledgeId: drive.promotedKnowledgeId,
    candidateId,
    sellExecutionId: spot.sellExecutionId,
    drive,
  };
}

export { getLatestDecision };
