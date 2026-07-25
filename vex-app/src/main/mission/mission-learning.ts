/**
 * Mission LEARNING pass — the finalize-triggered orchestration that closes the
 * self-improving loop. Installed as the engine's `MissionLearningSink` at boot;
 * the engine fires it (fire-and-forget) on every terminal mission finalize.
 *
 * Ordered, and each step fully FAIL-SOFT:
 *   1. BANK the retrospective at finalize (reuse the existing generator — it
 *      persists `{ summary, wentWell, wentWrong, lessons }` so every mission
 *      banks lessons even if the card is never viewed). This runs regardless of
 *      the kill switch.
 *   2. If the loop KILL SWITCH is off → stop. Missions keep running under the
 *      currently-active (baseline until approved) adaptive section.
 *   3. Gather the active section + baseline + recently-adopted history + recent
 *      missions' banked lessons; apply the anti-overfit recurrence gate.
 *   4. Run the guarded rewrite (rewriter + gates + safety judge).
 *   5. Persist the outcome: a rejected revision is logged for audit; an accepted
 *      revision is stored PENDING (default posture — awaits ONE human approval),
 *      or activated immediately only when full-auto is explicitly enabled.
 *
 * No step can throw out of `runMissionLearning` — the caller does not await it.
 */

import { randomUUID } from "node:crypto";
import { ADAPTIVE_STRATEGY_BASELINE } from "@vex-agent/engine/prompts/mission-adaptive.js";
import {
  clusterRecurringLessons,
  type MissionLessonInput,
} from "@vex-agent/engine/mission/strategy-guardrails.js";
import type { MissionFinalizedEvent } from "@vex-agent/engine/mission/mission-learning-registry.js";
import type { RecentMissionLessons } from "@vex-agent/db/repos/mission-retrospectives.js";
import type { StrategyVersionRow } from "@vex-agent/db/repos/strategy-versions.js";
import { log } from "../logger/index.js";
import { resolveStrategyLoopConfig, type StrategyLoopConfig } from "./strategy-config.js";
import { proposeRevision, type RewriteDecision } from "./strategy-rewrite.js";

/** Injectable seams (production wires the real reads/writes + inference). */
export interface LearningDeps {
  /** Bank (generate + persist) the retrospective for the finalized session. */
  bankRetrospective: (sessionId: string, correlationId: string) => Promise<unknown>;
  ensureBaseline: (content: string) => Promise<StrategyVersionRow>;
  getActive: () => Promise<StrategyVersionRow | null>;
  getBaseline: () => Promise<StrategyVersionRow | null>;
  getRecentAdopted: (k: number) => Promise<string[]>;
  listRecentLessons: (limit: number) => Promise<RecentMissionLessons[]>;
  insertProposal: (input: {
    id: string;
    content: string;
    status: "pending" | "rejected";
    drivingMissionRunId: string | null;
    drivingLessons: string[];
    rejectionReason: string | null;
    audit: Record<string, unknown>;
    model: string | null;
  }) => Promise<StrategyVersionRow>;
  activateVersion: (id: string) => Promise<StrategyVersionRow | null>;
  /** Run the guarded rewrite. Default wires `proposeRevision` with vault env. */
  propose: (ctx: import("./strategy-rewrite.js").RewriteContext, correlationId: string) => Promise<RewriteDecision>;
  config: StrategyLoopConfig;
}

async function productionDeps(): Promise<LearningDeps | null> {
  const { getOrGenerateRetrospective } = await import("./retrospective.js");
  const strat = await import("@vex-agent/db/repos/strategy-versions.js");
  const retro = await import("@vex-agent/db/repos/mission-retrospectives.js");
  const apiKey = process.env["OPENROUTER_API_KEY"];
  const model = process.env["AGENT_MODEL"];
  const config = resolveStrategyLoopConfig();
  return {
    bankRetrospective: (sessionId, correlationId) =>
      getOrGenerateRetrospective(sessionId, correlationId),
    ensureBaseline: strat.ensureBaseline,
    getActive: strat.getActiveVersion,
    getBaseline: strat.getBaselineVersion,
    getRecentAdopted: strat.getRecentAdoptedContents,
    listRecentLessons: retro.listRecentMissionLessons,
    insertProposal: (input) =>
      strat.insertProposal({
        id: input.id,
        content: input.content,
        status: input.status,
        drivingMissionRunId: input.drivingMissionRunId,
        drivingLessons: input.drivingLessons,
        rejectionReason: input.rejectionReason,
        audit: input.audit,
        model: model ?? null,
      }),
    activateVersion: strat.activateVersion,
    propose: async (ctx, correlationId) => {
      if (
        typeof apiKey !== "string" || apiKey.length === 0 ||
        typeof model !== "string" || model.length === 0
      ) {
        return { kind: "skipped", reason: "inference unavailable (no key/model)" };
      }
      return proposeRevision(ctx, { apiKey, model }, correlationId);
    },
    config,
  };
}

function toLessonInputs(rows: readonly RecentMissionLessons[]): MissionLessonInput[] {
  return rows.map((r) => ({
    missionRunId: r.missionRunId,
    outcome: r.outcome,
    trades: r.trades,
    lessons: r.lessons,
    wentWrong: r.wentWrong,
  }));
}

