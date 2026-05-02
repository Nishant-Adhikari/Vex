import type { PoolClient } from "pg";
import type { NewEpisode, EpisodeKind } from "@vex-agent/db/repos/session-episodes.js";
import { getPool } from "@vex-agent/db/client.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as episodesRepo from "@vex-agent/db/repos/session-episodes.js";
import * as checkpointHandoffsRepo from "@vex-agent/db/repos/checkpoint-handoffs.js";
import type { CheckpointPlan } from "@vex-agent/engine/checkpoint/prefix.js";
import logger from "@utils/logger.js";
import { buildGiantToolPlaceholder } from "./giant-tool.js";

interface InsertedEpisodeRef {
  id: number;
  episodeKind: EpisodeKind;
}

/**
 * Phase II - one transaction that holds the whole checkpoint write set.
 *
 * A failure anywhere rolls the whole tx back. The caller surfaces the throw;
 * `turn-loop.ts` treats checkpoint errors as best-effort and warns.
 */
export async function runCheckpointWriteTx(args: {
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

    if (args.currentCode === null && args.inferredCode.length > 0) {
      try {
        await sessionsRepo.setMemoryLanguageCode(args.sessionId, args.inferredCode, tx);
        logger.info("checkpoint.language_code.inferred", {
          sessionId: args.sessionId,
          code: args.inferredCode,
        });
      } catch (err) {
        logger.error("checkpoint.language_code.invalid", {
          sessionId: args.sessionId,
          received: args.inferredCode,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await sessionsRepo.setRollingSummary(args.sessionId, args.summary, tx);

    const genRow = await tx.query<{ checkpoint_generation: number }>(
      "SELECT checkpoint_generation FROM sessions WHERE id = $1 FOR UPDATE",
      [args.sessionId],
    );
    const currentGen = genRow.rows[0]?.checkpoint_generation ?? 0;
    const nextGen = currentGen + 1;

    const stampedRows = args.embeddedRows.map((row) => ({
      ...row,
      checkpointGeneration: nextGen,
    }));
    const inserted =
      stampedRows.length > 0
        ? await episodesRepo.insertEpisodes(stampedRows, tx)
        : [];
    const insertedEpisodes: InsertedEpisodeRef[] = inserted.map((row) => ({
      id: row.id,
      episodeKind: row.episodeKind,
    }));

    await tx.query(
      "UPDATE sessions SET checkpoint_generation = $2 WHERE id = $1",
      [args.sessionId, nextGen],
    );

    const active = await checkpointHandoffsRepo.getActive(args.sessionId, nextGen, tx);
    if (active) {
      const flipped = await checkpointHandoffsRepo.consume(active.id, tx);
      if (flipped === 0) {
        throw new Error(
          `checkpoint.handoff.consume_raced: handoff ${active.id} for target_gen=${nextGen} flipped concurrently`,
        );
      }
      logger.info("checkpoint.handoff.consumed", {
        sessionId: args.sessionId,
        handoffId: active.id,
        targetGen: nextGen,
      });
    }

    if (args.plan.mode === "prefix") {
      await sessionsRepo.archivePrefix(
        args.sessionId,
        args.plan.cutoffMessageId,
        args.plan.tail.length,
        tx,
      );
    } else {
      const placeholderEpisodeId = insertedEpisodes.find(
        (row) => row.episodeKind === "tool_result_summary",
      )?.id;
      const placeholder = buildGiantToolPlaceholder(
        args.plan.bloatedMessageId,
        placeholderEpisodeId,
      );
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
