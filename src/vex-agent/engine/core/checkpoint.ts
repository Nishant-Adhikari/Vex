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

import type { InferenceProvider, InferenceConfig } from "@vex-agent/inference/types.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as checkpointHandoffsRepo from "@vex-agent/db/repos/checkpoint-handoffs.js";
import {
  selectPrefixWithGiantFallback,
  type CheckpointPlan,
} from "@vex-agent/engine/checkpoint/prefix.js";
import { summarizePrefix } from "@vex-agent/engine/checkpoint/merge.js";
import { extractEpisodes } from "@vex-agent/engine/checkpoint/extract.js";
import { computeBand } from "./context-band.js";
import { embedAllEpisodes } from "./checkpoint/episode-embedding.js";
import { maybeRunForcedHandoffPass } from "./checkpoint/forced-handoff.js";
import { synthesizeToolResultSummary } from "./checkpoint/giant-tool.js";
import {
  clearNoopCooldown,
  getNoopCooldownUntil,
  markNoopCooldown,
  withCheckpointMutex,
} from "./checkpoint/state.js";
import { runCheckpointWriteTx } from "./checkpoint/write-tx.js";
import logger from "@utils/logger.js";

/** Threshold: checkpoint when tokenCount exceeds 90% of context limit. */
const CHECKPOINT_THRESHOLD = 0.9;

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
  return withCheckpointMutex(sessionId, () =>
    executeCheckpointInner(sessionId, memoryScopeKey, provider, config),
  );
}

async function executeCheckpointInner(
  sessionId: string,
  memoryScopeKey: string,
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<CheckpointResult> {
  // 1. Back off recent noops so we don't hammer the provider.
  const cooldownUntil = getNoopCooldownUntil(sessionId);
  if (cooldownUntil !== undefined && Date.now() < cooldownUntil) {
    return { mode: "noop", summary: null, episodeIds: [] };
  }

  // 2. Re-read from DB so every message has its canonical id.
  const messagesWithId = await messagesRepo.getLiveMessagesWithId(sessionId);
  const session = await sessionsRepo.getSession(sessionId);
  const previousSummary = session?.summary ?? null;
  const currentCode = session?.memoryLanguageCode ?? null;

  // Phase 0 — forced handoff pass. Fires only when the band is already
  // `critical`, no active handoff exists for the next generation, and the
  // per-session cooldown has elapsed. See PR-9 in the wake roadmap and
  // ADR-001 for the side-effect-light contract (no usageRepo, no
  // sessionsRepo.updateTokenCount, no saveAssistantMessage).
  if (session) {
    const band = computeBand(session.tokenCount, config.contextLimit);
    if (band === "critical") {
      await maybeRunForcedHandoffPass(
        sessionId,
        session.checkpointGeneration + 1,
        messagesWithId,
        provider,
        config,
      );
    }
  }

  // 3. Decide what to compact.
  const plan = selectPrefixWithGiantFallback(messagesWithId);
  if (plan.mode === "noop") {
    markNoopCooldown(sessionId);
    logger.warn("checkpoint.noop", { sessionId, reason: plan.reason });
    return { mode: "noop", summary: null, episodeIds: [] };
  }

  // Clear any lingering cooldown now that we're actually making progress.
  clearNoopCooldown(sessionId);

  const input = plan.mode === "prefix" ? plan.prefix : plan.virtualPrefix;
  const sourceStartMessageId = input[0]?.id ?? null;
  const sourceEndMessageId = input[input.length - 1]?.id ?? null;

  // Look up the pending handoff for THIS checkpoint's target generation.
  // The handoff's `preserveMd` is the model's own note about what must
  // survive compaction — surfacing it in the summary prompt is the
  // contract promised by PR-9. Reading once here and threading through
  // keeps us from double-querying in Phase II (where we still consume it).
  const pendingHandoff = session
    ? await checkpointHandoffsRepo.getActive(sessionId, session.checkpointGeneration + 1)
    : null;
  const handoffPreserve = pendingHandoff?.payload.preserveMd ?? null;

  // ── Phase I — remote (NO open transaction) ─────────────────────
  // Summary is load-bearing — a throw here aborts the whole checkpoint
  // before any DB write happens, so state is clean for the next retry.
  const summary = await summarizePrefix(input, previousSummary, provider, config, currentCode, handoffPreserve);

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
  // Atomicity: any error here propagates and rolls back the whole Phase II tx.
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

export {
  resetCheckpointCooldownsForTests as __resetCheckpointCooldownForTests,
  getForcedPassCooldownForTests as __getForcedPassCooldownForTests,
  resetCheckpointMutexForTests as __resetCheckpointMutexForTests,
} from "./checkpoint/state.js";
