/**
 * Echo Loop — phased autonomous loop runtime.
 *
 * Replaces the primitive setInterval + static prompt with a state machine:
 *   sense → assess → decide → execute → verify → journal → sleep
 *
 * Key design:
 * - Persistent loop session across cycles (agent remembers previous decisions)
 * - Autonomy inbox integration (events from monitors inject into sense phase)
 * - No policy engine — loopMode (restricted/full) is the only gate
 * - Circuit breaker: 5 consecutive infrastructure errors → auto-pause + alert
 * - Per-phase timeouts to prevent permanent hangs
 */

import { createSession, processMessage, getInferenceConfig } from "./engine.js";
import type { EventEmitter } from "./engine.js";
import { hydrateSession } from "./session-hydrate.js";
import { consumeAll, formatEventsForContext } from "./autonomy-inbox.js";
import * as loopRepo from "./db/repos/loop.js";
import * as sessionsRepo from "./db/repos/sessions.js";
import { withSessionLock } from "./session-lock.js";
import { generateId } from "./id.js";
import {
  LOOP_PHASE_TIMEOUT_MS,
  LOOP_CIRCUIT_BREAKER_THRESHOLD,
} from "./constants.js";
import { withTimeout } from "./resilience.js";
import { buildPhasePrompt } from "./prompts/loop-phases.js";
import type { LoopPhase, LoopMode, AgentEvent, ConversationSession } from "./types.js";
import logger from "../utils/logger.js";

// ── Runtime state ────────────────────────────────────────────────────

let loopTimer: ReturnType<typeof setTimeout> | null = null;
let loopSession: ConversationSession | null = null;
let cycleInFlight = false;
let consecutiveErrors = 0;
let currentCycleNumber = 0;

/** SSE emitter set by the caller — broadcasts loop events to connected clients. */
let broadcastEmit: EventEmitter | null = null;

// ── Public API ───────────────────────────────────────────────────────

export function setLoopBroadcast(emit: EventEmitter): void {
  broadcastEmit = emit;
}

export async function startEchoLoop(mode: LoopMode, intervalMs: number): Promise<void> {
  await stopEchoLoop();

  // Get current state to restore cycle count
  const state = await loopRepo.getLoopState();
  currentCycleNumber = state.cycleCount;
  consecutiveErrors = 0;

  // Create or restore persistent loop session
  loopSession = await getOrCreateLoopSession();
  if (!loopSession) {
    logger.error("echo-loop.start_failed", { reason: "cannot create session" });
    return;
  }

  await loopRepo.startLoop(mode, intervalMs);
  await loopRepo.setLoopSessionId(loopSession.id);

  logger.info("echo-loop.started", { mode, intervalMs, sessionId: loopSession.id });

  // Schedule first cycle
  scheduleNextCycle(intervalMs);
}

export async function stopEchoLoop(): Promise<void> {
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  cycleInFlight = false;
  loopSession = null;
  await loopRepo.stopLoop();
  logger.info("echo-loop.stopped");
}

export function isLoopRunning(): boolean {
  return loopTimer !== null;
}

// ── Cycle scheduling ─────────────────────────────────────────────────

function scheduleNextCycle(intervalMs: number): void {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = setTimeout(() => runCycle(intervalMs), intervalMs);
}

// Markers the LLM uses to signal "nothing to do" — shared contract between prompts and loop
const SENSE_QUIET_MARKERS = ["[no significant changes]", "[nothing to report]"];
const DECIDE_HOLD_MARKERS = ["[no action]", "[hold]"];

async function runCycle(intervalMs: number): Promise<void> {
  if (cycleInFlight) {
    logger.warn("echo-loop.cycle.skipped", { reason: "previous cycle still running" });
    scheduleNextCycle(intervalMs);
    return;
  }

  cycleInFlight = true;
  currentCycleNumber++;
  const cycleStart = new Date();
  const phasesCompleted: LoopPhase[] = [];

  try {
    const state = await loopRepo.getLoopState();
    if (!state.active) {
      logger.info("echo-loop.cycle.skipped", { reason: "loop no longer active" });
      cycleInFlight = false;
      return;
    }

    if (!loopSession) {
      loopSession = await getOrCreateLoopSession();
      if (!loopSession) throw new Error("Cannot create loop session");
    }

    await executePhases(state.mode, phasesCompleted);
    await recordCycleOutcome(cycleStart, phasesCompleted, "completed");
    consecutiveErrors = 0;
    logger.info("echo-loop.cycle.completed", { cycle: currentCycleNumber, phases: phasesCompleted });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    consecutiveErrors++;
    logger.error("echo-loop.cycle.failed", { cycle: currentCycleNumber, error: msg, consecutiveErrors });
    await recordCycleOutcome(cycleStart, phasesCompleted, "error", msg);

    if (consecutiveErrors >= LOOP_CIRCUIT_BREAKER_THRESHOLD) {
      logger.error("echo-loop.circuit_breaker", { consecutiveErrors });
      broadcastEmit?.({ type: "error", data: { message: `Echo Loop paused: ${consecutiveErrors} consecutive errors. Last: ${msg}` } });
      await stopEchoLoop();
      return;
    }
  } finally {
    cycleInFlight = false;
    await loopRepo.updatePhase("sleep");
  }

  const freshState = await loopRepo.getLoopState();
  if (freshState.active) scheduleNextCycle(freshState.intervalMs);
}

