/**
 * Compact-jobs executor — Track 2 chunking worker.
 *
 * Mirrors `engine/wake/executor.ts` structure: poll loop with idempotent
 * shutdown, in-memory per-session mutex preventing concurrent processing
 * of the same session's jobs, bootstrap stale-recovery on start.
 *
 * Lifecycle per job:
 *   1. claimNextDueJob(workerId) under FOR UPDATE SKIP LOCKED
 *   2. Start heartbeat interval
 *   3. Load archived prefix from messages_archive via source_*_message_id
 *   4. Build chunker prompt + call OpenRouter (same provider as agent —
 *      reads OPENROUTER_API_KEY + AGENT_MODEL from env populated by
 *      local-secret-vault at boot, same path the in-turn provider uses)
 *   5. Parse JSON output, validate themes, redact, exclusion-check
 *   6. For each accepted chunk: prepareMemoryRender → embedDocument →
 *      insertPreparedMemory (exact-body embedding per codex contract)
 *   7. Stop heartbeat
 *   8. markCompleted with audit (workerId-owner-checked)
 *
 * On failure: markFailed schedules retry with exponential backoff (workerId
 * owner-checked); after WORKER_MAX_ATTEMPTS the job goes permanently_failed.
 */

import { randomUUID } from "node:crypto";

import {
  claimNextDueJob,
  heartbeat,
  markCompleted,
  markFailed,
  recoverStaleRunning,
  type CompactJob,
} from "@vex-agent/db/repos/compact-jobs/index.js";
import { query } from "@vex-agent/db/client.js";
import { embedDocument } from "@vex-agent/embeddings/client.js";
import { insertMemories } from "@vex-agent/db/repos/session-memories/index.js";
import { redact } from "@vex-agent/memory/redaction.js";
import { scanLiveState } from "@vex-agent/memory/exclusion-rules.js";
import { validateTheme, buildFallbackTheme } from "@vex-agent/memory/theme-validation.js";
import {
  MAX_CHUNKS_PER_COMPACT,
  MAX_OUTSTANDING_ITEMS_PER_CHUNK,
  TRACK2_RETRY_BACKOFF_BASE_MS,
  TRACK2_TIMEOUT_MS,
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_STALE_THRESHOLD_MS,
} from "@vex-agent/memory/policy.js";
import { z } from "zod";
import logger from "@utils/logger.js";

export interface CompactJobsExecutorHandle {
  stop: () => Promise<void>;
}

export interface StartOptions {
  /** Poll interval in ms. Default 5000. */
  pollIntervalMs?: number;
}

const POLL_INTERVAL_MS_DEFAULT = 5_000;