/**
 * The learning pass. NEVER throws (the caller fires it without awaiting). Returns
 * a short status string for tests/logging; production ignores the return.
 */
export async function runMissionLearning(
  event: MissionFinalizedEvent,
  injected?: LearningDeps,
): Promise<string> {
  const correlationId = `learn-${event.runId}`;
  let deps: LearningDeps;
  try {
    const resolved = injected ?? (await productionDeps());
    if (resolved === null) return "no_deps";
    deps = resolved;
  } catch (err) {
    log.warn(`[mission:learn] dep init failed correlationId=${correlationId}`, err);
    return "dep_init_failed";
  }

  // ── 1. Bank the retrospective at finalize (regardless of the kill switch) ──
  try {
    await deps.bankRetrospective(event.sessionId, correlationId);
  } catch (err) {
    log.warn(`[mission:learn] retrospective banking failed correlationId=${correlationId}`, err);
    // continue — banking failure must not block the (guarded) rewrite attempt
  }

  // ── 2. Kill switch ──
  if (!deps.config.enabled) {
    log.info(`[mission:learn] autotune disabled (kill switch) — retrospective banked only correlationId=${correlationId}`);
    return "disabled";
  }

  try {
    // ── 3. Gather inputs ──
    await deps.ensureBaseline(ADAPTIVE_STRATEGY_BASELINE);
    const [active, baselineRow, recentAdopted, recentRows] = await Promise.all([
      deps.getActive(),
      deps.getBaseline(),
      deps.getRecentAdopted(deps.config.guardrails.flipFlopWindow + 1),
      deps.listRecentLessons(deps.config.recentMissionWindow),
    ]);
    const currentAdaptive = active?.content ?? ADAPTIVE_STRATEGY_BASELINE;
    const baseline = baselineRow?.content ?? ADAPTIVE_STRATEGY_BASELINE;

    const lessonInputs = toLessonInputs(recentRows);
    const adoptedLessons = clusterRecurringLessons(
      lessonInputs,
      deps.config.guardrails.recurrenceMin,
    );
    const latest = recentRows.find((r) => r.missionRunId === event.runId) ?? null;

    // ── 4. Guarded rewrite ──
    const decision = await deps.propose(
      {
        currentAdaptive,
        baseline,
        recentAdopted: recentAdopted.length > 0 ? recentAdopted : [currentAdaptive],
        adoptedLessons,
        latestOutcome: event.outcome,
        latestWentWrong: latest?.wentWrong ?? [],
        recentMissions: recentRows.map((r) => ({
          outcome: r.outcome,
          trades: r.trades,
          pnlPct: r.pnlPct,
          summary: r.summary,
        })),
        guardrails: deps.config.guardrails,
      },
      correlationId,
    );

    // ── 5. Persist the decision ──
    return await persistDecision(deps, event, adoptedLessons, decision, correlationId);
  } catch (err) {
    log.warn(`[mission:learn] rewrite pass failed correlationId=${correlationId}`, err);
    return "rewrite_failed";
  }
}

async function persistDecision(
  deps: LearningDeps,
  event: MissionFinalizedEvent,
  adoptedLessons: string[],
  decision: RewriteDecision,
  correlationId: string,
): Promise<string> {
  if (decision.kind === "skipped" || decision.kind === "no_lessons") {
    log.info(`[mission:learn] no revision (${decision.kind}: ${decision.reason}) correlationId=${correlationId}`);
    return decision.kind;
  }

  if (decision.kind === "rejected") {
    // Audit-only row — the revision is refused, the prior active version stays.
    const row = await deps.insertProposal({
      id: `strat-${randomUUID()}`,
      content: decision.content ?? "",
      status: "rejected",
      drivingMissionRunId: event.runId,
      drivingLessons: adoptedLessons,
      rejectionReason: decision.reasons.join("; "),
      audit: decision.audit,
      model: null,
    });
    log.warn(
      `[mission:learn] revision REJECTED v${row.versionNo} reasons="${decision.reasons.join("; ")}" correlationId=${correlationId}`,
    );
    return "rejected";
  }

  // accepted — store PENDING (default), activate only under explicit full-auto.
  const pending = await deps.insertProposal({
    id: `strat-${randomUUID()}`,
    content: decision.content,
    status: "pending",
    drivingMissionRunId: event.runId,
    drivingLessons: adoptedLessons,
    rejectionReason: null,
    audit: decision.audit,
    model: null,
  });

  if (deps.config.autoApprove) {
    const activated = await deps.activateVersion(pending.id);
    log.info(
      `[mission:learn] revision AUTO-APPROVED + activated v${pending.versionNo} (full-auto) correlationId=${correlationId}`,
    );
    return activated ? "activated" : "activate_failed";
  }

  log.info(
    `[mission:learn] revision PENDING approval v${pending.versionNo} — awaiting human review correlationId=${correlationId}`,
  );
  return "pending";
}

/** The production `MissionLearningSink` — wired at boot in `setupAgentBridges`. */
export function createMissionLearningSink(): {
  onMissionFinalized: (event: MissionFinalizedEvent) => Promise<void>;
} {
  return {
    onMissionFinalized: async (event) => {
      await runMissionLearning(event);
    },
  };
}
