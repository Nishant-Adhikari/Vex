/**
 * Checkpoint — compaction when approaching context limit.
 *
 * Three outcomes, decided by `selectPrefixWithGiantFallback`:
 *   - `prefix`: summarize + extract episodes + partial-archive the prefix.
 *   - `giant_tool`: fork-copy the single bloated tool row into the archive,
 *     replace the live row's content with a placeholder, and emit at least
 *     one `tool_result_summary` episode.
 *   - `noop`: nothing compactable; mark the session with a short cooldown so
 *     we don't hammer the provider every turn.
 *
 * Two-phase write (PR2, post-migration 008):
 *   Phase I is all remote work (language code read, summarize, extract,
 *   embed) and happens OUTSIDE any transaction — long idle-in-tx against
 *   remote LLM calls is an antipattern. Phase II is the single atomic tx
 *   that commits the whole write set (language_code persist if inferred,
 *   rolling summary, episodes, archive move / giant-tool fork). A crash
 *   mid-Phase-II rolls the entire set back — no split-brain where summary
 *   is updated but episodes missed the write, and no partial archive.
 *
 * `summarizePrefix` is load-bearing (throws if it can't produce a summary).
 * `extractEpisodes` is best-effort (warns + returns empty on failure).
 * Embedding is per-episode and non-fatal within Phase I.
 */

import type { PoolClient } from "pg";
import type { InferenceProvider, InferenceConfig } from "@echo-agent/inference/types.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";
import * as episodesRepo from "@echo-agent/db/repos/session-episodes.js";
import type { NewEpisode } from "@echo-agent/db/repos/session-episodes.js";
import { getPool } from "@echo-agent/db/client.js";
import { embedDocument } from "@echo-agent/embeddings/client.js";
import {
  selectPrefixWithGiantFallback,
  GIANT_TOOL_THRESHOLD,
  type CheckpointPlan,
} from "@echo-agent/engine/checkpoint/prefix.js";
import { summarizePrefix } from "@echo-agent/engine/checkpoint/merge.js";
import {
  extractEpisodes,
  computeEpisodeHash,
  type ExtractedEpisode,
} from "@echo-agent/engine/checkpoint/extract.js";
import logger from "@utils/logger.js";

/** Threshold: checkpoint when tokenCount exceeds 90% of context limit. */
const CHECKPOINT_THRESHOLD = 0.9;

/** Cooldown after a noop so a stuck session doesn't re-enter the same path every turn. */
const NOOP_COOLDOWN_MS = 5 * 60 * 1000;

/** Fallback title hint length — matches the pre-PR2 slice(0, 120) cap. */
const TITLE_FALLBACK_CHARS = 120;

/**
 * In-memory cooldown map — process-lifetime only. Sessions landing in `noop`
 * get a 5-min back-off to prevent infinite retry. Restart clears it; a fresh
 * attempt after a restart is an acceptable conservative default.
 */
const noopCooldownUntil = new Map<string, number>();

// ── Public API ─────────────────────────────────────────────────

export function shouldCheckpoint(tokenCount: number, contextLimit: number): boolean {
  if (contextLimit <= 0) return false;
  return tokenCount >= contextLimit * CHECKPOINT_THRESHOLD;
}

export interface CheckpointResult {
  mode: CheckpointPlan["mode"];
  summary: string | null;
  episodeIds: number[];
}

/**
 * Execute a checkpoint on the given session.
 *
 * The caller is responsible for deciding that a checkpoint is NEEDED (via
 * `shouldCheckpoint`). This function only decides HOW to compact.
 */
