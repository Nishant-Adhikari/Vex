/**
 * Strategy rewrite ORCHESTRATION — the one-shot rewriter + the adversarial
 * safety judge + every guardrail gate, producing a DECISION the caller persists.
 *
 * SAFETY-CRITICAL. Two independent one-shot OpenRouter completions (same path as
 * the retrospective / Signals grade — NOT the mission turn-loop):
 *   1. REWRITER   — consolidates the ADAPTIVE TACTICS from recurring lessons.
 *   2. SAFETY JUDGE — a SEPARATE adversarial pass that must explicitly bless the
 *      revision; unparseable / uncertain / unsafe all REJECT (fail-closed).
 *
 * Layered gates, ALL must pass for `accepted`:
 *   - deterministic guardrails (size, well-formed, red-flag scan, delta bound,
 *     baseline-distance bound, flip-flop) — `validateRevision`
 *   - immutable-core preserved in the ASSEMBLED (core + revised) prompt
 *   - the LLM safety judge blesses it
 *
 * Everything is FAIL-SOFT toward "keep the prior active version": inference
 * unavailable, no recurring lessons, a no-op revision, an unparseable reply, or
 * any thrown error yields a non-`accepted` decision and never touches the live
 * strategy. This module does NO DB writes — the caller records the decision.
 */

import { OpenRouter } from "@vex-lib/openrouter-client.js";
import {
  buildMissionSafetyCorePrompt,
  findMissingSafetyMarkers,
} from "@vex-agent/engine/prompts/mission-safety-core.js";
import { assembleStrategyPrompt } from "@vex-agent/engine/prompts/mission-adaptive.js";
import {
  validateRevision,
  contentDistance,
  type GuardrailConfig,
} from "@vex-agent/engine/mission/strategy-guardrails.js";
import { log } from "../logger/index.js";
import {
  OPENROUTER_APP_TITLE,
  OPENROUTER_APP_URL,
  OPENROUTER_NOOP_LOGGER,
} from "../onboarding/openrouter-app-identity.js";
import {
  REWRITE_MAX_OUTPUT_TOKENS,
  JUDGE_MAX_OUTPUT_TOKENS,
  buildRewriteMessages,
  buildJudgeMessages,
  parseRewriteResponse,
  parseJudgeResponse,
  type MissionDigestEntry,
  type JudgeVerdict,
} from "./strategy-rewrite-prompt.js";

const REWRITE_TIMEOUT_MS = 30_000;
/** Below this distance from the prior, a "revision" is a no-op — nothing to adopt. */
const NO_OP_EPSILON = 0.02;

interface ChatSendResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: unknown };
  }>;
}

interface ChatClient {
  readonly chat: {
    readonly send: (
      body: unknown,
      options?: { signal?: AbortSignal; retries?: { strategy: "none" } },
    ) => Promise<unknown>;
  };
}

export interface RewriteContext {
  /** The CURRENT active adaptive section — the only strategy text the rewriter sees. */
  readonly currentAdaptive: string;
  /** The human baseline seed (for the baseline-distance bound). */
  readonly baseline: string;
  /** Recently-adopted contents newest-first, INCLUDING current at index 0 (flip-flop). */
  readonly recentAdopted: string[];
  /** Cross-mission recurring lessons, already filtered by the anti-overfit gate. */
  readonly adoptedLessons: string[];
  readonly latestOutcome: string;
  readonly latestWentWrong: string[];
  readonly recentMissions: MissionDigestEntry[];
  readonly guardrails: GuardrailConfig;
}

export interface RewriteDeps {
  readonly apiKey: string;
  readonly model: string;
  readonly clientFactory?: (apiKey: string, timeoutMs: number) => ChatClient;
  readonly timeoutMs?: number;
}

export type RewriteDecision =
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "no_lessons"; readonly reason: string }
  | {
      readonly kind: "rejected";
      readonly reasons: string[];
      readonly content: string | null;
      readonly judge: JudgeVerdict | null;
      readonly audit: Record<string, unknown>;
    }
  | {
      readonly kind: "accepted";
      readonly content: string;
      readonly judge: JudgeVerdict;
      readonly audit: Record<string, unknown>;
    };

function defaultClientFactory(apiKey: string, timeoutMs: number): ChatClient {
  return new OpenRouter({
    apiKey,
    debugLogger: OPENROUTER_NOOP_LOGGER,
    retryConfig: { strategy: "none" },
    timeoutMs,
    httpReferer: OPENROUTER_APP_URL,
    appTitle: OPENROUTER_APP_TITLE,
  }) as unknown as ChatClient;
}

