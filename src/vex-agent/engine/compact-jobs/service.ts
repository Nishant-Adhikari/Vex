/**
 * executeCompactNow — the single compaction primitive of PR2.
 *
 * Shared service called by:
 *   - the `compact_now` tool handler (agent-driven path)
 *   - the forced-fallback path at critical band (runtime-driven path)
 *
 * Track 1 semantics — everything below runs in a single atomic transaction
 * under `withCheckpointMutex` so wake/ingress paths cannot observe a
 * half-archived transcript:
 *   1. Redact summary / preserve / themes via memory/redaction
 *   2. SELECT session FOR UPDATE; compute `nextGen = checkpoint_generation + 1`
 *   3. Reload live messages with ids
 *   4. selectPrefixWithGiantFallback(messages) → plan
 *   5. If `noop` (empty prefix, no compactable tool) → return `{kind:'noop'}`
 *      without bumping generation. Caller decides whether to retry.
 *   6. Otherwise:
 *      - setRollingSummary(sessionId, agent_summary)  -- REPLACE, not merge
 *      - UPDATE sessions SET checkpoint_generation = nextGen
 *      - archivePrefix(...) OR forkToolMessageToArchive(...) with giant
 *        placeholder referencing the compact_job id (Track 2 will produce
 *        the narrative chunk asynchronously)
 *      - enqueueJob({...}) — idempotent on (session_id, generation)
 *   7. Commit; return `{kind:'committed', generation, archivedMessages, jobId}`
 *
 * Track 2 (chunking) NEVER blocks compact. If the worker fails or the
 * provider is down, the row stays in `compact_jobs` with `status='pending'`
 * for retry; the compact itself has already committed.
 */

import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import { archivePrefix, forkToolMessageToArchive } from "@vex-agent/db/repos/sessions-archive.js";
import { enqueueJob } from "@vex-agent/db/repos/compact-jobs/index.js";
import { getPool } from "@vex-agent/db/client.js";
import { selectPrefixWithGiantFallback } from "@vex-agent/engine/checkpoint/prefix.js";
import { withCheckpointMutex } from "./state.js";
import { redact } from "@vex-agent/memory/redaction.js";
import { buildGiantToolPlaceholder } from "./giant-tool.js";
import logger from "@utils/logger.js";

export interface CompactCommitArgs {
  sessionId: string;
  agentSummary: string;
  preserveMd: string | null;
  threadThemesHints: string[];
  source: "agent_tool" | "forced_fallback";
}

export type CompactCommitResult =
  | {
      kind: "committed";
      generation: number;
      archivedMessages: number;
      jobId: number;
      redactionCounts: { hard: number; mask: number };
      planMode: "prefix" | "giant_tool";
    }
  | {
      kind: "noop";
      reason: "empty_session" | "no_compactable";
    };

export async function executeCompactNow(input: CompactCommitArgs): Promise<CompactCommitResult> {
  return withCheckpointMutex(input.sessionId, () => executeCompactNowInner(input));
}