/** Orchestrate the sense→assess→decide→execute→verify→journal phases. */
async function executePhases(mode: LoopMode, phasesCompleted: LoopPhase[]): Promise<void> {
  const senseResult = await runPhase("sense", mode, phasesCompleted);
  const lower = senseResult.toLowerCase();
  const isQuiet = SENSE_QUIET_MARKERS.some((m) => lower.includes(m));

  if (!isQuiet) {
    const assessResult = await runPhase("assess", mode, phasesCompleted, senseResult);
    const decideResult = await runPhase("decide", mode, phasesCompleted, assessResult);
    const decideLower = decideResult.toLowerCase();
    const hasActions = !DECIDE_HOLD_MARKERS.some((m) => decideLower.includes(m));

    if (hasActions) {
      await runPhase("execute", mode, phasesCompleted, decideResult);
      await runPhase("verify", mode, phasesCompleted);
    }
  }

  await runPhase("journal", mode, phasesCompleted);
}

async function recordCycleOutcome(
  startedAt: Date, phasesCompleted: LoopPhase[], outcome: string, errorMessage?: string,
): Promise<void> {
  if (outcome === "completed") await loopRepo.recordCycle();
  await loopRepo.insertCycle({
    cycleNumber: currentCycleNumber,
    startedAt,
    endedAt: new Date(),
    phasesCompleted,
    outcome,
    errorMessage,
  });
}

// ── Phase execution ──────────────────────────────────────────────────

async function runPhase(
  phase: LoopPhase,
  mode: LoopMode,
  phasesCompleted: LoopPhase[],
  previousPhaseOutput?: string,
): Promise<string> {
  await loopRepo.updatePhase(phase);
  broadcastEmit?.({ type: "loop_phase", data: { phase, cycleNumber: currentCycleNumber, timestamp: new Date().toISOString() } });

  // Build phase-specific prompt
  let phasePrompt = buildPhasePrompt(phase, previousPhaseOutput);

  // Sense phase: inject autonomy inbox events
  if (phase === "sense") {
    const inboxEvents = await consumeAll();
    const eventsContext = formatEventsForContext(inboxEvents);
    if (eventsContext) {
      phasePrompt = `${eventsContext}\n\n${phasePrompt}`;
    }
  }

  // Execute with session lock and timeout
  let result = "";

  const phasePromise = withSessionLock(loopSession!.id, async () => {
    await processMessage(loopSession!, phasePrompt, (event: AgentEvent) => {
      if (event.type === "text_delta" && typeof event.data.text === "string") {
        result += event.data.text;
      }
      // Forward relevant events to broadcast
      if (broadcastEmit && (event.type === "tool_start" || event.type === "tool_result" || event.type === "approval_required")) {
        broadcastEmit(event);
      }
    }, mode);
  });

  await withTimeout(phasePromise, LOOP_PHASE_TIMEOUT_MS, `Phase ${phase}`);

  phasesCompleted.push(phase);
  return result;
}

// ── Session management ───────────────────────────────────────────────

async function getOrCreateLoopSession(): Promise<ConversationSession | null> {
  // Try to restore existing loop session
  const state = await loopRepo.getLoopState();
  if (state.loopSessionId) {
    try {
      const hydrated = await hydrateSession(state.loopSessionId);
      if (hydrated) {
        logger.info("echo-loop.session.restored", { sessionId: state.loopSessionId });
        return hydrated;
      }
    } catch {
      logger.warn("echo-loop.session.restore_failed", { sessionId: state.loopSessionId });
    }
  }

  // Create new loop session
  const session = createSession();
  if (!session) return null;

  await sessionsRepo.createSession(session.id);
  await sessionsRepo.setScope(session.id, "loop");

  logger.info("echo-loop.session.created", { sessionId: session.id });
  return session;
}