async function oneShot(
  client: ChatClient,
  model: string,
  messages: readonly { role: string; content: string }[],
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const response = await client.chat.send(
      {
        chatRequest: {
          model,
          messages,
          maxCompletionTokens: maxTokens,
          temperature: 0.2,
        },
      },
      { signal: ac.signal, retries: { strategy: "none" } },
    );
    const msg = (response as ChatSendResponse).choices?.[0]?.message;
    return typeof msg?.content === "string" ? msg.content : "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the full rewrite pipeline and return a decision. Never throws — any error
 * resolves to `skipped` (keep prior active version). Persists nothing.
 */
export async function proposeRevision(
  ctx: RewriteContext,
  deps: RewriteDeps,
  correlationId: string,
): Promise<RewriteDecision> {
  // Anti-overfit: nothing recurs across enough trading missions → do not touch
  // the strategy on a single mission's noise.
  if (ctx.adoptedLessons.length === 0) {
    return { kind: "no_lessons", reason: "no recurring lessons met the recurrence threshold" };
  }

  const factory = deps.clientFactory ?? defaultClientFactory;
  const timeoutMs = deps.timeoutMs ?? REWRITE_TIMEOUT_MS;
  const client = factory(deps.apiKey, timeoutMs);

  // ── 1. REWRITER (one-shot) ──
  let revised: string | null;
  try {
    const raw = await oneShot(
      client,
      deps.model,
      buildRewriteMessages({
        currentAdaptive: ctx.currentAdaptive,
        adoptedLessons: ctx.adoptedLessons,
        latestOutcome: ctx.latestOutcome,
        latestWentWrong: ctx.latestWentWrong,
        recentMissions: ctx.recentMissions,
      }),
      REWRITE_MAX_OUTPUT_TOKENS,
      timeoutMs,
    );
    revised = parseRewriteResponse(raw);
  } catch (cause) {
    const cls = cause instanceof Error ? cause.constructor.name : typeof cause;
    log.warn(`[mission:strategy] rewriter call failed class=${cls} correlationId=${correlationId}`);
    return { kind: "skipped", reason: "rewriter inference failed" };
  }
  if (revised === null) {
    log.warn(`[mission:strategy] rewriter reply unparseable correlationId=${correlationId}`);
    return { kind: "skipped", reason: "rewriter reply unparseable" };
  }

  // No-op: rewriter returned essentially the current section — nothing to adopt.
  if (contentDistance(ctx.currentAdaptive, revised) <= NO_OP_EPSILON) {
    return { kind: "skipped", reason: "revision is a no-op (no material change)" };
  }

  const deltaDistance = contentDistance(ctx.currentAdaptive, revised);
  const baselineDistance = contentDistance(ctx.baseline, revised);
  const auditBase: Record<string, unknown> = {
    model: deps.model,
    adoptedLessonCount: ctx.adoptedLessons.length,
    deltaDistance,
    baselineDistance,
    diff: { before: ctx.currentAdaptive, after: revised },
  };

  // ── 2. DETERMINISTIC GATE (size, well-formed, red-flags, delta, baseline, flip-flop) ──
  const gate = validateRevision({
    revised,
    prior: ctx.currentAdaptive,
    baseline: ctx.baseline,
    recentAdopted: ctx.recentAdopted,
    config: ctx.guardrails,
  });
  if (!gate.ok) {
    log.warn(
      `[mission:strategy] rejected by gate reasons=${gate.reasons.join("; ")} correlationId=${correlationId}`,
    );
    return {
      kind: "rejected",
      reasons: gate.reasons,
      content: revised,
      judge: null,
      audit: { ...auditBase, gateReasons: gate.reasons, stage: "deterministic_gate" },
    };
  }

  // ── 3. IMMUTABLE-CORE PRESERVED in the ASSEMBLED prompt ──
  const assembled = assembleStrategyPrompt(buildMissionSafetyCorePrompt(), revised);
  const missing = findMissingSafetyMarkers(assembled);
  if (missing.length > 0) {
    log.warn(
      `[mission:strategy] rejected: safety-core markers missing=${missing.join(",")} correlationId=${correlationId}`,
    );
    return {
      kind: "rejected",
      reasons: [`safety-core markers missing after assembly: ${missing.join(", ")}`],
      content: revised,
      judge: null,
      audit: { ...auditBase, missingSafetyMarkers: missing, stage: "safety_core_assembly" },
    };
  }

  // ── 4. SECOND-LLM ADVERSARIAL SAFETY JUDGE (fail-closed) ──
  let judge: JudgeVerdict;
  try {
    const raw = await oneShot(
      client,
      deps.model,
      buildJudgeMessages(revised),
      JUDGE_MAX_OUTPUT_TOKENS,
      timeoutMs,
    );
    judge = parseJudgeResponse(raw);
  } catch (cause) {
    // Cannot obtain an independent safety opinion → REJECT (fail-closed). The
    // prior active version stays live; the attempt is audited.
    const cls = cause instanceof Error ? cause.constructor.name : typeof cause;
    log.warn(`[mission:strategy] safety judge call failed class=${cls} correlationId=${correlationId}`);
    return {
      kind: "rejected",
      reasons: ["safety judge unavailable — fail-closed"],
      content: revised,
      judge: { safe: false, reason: "judge call failed" },
      audit: { ...auditBase, judge: { safe: false, reason: "call failed" }, stage: "safety_judge" },
    };
  }
  if (!judge.safe) {
    log.warn(
      `[mission:strategy] rejected by safety judge reason="${judge.reason}" correlationId=${correlationId}`,
    );
    return {
      kind: "rejected",
      reasons: [`safety judge: ${judge.reason}`],
      content: revised,
      judge,
      audit: { ...auditBase, judge, stage: "safety_judge" },
    };
  }

  // All gates passed.
  log.info(
    `[mission:strategy] revision accepted delta=${deltaDistance.toFixed(2)} lessons=${ctx.adoptedLessons.length} correlationId=${correlationId}`,
  );
  return {
    kind: "accepted",
    content: revised,
    judge,
    audit: { ...auditBase, judge, stage: "accepted" },
  };
}
