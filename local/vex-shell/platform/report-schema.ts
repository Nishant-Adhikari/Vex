/**
 * Per-session report schema — discriminated union of every event the local
 * shell records for a session, plus the secret-redaction primitive applied to
 * tool args and outputs before serialization.
 *
 * Pure module — no fs, no logger, no side-effects. The writer
 * (`session-report.ts`) and any downstream evaluator both import from here so
 * the schema is the single source of truth.
 *
 * Each event is enriched by the writer with `seq` (monotonic per-session
 * counter), `at` (ISO8601), and `sessionId` before being persisted. Callers
 * only supply the kind-specific payload — see `RecordableEvent` below.
 */

import { z } from "zod";

// ── Base envelope ────────────────────────────────────────────────────────────

const baseEnvelope = z.object({
  /** Monotonic counter assigned by the reporter, starting at 1. */
  seq: z.number().int().nonnegative(),
  /** ISO8601 timestamp assigned by the reporter at write time. */
  at: z.string().min(1),
  /** Session ID assigned by the reporter from the factory binding. */
  sessionId: z.string().min(1),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const loopModeSchema = z.enum(["off", "restricted", "full"]);
const wizardModeSchema = z.enum(["chat", "mission", "full_autonomous"]);
const sessionKindSchema = z.enum(["chat", "full_autonomous"]);

// ── Event payloads ──────────────────────────────────────────────────────────

const sessionStartedSchema = baseEnvelope.extend({
  kind: z.literal("sessionStarted"),
  mode: wizardModeSchema,
  sessionKind: sessionKindSchema,
  loopMode: loopModeSchema.nullable(),
  provider: z.string().min(1),
  providerDetail: z.string(),
  wakeEnabled: z.boolean(),
  /** Optional sha256 fingerprint of select env vars — helps an evaluator group runs. */
  envHash: z.string().optional(),
  /** Optional commit sha of the shell, when discoverable from process.env. */
  shellGitSha: z.string().optional(),
  /** Reporter version — bump when the schema evolves to enable downstream gating. */
  schemaVersion: z.literal(1),
});

const userMessageSchema = baseEnvelope.extend({
  kind: z.literal("userMessage"),
  text: z.string(),
  source: z.enum(["input", "wizard_goal", "slash"]),
});

const assistantMessageSchema = baseEnvelope.extend({
  kind: z.literal("assistantMessage"),
  text: z.string(),
  stopReason: z.string().nullable(),
  missionStatus: z.string().nullable(),
});

const toolCallSchema = baseEnvelope.extend({
  kind: z.literal("toolCall"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  args: z.unknown(),
  /** Whether `args` were passed through the secret redactor. */
  redacted: z.boolean(),
  /** ID of the source `messages` row — useful for cross-referencing the DB. */
  sourceRowId: z.number().int().nonnegative(),
});

const toolResultSchema = baseEnvelope.extend({
  kind: z.literal("toolResult"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  success: z.boolean(),
  status: z.enum(["done", "failed"]),
  /** Full tool output — already blob-resolved when the engine externalised it. */
  output: z.string(),
  byteSize: z.number().int().nonnegative(),
  fromBlob: z.boolean(),
  blobKey: z.string().optional(),
  completedAt: z.string().min(1),
  durationMs: z.number().int().nonnegative().nullable(),
  /** Whether `output` was passed through the secret redactor. */
  redacted: z.boolean(),
});

const approvalSchema = baseEnvelope.extend({
  kind: z.literal("approval"),
  approvalId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  source: z.enum(["hotkey", "slash"]),
  /** Tool the approval was gating, when known at decision time. */
  toolName: z.string().nullable(),
});

const turnCompletedSchema = baseEnvelope.extend({
  kind: z.literal("turnCompleted"),
  latencyMs: z.number().int().nonnegative(),
  toolCallsMade: z.number().int().nonnegative(),
  pendingApprovals: z.number().int().nonnegative(),
  textLength: z.number().int().nonnegative(),
  stopReason: z.string().nullable(),
  missionStatus: z.string().nullable(),
  source: z.enum(["input", "wizard_goal", "slash_approve", "slash_mission_start", "slash_mission_continue", "slash_mission_edit"]),
});

const engineSignalSchema = baseEnvelope.extend({
  kind: z.literal("engineSignal"),
  /** The reporter sees `stopReason` from `TurnResult`, not the engine's
   *  EngineSignal directly. `derivedFrom` is explicit so an evaluator does
   *  not confuse derived signals with first-class observation. */
  derivedFrom: z.enum(["stopReason", "missionStatus"]),
  signal: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const errorSchema = baseEnvelope.extend({
  kind: z.literal("error"),
  where: z.enum(["turn", "setup", "approve", "reject", "abort", "mission_start", "mission_continue", "mission_edit"]),
  message: z.string(),
});

const sessionEndedSchema = baseEnvelope.extend({
  kind: z.literal("sessionEnded"),
  reason: z.enum(["user_exit", "sigint", "sigterm", "error"]),
  totals: z.object({
    events: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    toolResults: z.number().int().nonnegative(),
    approvals: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
});

export const reportEventSchema = z.discriminatedUnion("kind", [
  sessionStartedSchema,
  userMessageSchema,
  assistantMessageSchema,
  toolCallSchema,
  toolResultSchema,
  approvalSchema,
  turnCompletedSchema,
  engineSignalSchema,
  errorSchema,
  sessionEndedSchema,
]);

export type ReportEvent = z.infer<typeof reportEventSchema>;
export type ReportEventKind = ReportEvent["kind"];

/**
 * The shape callers actually pass to the reporter — `seq`, `at`, `sessionId`
 * are stamped by the writer. Each kind retains all other fields verbatim.
 */
export type RecordableEvent =
  | Omit<z.infer<typeof sessionStartedSchema>, "seq" | "at" | "sessionId">
  | Omit<z.infer<typeof userMessageSchema>, "seq" | "at" | "sessionId">
  | Omit<z.infer<typeof assistantMessageSchema>, "seq" | "at" | "sessionId">
  | Omit<z.infer<typeof toolCallSchema>, "seq" | "at" | "sessionId">
  | Omit<z.infer<typeof toolResultSchema>, "seq" | "at" | "sessionId">
  | Omit<z.infer<typeof approvalSchema>, "seq" | "at" | "sessionId">
  | Omit<z.infer<typeof turnCompletedSchema>, "seq" | "at" | "sessionId">
  | Omit<z.infer<typeof engineSignalSchema>, "seq" | "at" | "sessionId">
  | Omit<z.infer<typeof errorSchema>, "seq" | "at" | "sessionId">
  | Omit<z.infer<typeof sessionEndedSchema>, "seq" | "at" | "sessionId">;

// ── Companion meta file (written once on session end) ───────────────────────

export const reportMetaSchema = z.object({
  sessionId: z.string().min(1),
  mode: wizardModeSchema,
  sessionKind: sessionKindSchema,
  loopMode: loopModeSchema.nullable(),
  provider: z.string().min(1),
  providerDetail: z.string(),
  wakeEnabled: z.boolean(),
  schemaVersion: z.literal(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  endReason: z.enum(["user_exit", "sigint", "sigterm", "error"]),
  totals: z.object({
    events: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    toolResults: z.number().int().nonnegative(),
    approvals: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  reportFile: z.string().min(1),
  redactionEnabled: z.boolean(),
});

export type ReportMeta = z.infer<typeof reportMetaSchema>;

// ── Secret redaction ────────────────────────────────────────────────────────

interface RedactionRule {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * Best-effort secret patterns. NOT a security boundary — novel secret shapes
 * leak through. Order matters only to the extent that earlier rules catch
 * substrings before later (looser) rules; here all rules are non-overlapping.
 *
 * Sentinels are tagged so an evaluator can distinguish `[REDACTED:evm-pk]`
 * from a legitimate hex string the agent emitted in `output`.
 */
const REDACTION_RULES: readonly RedactionRule[] = [
  // Anchored Anthropic prefix first so it cannot be eaten by the generic OpenAI rule.
  { name: "anthropic-key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openrouter-key", pattern: /sk-or-[A-Za-z0-9_-]{20,}/g },
  { name: "openai-key", pattern: /sk-[A-Za-z0-9]{20,}/g },
  // EVM private key (32 bytes hex with 0x prefix).
  { name: "evm-pk", pattern: /\b0x[0-9a-fA-F]{64}\b/g },
  // Solana base58 secret keys (88 chars typical for full secret, 87 for derived).
  // Keep the alphabet restrictive so we do not eat random text.
  { name: "solana-key", pattern: /\b[1-9A-HJ-NP-Za-km-z]{87,88}\b/g },
  // JWT compact serialisation: header.payload.signature (no padding).
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  // Bearer tokens in Authorization headers / log lines.
  { name: "bearer", pattern: /Bearer\s+[A-Za-z0-9_\-.~+/=]{16,}/g },
  // Rettiwt/X cookie-session material.
  { name: "rettiwt-env", pattern: /\bRETTIWT_API_KEY\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}["']?/g },
  { name: "x-cookie", pattern: /\b(auth_token|ct0|kdt|twid)=([^;\s]+)/gi },
];

interface RedactOptions {
  readonly enabled: boolean;
}

interface RedactResult<T> {
  readonly value: T;
  readonly redacted: boolean;
}

function redactString(input: string): { out: string; hit: boolean } {
  let out = input;
  let hit = false;
  for (const rule of REDACTION_RULES) {
    const next = out.replace(rule.pattern, () => {
      hit = true;
      return `[REDACTED:${rule.name}]`;
    });
    out = next;
  }
  return { out, hit };
}

function redactWalk(value: unknown, state: { hit: boolean }): unknown {
  if (typeof value === "string") {
    const { out, hit } = redactString(value);
    if (hit) state.hit = true;
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactWalk(item, state));
  }
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      // Non-plain object (Buffer, Date, Map, ...) — stringify defensively to
      // avoid mutating engine internals or losing the value entirely.
      try {
        const { out, hit } = redactString(JSON.stringify(value));
        if (hit) state.hit = true;
        return out;
      } catch {
        return "[unserializable]";
      }
    }
    const next: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      next[key] = redactWalk(raw, state);
    }
    return next;
  }
  return value;
}

/**
 * Apply pattern-based redaction to a JSON-shaped value. Returns the new value
 * plus a boolean noting whether anything matched. When `enabled === false`
 * the input is returned unchanged with `redacted: false`.
 */
export function redactSecrets<T>(value: T, options: RedactOptions): RedactResult<T> {
  if (!options.enabled) return { value, redacted: false };
  const state = { hit: false };
  const next = redactWalk(value, state) as T;
  return { value: next, redacted: state.hit };
}

// ── Exhaustiveness helper ────────────────────────────────────────────────────

export function assertNever(x: never): never {
  throw new Error(`Unhandled report event variant: ${JSON.stringify(x)}`);
}
