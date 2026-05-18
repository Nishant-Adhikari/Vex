/**
 * PR4 — initial eval harness.
 *
 * Synthetic mission scenarios that exercise the per-session memory layer end-
 * to-end against the real Postgres + EmbeddingGemma stack provisioned by
 * `globalSetup.ts`. Chunker LLM is mocked at `@vex-agent/inference/openrouter.js`
 * (executor calls `provider.chatCompletionSimple` after `provider.loadConfig`);
 * each scenario sets `currentChunkerResponse` to the JSON the chunker should
 * "return" for that run.
 *
 * Scenarios in this file (5 of 7 codex-approved):
 *
 *   - cross-session leak guard — session B's `memory_recall` must NEVER
 *     surface session A's chunks even with identical themes and matching
 *     embedding model/dim.
 *
 *   - knowledge source filter — Active Knowledge hot-context surface
 *     returns only `observed` + `user_confirmed`; recall returns all four
 *     tiers when queried explicitly.
 *
 *   - stale-claim defense — two `workerId`s race on the same compact_job;
 *     only one's `markCompleted` returns true. The losing worker sees
 *     `false` and must not retry.
 *
 *   - single-compact session — `executeCompactNow` + Track 2 worker land
 *     a chunk that becomes recallable via `memory_recall` against the same
 *     session. End-to-end proof of the new memory tier.
 *
 *   - outstanding-item resolution survives compact — a chunk with multiple
 *     outstanding items has one resolved; the resolution sticks across a
 *     subsequent compact cycle (next compact does NOT re-emit the resolved
 *     item as unresolved).
 *
 * Deferred to PR4.2 per master plan (13 remaining from PR4-EVAL-AND-SUNSET.md):
 *   #2 multi-compact mission, #3 long autonomous, #4 PL/EN, #5 provider 429,
 *   #6 app-restart mid-Track 2, #8 noop counter, #9 operator interrupt,
 *   #12 live-state exclusion, #13 redaction regression, #14 theme degeneration,
 *   #16 bridge packet, #17 critical-band waiting_for_wake, #18 last_checkpoint_at.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const chunkerMockHandle = vi.hoisted(() => {
  let response: { chunks: ReadonlyArray<unknown> } = { chunks: [] };
  return {
    setChunkerResponse(next: { chunks: ReadonlyArray<unknown> }): void {
      response = next;
    },
    getChunkerResponse(): { chunks: ReadonlyArray<unknown> } {
      return response;
    },
  };
});

vi.mock("@vex-agent/inference/openrouter.js", () => ({
  OpenRouterProvider: vi.fn().mockImplementation(() => ({
    loadConfig: vi.fn().mockResolvedValue({
      provider: "openrouter",
      model: "test-model",
      contextLimit: 128_000,
      maxOutputTokens: 4096,
      inputPricePerM: 0,
      outputPricePerM: 0,
      priceCurrency: "USD",
    }),
    chatCompletionSimple: vi.fn().mockImplementation(async () => ({
      content: JSON.stringify(chunkerMockHandle.getChunkerResponse()),
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })),
  })),
}));

import { randomUUID } from "node:crypto";

import { executeCompactNow } from "@vex-agent/engine/compact-jobs/service.js";
import { startCompactJobsExecutor } from "@vex-agent/engine/compact-jobs/executor.js";
import { resetCompactMutexForTests } from "@vex-agent/engine/compact-jobs/state.js";
import {
  claimNextDueJob,
  enqueueJob,
  getById as getJobById,
  markCompleted,
  type NewCompactJob,
} from "@vex-agent/db/repos/compact-jobs/index.js";
import {
  getSessionMemoryStats,
  insertMemories,
  markOutstandingResolved,
  recallTopK as recallMemories,
  type NewSessionMemory,
} from "@vex-agent/db/repos/session-memories/index.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import {
  embedText,
  insertMessage,
  makeSession,
  randVector,
  resetDb,
} from "../setup/fixtures.js";

const EMBEDDING_DIM = 8;
const TEST_EMBEDDING_MODEL = "test-model";

function newMemory(
  sessionId: string,
  overrides: Partial<NewSessionMemory> & { theme: string; happenedMd: string },
): NewSessionMemory {
  const seed = sessionId + "|" + overrides.theme + "|" + overrides.happenedMd;
  return {
    sessionId,
    checkpointGeneration: overrides.checkpointGeneration ?? 1,
    theme: overrides.theme,
    themeSource: overrides.themeSource ?? "chunker",
    entities: overrides.entities ?? [],
    protocols: overrides.protocols ?? [],
    errorClasses: overrides.errorClasses ?? [],
    chains: overrides.chains ?? [],
    tasks: overrides.tasks ?? [],
    happenedMd: overrides.happenedMd,
    didMd: overrides.didMd ?? "",
    triedMd: overrides.triedMd ?? "",
    outstandingTexts: overrides.outstandingTexts ?? [],
    sourceStartMessageId: overrides.sourceStartMessageId ?? null,
    sourceEndMessageId: overrides.sourceEndMessageId ?? null,
    languageCode: overrides.languageCode ?? "en",
    inferenceModel: overrides.inferenceModel ?? "test-llm",
    embeddingModel: TEST_EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    embedding: overrides.embedding ?? randVector(EMBEDDING_DIM, seed),
  };
}

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

async function seedConversation(sessionId: string, length = 14): Promise<void> {
  for (let i = 0; i < length; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    await insertMessage(sessionId, role, `turn ${i}: realistic conversation content for compact`);
  }
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

// ── Scenario 1: cross-session leak guard ─────────────────────────

describe("PR4 eval — cross-session leak guard", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("session B's memory_recall returns zero hits from session A even with identical themes", async () => {
    const sessionA = await makeSession();
    const sessionB = await makeSession();

    // Same theme, same embedding model/dim, even similar embedding vectors —
    // the per-session filter must still reject cross-session hits.
    await insertMemories([
      newMemory(sessionA, {
        theme: "shared_pattern",
        happenedMd: "Session A observed pattern X in WIF orderbook.",
        embedding: randVector(EMBEDDING_DIM, "shared-seed"),
      }),
    ]);

    const queryEmbedding = randVector(EMBEDDING_DIM, "shared-seed"); // matches A's embedding
    const hits = await recallMemories(queryEmbedding, {
      sessionId: sessionB,
      embeddingModel: TEST_EMBEDDING_MODEL,
      embeddingDim: EMBEDDING_DIM,
      topK: 10,
      minSimilarity: 0, // disable threshold to prove session filter, not threshold, blocks
    });

    expect(hits).toHaveLength(0);

    // Confirm session A would have found it given the same query — proves
    // the absence in session B is NOT because the vector was bad.
    const aHits = await recallMemories(queryEmbedding, {
      sessionId: sessionA,
      embeddingModel: TEST_EMBEDDING_MODEL,
      embeddingDim: EMBEDDING_DIM,
      topK: 10,
      minSimilarity: 0,
    });
    expect(aHits.length).toBeGreaterThan(0);
  });
});

// ── Scenario 2: knowledge source filter ──────────────────────────

describe("PR4 eval — knowledge source filter (Active Knowledge hot-context)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("active-knowledge surface filters by source; recall returns all tiers", async () => {
    const sid = await makeSession();
    await insertMessage(sid, "user", "seeding messages so session exists for source-surface FK");

    // Insert one entry per source tier. Same kind to make recall a clean
    // cross-source comparison. Use real embedding so dense recall works.
    const tiers = ["observed", "user_confirmed", "inferred", "hypothesis"] as const;
    const created: Array<{ id: number; source: typeof tiers[number] }> = [];

    for (const source of tiers) {
      const title = `${source} pattern title`;
      const summary = `${source} pattern summary about Kyber quote timeout handling.`;
      const embedded = await embedText(`${title} | ${summary}`);
      const { entry } = await knowledgeRepo.insertEntry({
        kind: "kyber_quote_timeout",
        title,
        summary,
        contentMd: summary,
        tags: [],
        sourceRefs: {},
        confidence: null,
        pinned: false,
        validUntil: null,
        contentHash: computeContentHash({ kind: "kyber_quote_timeout", title, summary, contentMd: summary }),
        embeddingModel: embedded.providerModel,
        embeddingDim: embedded.embedding.length,
        embedding: embedded.embedding,
        sourceSurface: "vex_agent",
        sourceSession: sid,
        source,
      });
      created.push({ id: entry.id, source });
    }
    expect(created).toHaveLength(4);

    // Active-knowledge surface — must include only observed + user_confirmed.
    const hotEntries = await knowledgeRepo.listActiveForHotContext({ limit: 20 });
    const hotSources = new Set(hotEntries.map((e) => e.source));
    expect(hotSources.has("observed")).toBe(true);
    expect(hotSources.has("user_confirmed")).toBe(true);
    expect(hotSources.has("inferred")).toBe(false);
    expect(hotSources.has("hypothesis")).toBe(false);

    // Recall — returns all tiers when queried explicitly (no source filter on
    // recallTopK; the filter only gates the hot-context auto-injection).
    const queryEmbed = await embedText("Kyber quote timeout patterns");
    const recallHits = await knowledgeRepo.recallTopK(
      queryEmbed.embedding,
      {
        embeddingModel: queryEmbed.providerModel,
        embeddingDim: queryEmbed.embedding.length,
      },
      10,
    );
    const recallSources = new Set(recallHits.map((h) => h.entry.source));
    expect(recallSources.has("observed")).toBe(true);
    expect(recallSources.has("user_confirmed")).toBe(true);
    expect(recallSources.has("inferred")).toBe(true);
    expect(recallSources.has("hypothesis")).toBe(true);
  });
});

// ── Scenario 3: stale-claim defense ──────────────────────────────

describe("PR4 eval — stale-claim defense on compact_jobs", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("only one workerId's markCompleted returns true on the same job", async () => {
    const sid = await makeSession();
    const enq = await enqueueJob(newJob(sid, 1));
    const jobId = enq.job.id;

    const workerA = `worker-A-${randomUUID()}`;
    const workerB = `worker-B-${randomUUID()}`;

    // Worker A claims the job — claimNextDueJob does the FOR UPDATE SKIP
    // LOCKED transition. After this, the row is `running` locked_by=A.
    const claimedA = await claimNextDueJob(workerA);
    expect(claimedA?.id).toBe(jobId);

    // Worker B never owned the row → markCompleted must return false.
    const audit = {
      chunksInserted: 0,
      chunksRejectedByExclusion: 0,
      chunksRejectedByRedaction: 0,
      inferenceProvider: "openrouter",
      inferenceModel: "test-model",
      costUsd: null,
    };
    const okB = await markCompleted(jobId, workerB, audit);
    expect(okB).toBe(false);

    // Worker A's markCompleted lands.
    const okA = await markCompleted(jobId, workerA, audit);
    expect(okA).toBe(true);

    // After A completes, B's retry still returns false (status='completed',
    // owner cleared) — no risk of double-completion races.
    const okBRetry = await markCompleted(jobId, workerB, audit);
    expect(okBRetry).toBe(false);

    // Final row is completed.
    const final = await getJobById(jobId);
    expect(final?.status).toBe("completed");
  });
});

// ── Scenario 4: single-compact full lifecycle ────────────────────

describe("PR4 eval — single-compact session lands a recallable chunk", () => {
  let savedApiKey: string | undefined;
  let savedAgentModel: string | undefined;

  beforeEach(async () => {
    savedApiKey = process.env.OPENROUTER_API_KEY;
    savedAgentModel = process.env.AGENT_MODEL;
    process.env.OPENROUTER_API_KEY = "test-fixture-key";
    process.env.AGENT_MODEL = "test/fixture-model";
    await resetDb();
    resetCompactMutexForTests();
    chunkerMockHandle.setChunkerResponse({ chunks: [] });
  });

  afterEach(() => {
    // Restore env so later integration tests (e.g. compact-service.int.test.ts
    // missing-config gate) see the original baseline. Mirrors the pattern in
    // that file's `afterEach`.
    if (savedApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedApiKey;
    if (savedAgentModel === undefined) delete process.env.AGENT_MODEL;
    else process.env.AGENT_MODEL = savedAgentModel;
  });

  it("compact_now → worker → memory_recall surfaces the chunk", async () => {
    const sid = await makeSession();
    await seedConversation(sid, 14);

    // Chunker returns a single coherent chunk describing the conversation.
    chunkerMockHandle.setChunkerResponse({
      chunks: [
        {
          theme: "wif_orderbook_observation_pattern",
          entities: ["WIF"],
          protocols: ["solana"],
          error_classes: [],
          chains: ["solana"],
          tasks: ["orderbook_review"],
          happened_md: "Observed thin WIF orderbook with widening spread over 14 turns.",
          did_md: "Logged the pattern for the next decision cycle.",
          tried_md: "Cross-checked with kyber quote depth.",
          outstanding_items: [],
        },
      ],
    });

    const compact = await executeCompactNow({
      sessionId: sid,
      agentSummary: "Reviewed WIF orderbook for thin liquidity.",
      preserveMd: null,
      threadThemesHints: ["wif_orderbook"],
      source: "agent_tool",
    });
    expect(compact.kind).toBe("committed");
    if (compact.kind !== "committed") throw new Error("unreachable");
    expect(compact.generation).toBeGreaterThan(0);

    // Start the executor, wait for the job to complete + chunk to land.
    const handle = startCompactJobsExecutor({ pollIntervalMs: 100 });
    try {
      await waitFor(async () => {
        const job = await getJobById(compact.jobId);
        return job?.status === "completed";
      });
    } finally {
      await handle.stop();
    }

    // Memory recall must find the chunk via semantic query.
    const stats = await getSessionMemoryStats(sid, 10);
    expect(stats.activeCount).toBe(1);

    const queryEmbed = await embedText("WIF liquidity orderbook patterns");
    const hits = await recallMemories(queryEmbed.embedding, {
      sessionId: sid,
      embeddingModel: queryEmbed.providerModel,
      embeddingDim: queryEmbed.embedding.length,
      topK: 5,
      minSimilarity: 0,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].memory.theme).toBe("wif_orderbook_observation_pattern");
    expect(hits[0].memory.bodyMd).toContain("Observed thin WIF orderbook");
  });
});

// ── Scenario 5: outstanding item resolution survives compact ─────

describe("PR4 eval — outstanding-item resolution survives a subsequent compact", () => {
  let savedApiKey: string | undefined;
  let savedAgentModel: string | undefined;

  beforeEach(async () => {
    savedApiKey = process.env.OPENROUTER_API_KEY;
    savedAgentModel = process.env.AGENT_MODEL;
    process.env.OPENROUTER_API_KEY = "test-fixture-key";
    process.env.AGENT_MODEL = "test/fixture-model";
    await resetDb();
    resetCompactMutexForTests();
  });

  afterEach(() => {
    if (savedApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedApiKey;
    if (savedAgentModel === undefined) delete process.env.AGENT_MODEL;
    else process.env.AGENT_MODEL = savedAgentModel;
  });

  it("chunk with 2 outstanding items, resolve one, run another compact — resolved state sticks", async () => {
    const sid = await makeSession();
    await seedConversation(sid, 14);

    // First compact — chunker emits a chunk with TWO outstanding items.
    chunkerMockHandle.setChunkerResponse({
      chunks: [
        {
          theme: "pending_swap_review_pattern",
          entities: ["USDC", "SOL"],
          protocols: ["solana"],
          error_classes: [],
          chains: ["solana"],
          tasks: ["swap_review"],
          happened_md: "User initiated SOL→USDC swap discussion.",
          did_md: "Identified two follow-up checks.",
          tried_md: "",
          outstanding_items: ["confirm slippage budget", "verify destination wallet"],
        },
      ],
    });

    const compact1 = await executeCompactNow({
      sessionId: sid,
      agentSummary: "First compact with outstanding items.",
      preserveMd: null,
      threadThemesHints: [],
      source: "agent_tool",
    });
    if (compact1.kind !== "committed") throw new Error("compact1 not committed");

    const handle = startCompactJobsExecutor({ pollIntervalMs: 100 });
    try {
      await waitFor(async () => (await getJobById(compact1.jobId))?.status === "completed");
    } finally {
      await handle.stop();
    }

    // Get the chunk and resolve one of its outstanding items.
    const stats1 = await getSessionMemoryStats(sid, 10);
    expect(stats1.activeCount).toBe(1);

    const queryEmbed = await embedText("pending swap review");
    const hits1 = await recallMemories(queryEmbed.embedding, {
      sessionId: sid,
      embeddingModel: queryEmbed.providerModel,
      embeddingDim: queryEmbed.embedding.length,
      topK: 5,
      minSimilarity: 0,
    });
    expect(hits1.length).toBeGreaterThan(0);
    const memory = hits1[0].memory;
    expect(memory.outstandingItems).toHaveLength(2);

    const itemToResolve = memory.outstandingItems[0];
    const resolve = await markOutstandingResolved(
      memory.id,
      itemToResolve.id,
      "slippage budget = 0.5%",
      "agent",
    );
    expect(resolve.ok).toBe(true);
    if (!resolve.ok) throw new Error("unreachable");

    // After resolution: one outstanding remains unresolved, one resolved.
    const unresolvedAfter = resolve.memory.outstandingItems.filter((it) => it.resolvedAt === null);
    expect(unresolvedAfter).toHaveLength(1);

    // Add more conversation + run a second compact. The chunker doesn't
    // re-derive the old chunk (different message range), so the old chunk's
    // resolved state is the authoritative truth that must survive.
    await seedConversation(sid, 14);
    chunkerMockHandle.setChunkerResponse({
      chunks: [
        {
          theme: "post_swap_confirmation_pattern",
          entities: [],
          protocols: ["solana"],
          error_classes: [],
          chains: [],
          tasks: [],
          happened_md: "Swap completed.",
          did_md: "",
          tried_md: "",
          outstanding_items: [],
        },
      ],
    });
    const compact2 = await executeCompactNow({
      sessionId: sid,
      agentSummary: "Second compact after the first.",
      preserveMd: null,
      threadThemesHints: [],
      source: "agent_tool",
    });
    if (compact2.kind !== "committed") throw new Error("compact2 not committed");

    const handle2 = startCompactJobsExecutor({ pollIntervalMs: 100 });
    try {
      await waitFor(async () => (await getJobById(compact2.jobId))?.status === "completed");
    } finally {
      await handle2.stop();
    }

    // Re-query the FIRST chunk via its theme — resolved item must still be
    // resolved; the second compact didn't reset it.
    const reHits = await recallMemories(queryEmbed.embedding, {
      sessionId: sid,
      embeddingModel: queryEmbed.providerModel,
      embeddingDim: queryEmbed.embedding.length,
      topK: 10,
      minSimilarity: 0,
    });
    const swapReviewHit = reHits.find((h) => h.memory.id === memory.id);
    expect(swapReviewHit).toBeDefined();
    if (!swapReviewHit) throw new Error("unreachable");
    const resolvedFinal = swapReviewHit.memory.outstandingItems.find((it) => it.id === itemToResolve.id);
    expect(resolvedFinal?.resolvedAt).not.toBeNull();
    expect(resolvedFinal?.resolutionNote).toBe("slippage budget = 0.5%");
  });
});