export async function executeCheckpoint(
  sessionId: string,
  memoryScopeKey: string,
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<CheckpointResult> {
  // 1. Back off recent noops so we don't hammer the provider.
  const cooldownUntil = noopCooldownUntil.get(sessionId);
  if (cooldownUntil !== undefined && Date.now() < cooldownUntil) {
    return { mode: "noop", summary: null, episodeIds: [] };
  }

  // 2. Re-read from DB so every message has its canonical id.
  const messagesWithId = await messagesRepo.getLiveMessagesWithId(sessionId);
  const session = await sessionsRepo.getSession(sessionId);
  const previousSummary = session?.summary ?? null;
  const currentCode = session?.memoryLanguageCode ?? null;

  // 3. Decide what to compact.
  const plan = selectPrefixWithGiantFallback(messagesWithId);
  if (plan.mode === "noop") {
    noopCooldownUntil.set(sessionId, Date.now() + NOOP_COOLDOWN_MS);
    logger.warn("checkpoint.noop", { sessionId, reason: plan.reason });
    return { mode: "noop", summary: null, episodeIds: [] };
  }

  // Clear any lingering cooldown now that we're actually making progress.
  noopCooldownUntil.delete(sessionId);

  const input = plan.mode === "prefix" ? plan.prefix : plan.virtualPrefix;
  const sourceStartMessageId = input[0]?.id ?? null;
  const sourceEndMessageId = input[input.length - 1]?.id ?? null;

  // ── Phase I — remote (NO open transaction) ─────────────────────
  // Summary is load-bearing — a throw here aborts the whole checkpoint
  // before any DB write happens, so state is clean for the next retry.
  const summary = await summarizePrefix(input, previousSummary, provider, config, currentCode);

  // Episodes are best-effort — schema-invalid or provider-fail returns empty.
  let extraction = await extractEpisodes(input, provider, config, currentCode);

  // Giant-tool mode needs at least one tool_result_summary episode so the live
  // placeholder has something substantive to point at. Synthesize a fallback
  // if the extractor didn't produce one.
  if (plan.mode === "giant_tool") {
    const hasSummary = extraction.episodes.some((ep) => ep.episodeKind === "tool_result_summary");
    if (!hasSummary) {
      extraction = {
        ...extraction,
        episodes: [...extraction.episodes, synthesizeToolResultSummary(plan.bloatedContent)],
      };
    }
  }

  // Embed all episodes up front. Failures drop the row (tracked by warn log)
  // but do NOT abort the checkpoint — inserts still go through for the rest.
  const embeddedRows = await embedAllEpisodes({
    extracted: extraction.episodes,
    sessionId,
    memoryScopeKey,
    sourceStartMessageId,
    sourceEndMessageId,
  });

  // ── Phase II — atomic DB write (single tx) ────────────────────
  // All writes commit together; a failure rolls the whole set back so the
  // invariant "summary ↔ episodes ↔ archive state" never desyncs.
  const { insertedEpisodes } = await runCheckpointWriteTx({
    sessionId,
    summary,
    currentCode,
    inferredCode: extraction.sessionLanguageInferred,
    embeddedRows,
    plan,
  });

  const episodeIds = insertedEpisodes.map((r) => r.id);
  return { mode: plan.mode, summary, episodeIds };
}

// ── Internals ──────────────────────────────────────────────────

interface InsertedEpisodeRef {
  id: number;
  episodeKind: ExtractedEpisode["episodeKind"];
}

async function embedAllEpisodes(args: {
  extracted: readonly ExtractedEpisode[];
  sessionId: string;
  memoryScopeKey: string;
  sourceStartMessageId: number | null;
  sourceEndMessageId: number | null;
}): Promise<NewEpisode[]> {
  if (args.extracted.length === 0) return [];

  const rows: NewEpisode[] = [];
  for (const ep of args.extracted) {
    try {
      // LLM-generated title is authoritative post-PR2. Fallback to the
      // truncated summary when the LLM omitted it — extract.ts already
      // logs a `checkpoint.extract.title_missing` warn in that case.
      const titleHint =
        ep.title.trim().length > 0 ? ep.title : ep.summaryText.slice(0, TITLE_FALLBACK_CHARS);
      const { embedding, providerModel } = await embedDocument(titleHint, ep.summaryText);
      rows.push({
        sessionId: args.sessionId,
        memoryScopeKey: args.memoryScopeKey,
        episodeKind: ep.episodeKind,
        title: ep.title,
        summaryText: ep.summaryText,
        facts: ep.facts,
        decisions: ep.decisions,
        openLoops: ep.openLoops,
        entities: ep.entities,
        toolOutcomes: ep.toolOutcomes,
        sourceSession: args.sessionId,
        sourceStartMessageId: args.sourceStartMessageId,
        sourceEndMessageId: args.sourceEndMessageId,
        episodeHash: ep.episodeHash,
        embeddingModel: providerModel,
        embeddingDim: embedding.length,
        embedding,
      });
    } catch (err) {
      logger.warn("checkpoint.embed.failed", {
        error: err instanceof Error ? err.message : String(err),
        episodeKind: ep.episodeKind,
      });
    }
  }
  return rows;
}

/**
 * Phase II — one transaction that holds the whole checkpoint write set.
 *
 * Order matters:
 *   1. Persist memory_language_code only when the session didn't have one
 *      (first checkpoint). Later checkpoints re-send the persisted code but
 *      the UPDATE is gated by `WHERE memory_language_code IS NULL` so
 *      we're idempotent either way.
 *   2. Rolling summary is always updated.
 *   3. Episode inserts are bundled — zero rows is acceptable.
 *   4. Archive: prefix or giant-tool fork, depending on plan.
 *
 * A failure anywhere rolls the whole tx back. The caller surfaces the
 * throw; `turn-loop.ts` treats checkpoint errors as best-effort and
 * swallows them with a warn log.
 */
async function runCheckpointWriteTx(args: {
  sessionId: string;
  summary: string;
  currentCode: string | null;
  inferredCode: string;
  embeddedRows: readonly NewEpisode[];
  plan: Extract<CheckpointPlan, { mode: "prefix" } | { mode: "giant_tool" }>;
}): Promise<{ insertedEpisodes: InsertedEpisodeRef[] }> {
  const pool = getPool();
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");

    // 1. Persist inferred language on the first checkpoint only.
    if (args.currentCode === null && args.inferredCode.length > 0) {
      try {
        await sessionsRepo.setMemoryLanguageCode(args.sessionId, args.inferredCode, tx);
        logger.info("checkpoint.language_code.inferred", {
          sessionId: args.sessionId,
          code: args.inferredCode,
        });
      } catch (err) {
        // Invalid code from the LLM — keep the checkpoint going without
        // persisting; next checkpoint will try again. Log LOUD because this
        // is a compliance signal against the LLM prompt, not DB pressure.
        logger.error("checkpoint.language_code.invalid", {
          sessionId: args.sessionId,
          received: args.inferredCode,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Rolling summary.
    await sessionsRepo.setRollingSummary(args.sessionId, args.summary, tx);

    // 3. Episodes.
    const inserted =
      args.embeddedRows.length > 0
        ? await episodesRepo.insertEpisodes(args.embeddedRows, tx)
        : [];
    const insertedEpisodes: InsertedEpisodeRef[] = inserted.map((r) => ({
      id: r.id,
      episodeKind: r.episodeKind,
    }));

    // 4. Archive — branch on plan mode.
    if (args.plan.mode === "prefix") {
      await sessionsRepo.archivePrefix(
        args.sessionId,
        args.plan.cutoffMessageId,
        args.plan.tail.length,
        tx,
      );
    } else {
      // Use the tool_result_summary episode id (not the first inserted id,
      // which could be a `decision` / `fact` in a mixed batch). If embed
      // failed for every tool_result_summary, fall through to a placeholder
      // without an episode reference — better than a misleading one.
      const placeholderEpisodeId = insertedEpisodes.find(
        (r) => r.episodeKind === "tool_result_summary",
      )?.id;
      const placeholder = buildGiantToolPlaceholder(args.plan.bloatedMessageId, placeholderEpisodeId);
      await sessionsRepo.forkToolMessageToArchive(args.plan.bloatedMessageId, placeholder, tx);
    }

    await tx.query("COMMIT");
    return { insertedEpisodes };
  } catch (err) {
    await rollback(tx);
    throw err;
  } finally {
    tx.release();
  }
}

async function rollback(tx: PoolClient): Promise<void> {
  try {
    await tx.query("ROLLBACK");
  } catch {
    // ROLLBACK failures are non-actionable; the original error is what matters.
  }
}

function synthesizeToolResultSummary(bloatedContent: string): ExtractedEpisode {
  const preview = bloatedContent.slice(0, GIANT_TOOL_THRESHOLD / 2).trim();
  const summary =
    `Oversized tool output (${bloatedContent.length} chars) archived verbatim. ` +
    `Leading excerpt: ${preview}`;
  const clamped = summary.slice(0, 2000);
  return {
    episodeKind: "tool_result_summary",
    title: "Oversized tool output (archived)",
    summaryText: clamped,
    facts: {},
    decisions: {},
    openLoops: {},
    entities: [],
    toolOutcomes: {},
    episodeHash: computeEpisodeHash("tool_result_summary", clamped),
  };
}

function buildGiantToolPlaceholder(bloatedMessageId: number, episodeId: number | undefined): string {
  const episodeRef = episodeId !== undefined ? `#${episodeId}` : "";
  return (
    `[tool_result_summary${episodeRef} — full payload archived at message_id=${bloatedMessageId}. ` +
    `Ask the operator for replay if needed.]`
  );
}

// ── Test-only helpers ──────────────────────────────────────────

/**
 * Reset the in-memory cooldown map. Test-only hatch — production code never
 * calls this, and we don't expose any way to short-circuit noop back-off from
 * the engine.
 */
export function __resetCheckpointCooldownForTests(): void {
  noopCooldownUntil.clear();
}