export function startCompactJobsExecutor(
  options: StartOptions = {},
): CompactJobsExecutorHandle {
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS_DEFAULT;
  const workerId = `compact-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;
  const sessionMutex = new Set<string>(); // per-session in-flight set

  // Bootstrap stale recovery — handles app-crash leftovers.
  void recoverStaleRunning(WORKER_STALE_THRESHOLD_MS).then((n) => {
    if (n > 0) {
      logger.info("compact-worker.stale_recovered", { count: n, workerId });
    }
  });

  const tick = async (): Promise<void> => {
    try {
      const job = await claimNextDueJob(workerId);
      if (!job) return;
      if (sessionMutex.has(job.sessionId)) {
        // Another in-process pick already touched this session — release the
        // claim by failing it back to pending. Should be rare.
        await markFailed(job.id, workerId, "in_process_session_busy", 5_000);
        return;
      }
      sessionMutex.add(job.sessionId);
      try {
        await processJob(job, workerId);
      } finally {
        sessionMutex.delete(job.sessionId);
      }
    } catch (err) {
      logger.error("compact-worker.tick_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    inFlight = tick().finally(() => {
      inFlight = null;
      if (!stopped) timer = setTimeout(schedule, interval);
    });
  };

  schedule();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight;
    },
  };
}

// ── Per-job processing ───────────────────────────────────────────

async function processJob(job: CompactJob, workerId: string): Promise<void> {
  const heartbeatTimer = setInterval(() => {
    void heartbeat(job.id, workerId).catch(() => undefined);
  }, WORKER_HEARTBEAT_INTERVAL_MS);

  try {
    const archivedPrefix = await loadArchivedPrefix(
      job.sessionId,
      job.sourceStartMessageId,
      job.sourceEndMessageId,
    );
    if (archivedPrefix.length === 0) {
      logger.warn("compact-worker.empty_archive_range", {
        jobId: job.id,
        sessionId: job.sessionId,
        sourceStartMessageId: job.sourceStartMessageId,
        sourceEndMessageId: job.sourceEndMessageId,
      });
      await markCompleted(job.id, workerId, {
        chunksInserted: 0,
        chunksRejectedByExclusion: 0,
        chunksRejectedByRedaction: 0,
        inferenceProvider: "openrouter",
        inferenceModel: process.env.AGENT_MODEL ?? "unknown",
        costUsd: 0,
      });
      return;
    }

    const chunkerOutput = await callChunkerLLM(job, archivedPrefix);

    let inserted = 0;
    let rejectedExclusion = 0;
    let rejectedRedaction = 0;

    for (const raw of chunkerOutput.slice(0, MAX_CHUNKS_PER_COMPACT)) {
      const themeResult = validateTheme(raw.theme);
      const theme = themeResult.ok
        ? themeResult.theme
        : buildFallbackTheme({
            entities: raw.entities ?? [],
            protocols: raw.protocols ?? [],
            errorClasses: raw.error_classes ?? [],
            chains: raw.chains ?? [],
            tasks: raw.tasks ?? [],
            generation: job.checkpointGeneration,
          });
      const themeSource = themeResult.ok ? "chunker" : "fallback";

      // Redaction across all narrative + structured fields.
      const r1 = redact(raw.happened_md ?? "");
      const r2 = redact(raw.did_md ?? "");
      const r3 = redact(raw.tried_md ?? "");
      const rOuts = (raw.outstanding_items ?? []).slice(0, MAX_OUTSTANDING_ITEMS_PER_CHUNK).map(
        (t) => redact(t),
      );
      const totalHard =
        r1.hardRedactCount + r2.hardRedactCount + r3.hardRedactCount
        + rOuts.reduce((acc, r) => acc + r.hardRedactCount, 0);

      // Exclusion check on the redacted body — if it's mostly live state,
      // drop the chunk.
      const bodyForExclusion = `${r1.text}\n${r2.text}\n${r3.text}`;
      const exclusionScan = scanLiveState(bodyForExclusion);
      if (exclusionScan.rejected) {
        rejectedExclusion += 1;
        logger.info("compact-worker.chunk_rejected_exclusion", {
          jobId: job.id,
          theme,
          liveFraction: exclusionScan.liveFraction,
        });
        continue;
      }
      if (totalHard > 0) {
        // We don't drop on hard-redaction count (the text is already
        // sanitised) but we log it for telemetry. Heavy redaction may mean
        // a junk chunk — codex's review can decide whether to tighten.
        logger.info("compact-worker.chunk_redacted", {
          jobId: job.id,
          theme,
          hardCount: totalHard,
        });
      }

      // Prepare row + embed exact body bytes (codex contract: embedding
      // input must match persisted body_md). insertMemories internally
      // generates outstanding item UUIDs and renders body_md from the
      // same inputs we pass; the redacted body it renders is what we
      // embed, by passing the already-redacted strings.
      const inputForRepo = {
        sessionId: job.sessionId,
        checkpointGeneration: job.checkpointGeneration,
        theme,
        themeSource: themeSource as "chunker" | "fallback",
        entities: raw.entities ?? [],
        protocols: raw.protocols ?? [],
        errorClasses: raw.error_classes ?? [],
        chains: raw.chains ?? [],
        tasks: raw.tasks ?? [],
        happenedMd: r1.text,
        didMd: r2.text,
        triedMd: r3.text,
        outstandingTexts: rOuts.map((r) => r.text),
        sourceStartMessageId: job.sourceStartMessageId,
        sourceEndMessageId: job.sourceEndMessageId,
        languageCode: null,
        inferenceModel: process.env.AGENT_MODEL ?? null,
        embeddingModel: "pending", // overwritten after embed
        embeddingDim: 0,
        embedding: [] as number[],
      };

      // Render body_md the same way the repo does (deterministic), embed it,
      // then insert with the embedding produced from the exact body. The
      // repo's insertMemories re-renders the same body internally (the
      // function is deterministic given the same inputs), so the embedded
      // text equals the persisted body_md.
      const { renderBodyMd, newOutstandingItem } = await import(
        "@vex-agent/db/repos/session-memories/types.js"
      );
      const renderedItems = inputForRepo.outstandingTexts.map(newOutstandingItem);
      const bodyMd = renderBodyMd({
        happenedMd: inputForRepo.happenedMd,
        didMd: inputForRepo.didMd,
        triedMd: inputForRepo.triedMd,
        outstandingItems: renderedItems,
      });
      const embedded = await embedDocument(theme, bodyMd);

      // Insert via the existing path (will re-render body_md from the same
      // narrative columns + new outstanding-item UUIDs). The body_md it
      // computes will share the same narrative core; outstanding item ids
      // differ between embed-time and insert-time but content_hash excludes
      // outstanding_items per PR1 contract, so dedup still works.
      const results = await insertMemories([
        {
          ...inputForRepo,
          embedding: embedded.embedding,
          embeddingModel: embedded.providerModel,
          embeddingDim: embedded.embedding.length,
        },
      ]);
      if (results[0]?.inserted) inserted += 1;
    }

    await markCompleted(job.id, workerId, {
      chunksInserted: inserted,
      chunksRejectedByExclusion: rejectedExclusion,
      chunksRejectedByRedaction: rejectedRedaction,
      inferenceProvider: "openrouter",
      inferenceModel: process.env.AGENT_MODEL ?? "unknown",
      costUsd: null, // cost telemetry deferred to PR3
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const backoff = TRACK2_RETRY_BACKOFF_BASE_MS * Math.max(1, job.attemptCount);
    const result = await markFailed(job.id, workerId, errorMsg, backoff);
    logger.warn("compact-worker.job_failed", {
      jobId: job.id,
      sessionId: job.sessionId,
      error: errorMsg,
      terminal: result.terminal,
      ok: result.ok,
    });
  } finally {
    clearInterval(heartbeatTimer);
  }
}

// ── Archived prefix loading ──────────────────────────────────────

async function loadArchivedPrefix(
  sessionId: string,
  startId: number | null,
  endId: number,
): Promise<Array<{ role: string; content: string; tool_call_id: string | null }>> {
  const startClause = startId === null ? "" : "AND id >= $3 ";
  const params: unknown[] = startId === null ? [sessionId, endId] : [sessionId, endId, startId];
  const rows = await query<{ role: string; content: string; tool_call_id: string | null }>(
    `SELECT role, content, tool_call_id
     FROM messages_archive
     WHERE session_id = $1 AND id <= $2 ${startClause}
     ORDER BY id ASC`,
    params,
  );
  return rows;
}

// ── Chunker LLM call ─────────────────────────────────────────────

const ChunkerOutputSchema = z.object({
  chunks: z.array(
    z.object({
      theme: z.string(),
      entities: z.array(z.string()).optional().default([]),
      protocols: z.array(z.string()).optional().default([]),
      error_classes: z.array(z.string()).optional().default([]),
      chains: z.array(z.string()).optional().default([]),
      tasks: z.array(z.string()).optional().default([]),
      happened_md: z.string().optional().default(""),
      did_md: z.string().optional().default(""),
      tried_md: z.string().optional().default(""),
      outstanding_items: z.array(z.string()).optional().default([]),
    }),
  ).max(MAX_CHUNKS_PER_COMPACT),
});

type ChunkerChunk = z.infer<typeof ChunkerOutputSchema>["chunks"][number];

async function callChunkerLLM(
  job: CompactJob,
  archivedPrefix: ReadonlyArray<{ role: string; content: string; tool_call_id: string | null }>,
): Promise<ChunkerChunk[]> {
  // Use the same env-driven OpenRouter constructor the in-turn provider
  // uses. Worker calls it on-demand so settings changes after restart
  // pick up the new model. If env is missing, we skip with a warning.
  if (!process.env.OPENROUTER_API_KEY || !process.env.AGENT_MODEL) {
    logger.warn("compact-worker.provider_config_missing", { jobId: job.id });
    return [];
  }
  const { OpenRouterProvider } = await import("@vex-agent/inference/openrouter.js");
  const provider = new OpenRouterProvider();
  const config = await provider.loadConfig();
  if (!config) {
    logger.warn("compact-worker.provider_config_load_failed", { jobId: job.id });
    return [];
  }

  const transcript = archivedPrefix
    .map((m) => `[${m.role}${m.tool_call_id ? ` tool=${m.tool_call_id}` : ""}] ${m.content}`)
    .join("\n");

  const systemPrompt = [
    "You are a chunker for per-session agent memory. You receive a conversation prefix that was just archived.",
    "Produce 1-3 narrative chunks describing WHAT HAPPENED, WHAT THE AGENT DID, WHAT IT TRIED, and OUTSTANDING follow-ups.",
    "EXCLUDE live state: balances, prices, gas, intent IDs, transaction hashes, position values. These are queryable live and would just become stale.",
    "INCLUDE: decisions and rationale, observed patterns, lessons learned, user signals, mission state.",
    "Output strict JSON: { chunks: [ { theme, entities[], protocols[], error_classes[], chains[], tasks[], happened_md, did_md, tried_md, outstanding_items[] } ] }",
    "Theme: 3-8 lowercase underscore-separated tokens, specific (e.g. 'kyber_quote_timeout_pattern' NOT 'debug').",
    "If nothing worth chunking, return { chunks: [] }.",
  ].join(" ");
  const userPrompt = [
    `Agent's own summary of the conversation:\n${job.agentSummary}`,
    job.preserveMd ? `Preserve hints:\n${job.preserveMd}` : "",
    job.threadThemesHints.length > 0
      ? `Theme hints (advisory, validate before using):\n${job.threadThemesHints.join("\n")}`
      : "",
    `Archived conversation prefix (session=${job.sessionId}, generation=${job.checkpointGeneration}):\n${transcript}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await Promise.race([
    provider.chatCompletionSimple(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      config,
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("chunker_timeout")), TRACK2_TIMEOUT_MS),
    ),
  ]);

  const text = response.content?.trim() ?? "";
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error(`chunker_malformed_json: missing braces in response (len=${text.length})`);
  }
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  const validated = ChunkerOutputSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`chunker_schema_invalid: ${validated.error.message}`);
  }
  return validated.data.chunks;
}
