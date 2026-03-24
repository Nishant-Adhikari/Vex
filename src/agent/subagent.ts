/**
 * Subagent lifecycle manager — spawn, track, stop, collect results.
 *
 * Subagents run in-process as isolated ConversationSession instances.
 * They share the DB pool, tool registry, and inference config with the main agent.
 *
 * Key design:
 * - Fire-and-forget: spawn returns immediately, main agent checks results later
 * - Mama agent names her children (Echo-prefixed names)
 * - Full tool set by default; mutations gated by allow_trades flag
 * - Memory isolation: read shared memory, write only to knowledge/subagents/
 * - No cascading: subagents cannot spawn other subagents
 * - Max 3 concurrent subagents
 */

import { createSession, processMessage } from "./engine.js";
import type { EventEmitter } from "./engine.js";
import { generateId } from "./id.js";
import { withSessionLock } from "./session-lock.js";
import { publish as publishInboxEvent } from "./autonomy-inbox.js";
import * as subagentRepo from "./db/repos/subagents.js";
import * as sessionsRepo from "./db/repos/sessions.js";
import {
  MAX_CONCURRENT_SUBAGENTS,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_TIMEOUT_MS,
  SUBAGENT_RESULT_MAX_TOKENS,
} from "./constants.js";
import { withTimeout } from "./resilience.js";
import type { SubagentState, SubagentStatus, AgentEvent, LoopMode } from "./types.js";
import logger from "../utils/logger.js";

// ── In-memory tracking ───────────────────────────────────────────────

interface ActiveSubagent {
  id: string;
  name: string;
  promise: Promise<void>;
  abortController: AbortController;
}

const activeSubagents = new Map<string, ActiveSubagent>();

/** SSE broadcast for subagent events. */
let broadcastEmit: EventEmitter | null = null;

export function setSubagentBroadcast(emit: EventEmitter): void {
  broadcastEmit = emit;
}

// ── Public API ───────────────────────────────────────────────────────

export interface SpawnOptions {
  name: string;
  task: string;
  allowTrades?: boolean;
  maxIterations?: number;
  parentSessionId?: string | null;
  loopMode?: LoopMode;
}

export async function spawnSubagent(opts: SpawnOptions): Promise<{ id: string; name: string; error?: string }> {
  // Check concurrency limit
  if (activeSubagents.size >= MAX_CONCURRENT_SUBAGENTS) {
    return { id: "", name: opts.name, error: `Max concurrent subagents (${MAX_CONCURRENT_SUBAGENTS}) reached. Wait for one to complete.` };
  }

  // Check name uniqueness among active
  for (const [, sub] of activeSubagents) {
    if (sub.name === opts.name) {
      return { id: "", name: opts.name, error: `Subagent "${opts.name}" is already running. Choose a different name.` };
    }
  }

  // Create session
  const session = createSession();
  if (!session) {
    return { id: "", name: opts.name, error: "Cannot create session — agent not ready" };
  }

  const id = generateId("subagent");
  const maxIter = opts.maxIterations ?? SUBAGENT_MAX_ITERATIONS;
  const loopMode = opts.loopMode ?? "restricted";

  // Persist
  await sessionsRepo.createSession(session.id);
  await sessionsRepo.setScope(session.id, "subagent", opts.parentSessionId);

  await subagentRepo.insert({
    id,
    name: opts.name,
    task: opts.task,
    allowTrades: opts.allowTrades ?? false,
    parentSessionId: opts.parentSessionId ?? null,
    sessionId: session.id,
    maxIterations: maxIter,
  });

  // Broadcast spawn event
  broadcastEmit?.({ type: "subagent_spawned", data: { id, name: opts.name, task: opts.task } });

  logger.info("subagent.spawned", { id, name: opts.name, allowTrades: opts.allowTrades ?? false });

  // Build subagent task prompt with context
  const taskPrompt = buildSubagentPrompt(opts.name, opts.task, opts.allowTrades ?? false);

  // Fire-and-forget execution
  const abortController = new AbortController();
  const promise = runSubagent({
    id, name: opts.name, session, taskPrompt, loopMode,
    allowTrades: opts.allowTrades ?? false, signal: abortController.signal,
  });

  activeSubagents.set(id, { id, name: opts.name, promise, abortController });

  // Cleanup on completion
  promise.finally(() => {
    activeSubagents.delete(id);
  });

  return { id, name: opts.name };
}

export async function getSubagentStatus(id?: string): Promise<SubagentState[]> {
  if (id) {
    const sub = await subagentRepo.getById(id);
    return sub ? [sub] : [];
  }
  // Return active + recent completed
  const active = await subagentRepo.getActive();
  const recent = await subagentRepo.getRecent(10);
  // Merge, preferring active entries for duplicates
  const seen = new Set(active.map((s) => s.id));
  return [...active, ...recent.filter((s) => !seen.has(s.id))];
}

export async function stopSubagent(id: string): Promise<{ success: boolean; error?: string }> {
  const active = activeSubagents.get(id);
  if (!active) {
    return { success: false, error: `Subagent ${id} is not running` };
  }

  active.abortController.abort();
  await subagentRepo.updateStatus(id, "stopped");
  activeSubagents.delete(id);

  broadcastEmit?.({ type: "subagent_completed", data: { id, name: active.name, status: "stopped", summary: "Stopped by parent agent" } });
  logger.info("subagent.stopped", { id, name: active.name });

  return { success: true };
}