async function executeCompactNowInner(input: CompactCommitArgs): Promise<CompactCommitResult> {
  // Pre-compute redactions on every text field (counts surfaced in audit).
  const summaryR = redact(input.agentSummary);
  const preserveR = input.preserveMd === null ? null : redact(input.preserveMd);
  const themeRs = input.threadThemesHints.map((t) => redact(t));
  const redactionCounts = {
    hard:
      summaryR.hardRedactCount
      + (preserveR?.hardRedactCount ?? 0)
      + themeRs.reduce((acc, r) => acc + r.hardRedactCount, 0),
    mask:
      summaryR.maskCount
      + (preserveR?.maskCount ?? 0)
      + themeRs.reduce((acc, r) => acc + r.maskCount, 0),
  };
  const redactedSummary = summaryR.text;
  const redactedPreserve = preserveR?.text ?? null;
  const redactedHints = themeRs.map((r) => r.text);

  const pool = getPool();
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");

    // Lock the session row and read the current generation FIRST. Selecting
    // the prefix before the lock would let a second compacter plan against
    // a stale transcript and serialize on the row lock — the second commit
    // would then bump a SECOND generation using an obsolete cutoff. Reading
    // messages + planning under the same connection as the FOR UPDATE makes
    // the plan/commit pair atomic per session.
    const genRow = await tx.query<{ checkpoint_generation: number }>(
      "SELECT checkpoint_generation FROM sessions WHERE id = $1 FOR UPDATE",
      [input.sessionId],
    );
    const currentGen = genRow.rows[0]?.checkpoint_generation ?? 0;
    const nextGen = currentGen + 1;

    // Now read live messages + select prefix under the locked session — the
    // tx-aware variant of `getLiveMessagesWithId` reuses the FOR-UPDATE
    // client so the snapshot matches what's about to commit.
    const messagesWithId = await messagesRepo.getLiveMessagesWithId(input.sessionId, tx);
    const plan = selectPrefixWithGiantFallback(messagesWithId);
    if (plan.mode === "noop") {
      await tx.query("ROLLBACK").catch(() => undefined);
      logger.info("compact.noop", {
        sessionId: input.sessionId,
        reason: plan.reason,
        source: input.source,
      });
      return { kind: "noop", reason: plan.reason };
    }

    const sourceStartMessageId =
      plan.mode === "prefix" ? plan.prefix[0]?.id ?? null : plan.virtualPrefix[0]?.id ?? null;
    const sourceEndMessageId =
      plan.mode === "prefix"
        ? plan.prefix[plan.prefix.length - 1]?.id
        : plan.virtualPrefix[plan.virtualPrefix.length - 1]?.id;

    if (sourceEndMessageId === undefined) {
      await tx.query("ROLLBACK").catch(() => undefined);
      return { kind: "noop", reason: "no_compactable" };
    }

    // 1. Replace the rolling summary with the agent's narrative summary.
    //    Wholesale REPLACE (not merge) — agent's full-context summary IS
    //    the new rolling summary. Old merge semantics produced telephone-
    //    game drift across many compactions.
    await sessionsRepo.setRollingSummary(input.sessionId, redactedSummary, tx);

    // 2. Bump generation atomically AND reset token_count so a restart in
    //    the window between commit and the next executeTurn cannot resume
    //    into a stale-critical band that would fire a redundant forced
    //    fallback (which would noop, since the session was just compacted).
    //    The next executeTurn writes the actual post-compact prompt size
    //    via `sessionsRepo.updateTokenCount` — this 0 is only a safe
    //    interim baseline. Same single UPDATE so the bump + reset commit
    //    atomically with the archive write.
    await tx.query(
      "UPDATE sessions SET checkpoint_generation = $2, token_count = 0 WHERE id = $1",
      [input.sessionId, nextGen],
    );

    // 3. Enqueue Track 2 chunking job first — we need its id to embed in the
    //    giant-tool placeholder if applicable. Idempotent on (session, gen).
    const enq = await enqueueJob(
      {
        sessionId: input.sessionId,
        checkpointGeneration: nextGen,
        agentSummary: redactedSummary,
        preserveMd: redactedPreserve,
        threadThemesHints: redactedHints,
        sourceStartMessageId,
        sourceEndMessageId,
      },
      tx,
    );

    let archivedMessages: number;
    if (plan.mode === "prefix") {
      const remainingCount = messagesWithId.length - plan.prefix.length;
      await archivePrefix(input.sessionId, plan.cutoffMessageId, remainingCount, tx);
      archivedMessages = plan.prefix.length;
    } else {
      // giant_tool plan: fork the single bloated row to archive, leave a
      // placeholder stub in live messages pointing at the compact_job (Track
      // 2 will produce the narrative chunk asynchronously). Placeholder text
      // mentions session_memory_search as the recovery path per codex guardrail.
      const placeholder = buildGiantToolPlaceholder(plan.bloatedMessageId, enq.job.id);
      await forkToolMessageToArchive(input.sessionId, plan.bloatedMessageId, placeholder, tx);
      archivedMessages = 1;
    }

    await tx.query("COMMIT");

    logger.info("compact.committed", {
      sessionId: input.sessionId,
      generation: nextGen,
      planMode: plan.mode,
      archivedMessages,
      jobId: enq.job.id,
      source: input.source,
      redactionHard: redactionCounts.hard,
      redactionMask: redactionCounts.mask,
    });

    return {
      kind: "committed",
      generation: nextGen,
      archivedMessages,
      jobId: enq.job.id,
      redactionCounts,
      planMode: plan.mode,
    };
  } catch (err) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    tx.release();
  }
}
