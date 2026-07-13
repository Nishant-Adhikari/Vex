import { getLatestSessionIdForPosition } from "@vex-agent/db/repos/activity.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import { appendEngineMessage } from "@vex-agent/engine/events/index.js";
import logger from "@utils/logger.js";

export interface HyperliquidProtectionNotifierDeps {
  readonly getLatestSessionIdForPosition: typeof getLatestSessionIdForPosition;
  readonly getActiveRunBySession: typeof missionRunsRepo.getActiveRunBySession;
  readonly getPendingForSession: typeof loopWakeRepo.getPendingForSession;
  readonly promotePendingWakeForSafety: typeof loopWakeRepo.promotePendingWakeForSafety;
  readonly enqueueWake: typeof loopWakeRepo.enqueue;
  readonly appendEngineMessage: typeof appendEngineMessage;
}

export async function wakeOrNotifyConsolidation(capture: Record<string, unknown>, deps: HyperliquidProtectionNotifierDeps): Promise<void> {
  await wakeOrNotify(capture, deps, "consolidation", "CONSOLIDATING protection detected. Use hyperliquid.perp.setTpsl to place a full-position stop, then cancel the transient fixed-size child before any other Hyperliquid action.");
}

export async function wakeOrNotifyUnprotected(capture: Record<string, unknown>, deps: HyperliquidProtectionNotifierDeps): Promise<void> {
  await wakeOrNotify(capture, deps, "unprotected", "UNPROTECTED Hyperliquid position detected. Verify protection immediately; if it cannot be restored, propose a reduce-only close.");
}

async function wakeOrNotify(
  capture: Record<string, unknown>,
  deps: HyperliquidProtectionNotifierDeps,
  kind: "consolidation" | "unprotected",
  notice: string,
): Promise<void> {
  const positionKey = stringField(capture, "positionKey");
  const coin = metaString(capture, "coin");
  if (positionKey === undefined || coin === undefined) return;
  const sessionId = await deps.getLatestSessionIdForPosition(positionKey);
  if (sessionId === null) {
    logger.warn("hyperliquid.reconcile.no_owning_session", { coin, kind });
    return;
  }
  const run = await deps.getActiveRunBySession(sessionId);
  const pending = await deps.getPendingForSession(sessionId);
  if (run?.status === "paused_wake" && pending !== null) {
    const promoted = await deps.promotePendingWakeForSafety(sessionId, run.id);
    if (promoted) return;
  }
  if (run?.status === "paused_wake" && pending === null) {
    const row = await deps.enqueueWake({
      sessionId,
      missionRunId: run.id,
      dueAt: new Date(),
      reason: `hyperliquid ${kind}: ${coin}`,
      payload: { trigger: `hyperliquid_${kind}`, positionKey, coin },
    });
    if (row !== null) return;
  }
  await deps.appendEngineMessage(sessionId, `[Engine: hyperliquid_${kind} — ${notice}]`, {
    source: "engine",
    messageType: "hyperliquid_protection",
    visibility: "internal",
    payload: { kind, positionKey, coin },
  });
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function metaString(capture: Record<string, unknown>, key: string): string | undefined {
  const value = capture.meta;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return stringField(value as Record<string, unknown>, key);
}