/** Startup recovery: mark orphaned subagents as interrupted. */
export async function recoverOrphanedSubagents(): Promise<void> {
  const count = await subagentRepo.markOrphansInterrupted();
  if (count > 0) {
    logger.warn("subagent.recovery", { orphansMarked: count });
  }
}

export function getActiveCount(): number {
  return activeSubagents.size;
}

export function getActiveSummary(): Array<{ id: string; name: string; task: string }> {
  const result: Array<{ id: string; name: string; task: string }> = [];
  for (const [, sub] of activeSubagents) {
    result.push({ id: sub.id, name: sub.name, task: "" });
  }
  return result;
}

// ── Subagent execution ───────────────────────────────────────────────

interface RunSubagentOpts {
  id: string;
  name: string;
  session: NonNullable<ReturnType<typeof createSession>>;
  taskPrompt: string;
  loopMode: LoopMode;
  allowTrades: boolean;
  signal: AbortSignal;
}

const PROGRESS_BROADCAST_INTERVAL = 3;

async function runSubagent(opts: RunSubagentOpts): Promise<void> {
  const { id, name, session, taskPrompt, loopMode, allowTrades, signal } = opts;
  const startTime = Date.now();
  let resultText = "";
  let iterationCount = 0;

  try {
    const executionPromise = executeSubagentInference(
      session, taskPrompt, loopMode, allowTrades, signal,
      (text) => { resultText += text; },
      () => {
        iterationCount++;
        if (iterationCount % PROGRESS_BROADCAST_INTERVAL === 0) {
          broadcastEmit?.({ type: "subagent_progress", data: { id, name, iteration: iterationCount, toolCalls: iterationCount } });
        }
      },
    );

    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Subagent stopped by parent")), { once: true });
    });

    await withTimeout(Promise.race([executionPromise, abortPromise]), SUBAGENT_TIMEOUT_MS, `Subagent ${name}`);
    await finalizeSubagent(id, name, "completed", startTime, resultText, iterationCount);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status: SubagentStatus = msg.includes("timed out") ? "timeout" : msg.includes("stopped by parent") ? "stopped" : "error";
    await finalizeSubagent(id, name, status, startTime, resultText, iterationCount, msg);
  }
}

async function executeSubagentInference(
  session: NonNullable<ReturnType<typeof createSession>>,
  taskPrompt: string, loopMode: LoopMode, allowTrades: boolean, signal: AbortSignal,
  onText: (text: string) => void, onToolResult: () => void,
): Promise<void> {
  await withSessionLock(session.id, async () => {
    await processMessage(session, taskPrompt, (event: AgentEvent) => {
      if (signal.aborted) return;
      if (event.type === "text_delta" && typeof event.data.text === "string") onText(event.data.text);
      if (event.type === "tool_result") onToolResult();
    }, allowTrades ? loopMode : "restricted");
  });
}

async function finalizeSubagent(
  id: string, name: string, status: SubagentStatus, startTime: number,
  resultText: string, iterationCount: number, errorMsg?: string,
): Promise<void> {
  const durationMs = Date.now() - startTime;

  if (status === "completed") {
    const summary = truncateResult(resultText);
    await subagentRepo.updateStatus(id, "completed", { result: resultText, iterations: iterationCount });
    await publishInboxEvent("subagent_completed", { id, name, summary, status: "completed" });
    broadcastEmit?.({ type: "subagent_completed", data: { id, name, status: "completed", summary, durationMs, iterations: iterationCount } });
    logger.info("subagent.completed", { id, name, durationMs, iterations: iterationCount });
  } else {
    await subagentRepo.updateStatus(id, status, { error: errorMsg, result: resultText || undefined, iterations: iterationCount });
    if (status !== "stopped") {
      await publishInboxEvent("subagent_completed", { id, name, status, error: errorMsg });
    }
    broadcastEmit?.({ type: "subagent_completed", data: { id, name, status, summary: errorMsg ?? "", durationMs } });
    logger.warn("subagent.failed", { id, name, status, error: errorMsg });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildSubagentPrompt(name: string, task: string, allowTrades: boolean): string {
  const tradeClause = allowTrades
    ? "You CAN execute trades and on-chain mutations."
    : "You CANNOT execute trades or on-chain mutations. You are read-only for chain operations.";

  return `You are ${name}, a subagent spawned by the main EchoClaw agent.

Your task: ${task}

Rules:
- ${tradeClause}
- You have access to skills via file_read — load them if needed.
- Write your results to knowledge/subagents/ folder as instructed in your task.
- You can read shared memory but CANNOT modify it (memory_manage is read-only for you).
- You CANNOT spawn other subagents.
- Be thorough but concise. Complete your task and report findings clearly.
- When done, provide a clear summary of findings and any recommended actions.`;
}

function truncateResult(text: string): string {
  if (!text) return "(no output)";
  // Rough token estimate: ~4 chars per token
  const maxChars = SUBAGENT_RESULT_MAX_TOKENS * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[... truncated — full output in knowledge/subagents/]";
}
