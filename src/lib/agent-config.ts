/**
 * Agent + subagent core tuning — single source of truth (M9).
 *
 * Owns field metadata (key/min/max/default or fallbackFrom) AND the
 * parse pipeline that turns env strings into validated effective
 * values. Two consumers, two contracts:
 *
 *  - Engine (`src/vex-agent/inference/config.ts`) imports field
 *    constants and `parseAgentEnv` / `parseSubagentEnv`. AGENT_*
 *    invalid values throw a combined error (existing engine
 *    behavior). SUBAGENT_* invalid values fall back silently with a
 *    `logger.warn` (existing engine behavior — engine ignores the
 *    `errors[]` returned by the helper).
 *
 *  - vex-app (`vex-app/src/main/onboarding/agent-core-writer.ts`)
 *    uses the same helpers but enforces strict validation at the
 *    write boundary: any AGENT or SUBAGENT parse error blocks the
 *    write with `validation.invalid_input`.
 *
 * Both consumers share the exact range/default constants — no
 * duplicated literals, no drift.
 *
 * Pure module: no fs, no DB, no Electron, no logger. Safe to import
 * from `src/shared/*` and from vex-app preload contexts.
 */

export type FieldKind = "int" | "float";

export interface FieldBase {
  readonly key: string;
  readonly kind: FieldKind;
  readonly min: number;
  readonly max: number;
}

export interface FieldWithDefault extends FieldBase {
  readonly default: number | null;
  readonly fallbackFrom?: never;
}

export interface FieldWithFallback extends FieldBase {
  readonly default?: never;
  readonly fallbackFrom: "agent.maxOutputTokens" | "agent.temperature";
}

export type AgentField = FieldWithDefault;
export type SubagentField = FieldWithDefault | FieldWithFallback;

export const AGENT_CONTEXT_LIMIT: FieldWithDefault = {
  key: "AGENT_CONTEXT_LIMIT",
  kind: "int",
  min: 1000,
  max: 2_000_000,
  default: 128_000,
};

export const AGENT_MAX_OUTPUT_TOKENS: FieldWithDefault = {
  key: "AGENT_MAX_OUTPUT_TOKENS",
  kind: "int",
  min: 256,
  max: 128_000,
  default: 16_384,
};

export const AGENT_TEMPERATURE: FieldWithDefault = {
  key: "AGENT_TEMPERATURE",
  kind: "float",
  min: 0,
  max: 2,
  default: null,
};

/**
 * Hard per-mission TOKEN BUDGET (whole tokens). A cumulative ceiling on a single
 * mission run's prompt+completion spend: once crossed, the run loop stops with
 * `token_budget_exhausted` before issuing another LLM call. The backstop a broken
 * model that loops a tool (one such loop burned ~9M tokens / ~$3) needs.
 *
 * Read like the other AGENT_* fields, but FAIL-OPEN (see
 * `resolveMissionTokenBudget`): a missing/blank/invalid value resolves to the
 * 500000 default rather than throwing, because a mis-set budget must never block
 * a run from starting — the same fail-open stance as the hard-deadline env.
 */
export const AGENT_MISSION_TOKEN_BUDGET: FieldWithDefault = {
  key: "AGENT_MISSION_TOKEN_BUDGET",
  kind: "int",
  min: 1,
  // Upper bound raised to MAX_SAFE_INTEGER so a large, INTENTIONAL budget is
  // honored rather than silently downgraded to the 500000 default. The former
  // `1_000_000_000` cap shrank e.g. 2e9 → out-of-range → 500000 (a surprise
  // early abort). There is no meaningful too-high ceiling for a spend backstop.
  max: Number.MAX_SAFE_INTEGER,
  default: 500_000,
};

/**
 * Explicit values that DISABLE the hard token-budget guard entirely (resolve to
 * `null` = "no box"). Case-insensitive, trimmed. This is the ONLY way to turn
 * the backstop off: a blank/unset var keeps the safe 500000 default so the guard
 * can never be silently removed by an empty env. `0` is treated as an intentional
 * "unlimited" sentinel here (not an out-of-range number).
 */
const MISSION_TOKEN_BUDGET_DISABLE_SENTINELS: ReadonlySet<string> = new Set([
  "0",
  "off",
  "none",
  "unlimited",
  "disable",
  "disabled",
]);

/**
 * Per-minute token burn used to DERIVE a mission's token budget from its
 * duration (`AGENT_MISSION_TOKEN_BUDGET` unset → dynamic). Empirical: a trimmed
 * mission turn-loop burned ~2M tokens in ~15 min (~135k/min); default rounds up
 * with headroom so a run reaches its time-box instead of token-capping early.
 */
export const AGENT_MISSION_TOKENS_PER_MINUTE: FieldWithDefault = {
  key: "AGENT_MISSION_TOKENS_PER_MINUTE",
  kind: "int",
  min: 1,
  max: Number.MAX_SAFE_INTEGER,
  default: 150_000,
};

/** Duration fallback when a mission carries no valid `durationMinutes` — mirrors
 * the deadline resolver's 60-minute default so budget and time-box agree. */
const DEFAULT_MISSION_DURATION_MINUTES = 60;

export const SUBAGENT_MAX_CONCURRENT: FieldWithDefault = {
  key: "SUBAGENT_MAX_CONCURRENT",
  kind: "int",
  min: 1,
  max: 20,
  default: 5,
};

export const SUBAGENT_CONTEXT_LIMIT: FieldWithDefault = {
  key: "SUBAGENT_CONTEXT_LIMIT",
  kind: "int",
  min: 1000,
  max: 2_000_000,
  default: 16_384,
};

export const SUBAGENT_MAX_OUTPUT_TOKENS: FieldWithFallback = {
  key: "SUBAGENT_MAX_OUTPUT_TOKENS",
  kind: "int",
  min: 256,
  max: 128_000,
  fallbackFrom: "agent.maxOutputTokens",
};

export const SUBAGENT_TEMPERATURE: FieldWithFallback = {
  key: "SUBAGENT_TEMPERATURE",
  kind: "float",
  min: 0,
  max: 2,
  fallbackFrom: "agent.temperature",
};

export const SUBAGENT_MAX_ITERATIONS: FieldWithDefault = {
  key: "SUBAGENT_MAX_ITERATIONS",
  kind: "int",
  min: 1,
  max: 200,
  default: 25,
};

export const SUBAGENT_TIMEOUT_MS: FieldWithDefault = {
  key: "SUBAGENT_TIMEOUT_MS",
  kind: "int",
  min: 10_000,
  max: 1_800_000,
  default: 300_000,
};

export const AGENT_FIELDS = [
  AGENT_CONTEXT_LIMIT,
  AGENT_MAX_OUTPUT_TOKENS,
  AGENT_TEMPERATURE,
] as const;

export const SUBAGENT_FIELDS = [
  SUBAGENT_MAX_CONCURRENT,
  SUBAGENT_CONTEXT_LIMIT,
  SUBAGENT_MAX_OUTPUT_TOKENS,
  SUBAGENT_TEMPERATURE,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_TIMEOUT_MS,
] as const;

export interface ParseError {
  readonly key: string;
  readonly raw: string;
  readonly reason: "not_a_number" | "out_of_range";
  readonly detail?: { readonly min?: number; readonly max?: number };
}

export interface AgentEffective {
  readonly contextLimit: number;
  readonly maxOutputTokens: number;
  readonly temperature: number | null;
}

export interface SubagentEffective {
  readonly maxConcurrent: number;
  readonly contextLimit: number;
  readonly maxOutputTokens: number;
  readonly temperature: number | null;
  readonly maxIterations: number;
  readonly timeoutMs: number;
}

export interface ParseResult<T> {
  readonly value: T;
  readonly errors: readonly ParseError[];
}

type EnvLike = Readonly<Record<string, string | null | undefined>>;

export function parseAgentEnv(env: EnvLike): ParseResult<AgentEffective> {
  const errors: ParseError[] = [];
  const contextLimit = parseFieldOrDefault(AGENT_CONTEXT_LIMIT, env[AGENT_CONTEXT_LIMIT.key], errors);
  const maxOutputTokens = parseFieldOrDefault(AGENT_MAX_OUTPUT_TOKENS, env[AGENT_MAX_OUTPUT_TOKENS.key], errors);
  const temperature = parseFieldOrDefault(AGENT_TEMPERATURE, env[AGENT_TEMPERATURE.key], errors);
  return {
    value: {
      contextLimit: contextLimit ?? AGENT_CONTEXT_LIMIT.default!,
      maxOutputTokens: maxOutputTokens ?? AGENT_MAX_OUTPUT_TOKENS.default!,
      temperature,
    },
    errors,
  };
}

/**
 * Resolve the effective hard per-mission token budget from env.
 *
 * Returns `null` when the guard is explicitly DISABLED (an
 * `AGENT_MISSION_TOKEN_BUDGET` of `0`/`off`/`none`/`unlimited`/`disabled`,
 * case-insensitive) — `null` flows to the turn loop as "no box".
 *
 * Otherwise fail-open to the 500000 default: unset, blank, non-numeric, or
 * negative/out-of-range all resolve to the default (the collected parse error
 * is intentionally discarded — a bad budget must not block a run, mirroring the
 * hard-deadline env's fallback stance). A large, in-range value is honored
 * verbatim (see the raised field `max`), never silently downgraded. Reads
 * through the same field-descriptor parser the other AGENT_* whole-number
 * fields use, so validation stays consistent.
 */
export function resolveMissionTokenBudget(
  env: EnvLike,
  durationMinutes?: number | null,
): number | null {
  const raw = env[AGENT_MISSION_TOKEN_BUDGET.key];
  if (raw != null) {
    const norm = raw.trim().toLowerCase();
    // Disable sentinels (0/off/none/…) → no box.
    if (MISSION_TOKEN_BUDGET_DISABLE_SENTINELS.has(norm)) return null;
    // An explicit, well-formed absolute value is an override / escape hatch
    // (pin a fixed cap, e.g. for tests) — it wins over the duration-derived
    // default. A malformed value falls through to the dynamic default.
    if (norm !== "") {
      const overrideErrors: ParseError[] = [];
      const explicit = parseFieldOrDefault(
        AGENT_MISSION_TOKEN_BUDGET,
        raw,
        overrideErrors,
      );
      if (explicit != null && overrideErrors.length === 0) return explicit;
    }
  }
  // DEFAULT: derive the budget from the mission's own time-box so a longer run
  // gets proportionally more runway with zero per-mission tuning —
  // `durationMinutes × AGENT_MISSION_TOKENS_PER_MINUTE`. Duration falls back to
  // 60 (matching the deadline resolver) when absent/non-positive.
  const perMinuteErrors: ParseError[] = [];
  const perMinute =
    parseFieldOrDefault(
      AGENT_MISSION_TOKENS_PER_MINUTE,
      env[AGENT_MISSION_TOKENS_PER_MINUTE.key],
      perMinuteErrors,
    ) ?? AGENT_MISSION_TOKENS_PER_MINUTE.default!;
  const minutes =
    typeof durationMinutes === "number" && durationMinutes > 0
      ? durationMinutes
      : DEFAULT_MISSION_DURATION_MINUTES;
  return Math.ceil(minutes * perMinute);
}

/**
 * Mission tool-exclusion list — tool names hidden from the LLM surface during
 * an ACTIVE mission run (consumed via `ToolVisibilityContext.missionExcludedTools`).
 *
 * Read from `AGENT_MISSION_EXCLUDED_TOOLS` as a comma-separated list of tool
 * names, e.g. "hyperliquid_enter,polymarket_setup,bridge". Purpose: let a
 * focused mission (a single-chain spot scalp) run on a trimmed toolset so the
 * re-sent-every-turn prompt prefix — which counts in full against the hard
 * token budget every turn — is smaller, and a weak model has fewer irrelevant
 * tools to flail on.
 *
 * FAIL-OPEN: unset or blank resolves to `[]` (no exclusion — the full surface),
 * mirroring the other AGENT_* envs' stance, so a mis-set value can never strip
 * a tool a mission genuinely needs. Each name is trimmed; empty entries drop.
 * Validation against the real catalog is intentionally omitted — an unknown
 * name is a harmless no-op in the visibility filter, keeping this a pure,
 * dependency-free env read.
 */
export function resolveMissionExcludedTools(env: EnvLike): readonly string[] {
  const raw = env["AGENT_MISSION_EXCLUDED_TOOLS"];
  if (raw == null) return [];
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

export function parseSubagentEnv(env: EnvLike, agentEff: AgentEffective): ParseResult<SubagentEffective> {
  const errors: ParseError[] = [];
  const maxConcurrent = parseFieldOrDefault(SUBAGENT_MAX_CONCURRENT, env[SUBAGENT_MAX_CONCURRENT.key], errors);
  const contextLimit = parseFieldOrDefault(SUBAGENT_CONTEXT_LIMIT, env[SUBAGENT_CONTEXT_LIMIT.key], errors);
  const maxOutputTokens = parseFieldOrFallback(
    SUBAGENT_MAX_OUTPUT_TOKENS,
    env[SUBAGENT_MAX_OUTPUT_TOKENS.key],
    agentEff.maxOutputTokens,
    errors,
  );
  const temperature = parseFieldOrFallback(
    SUBAGENT_TEMPERATURE,
    env[SUBAGENT_TEMPERATURE.key],
    agentEff.temperature,
    errors,
  );
  const maxIterations = parseFieldOrDefault(SUBAGENT_MAX_ITERATIONS, env[SUBAGENT_MAX_ITERATIONS.key], errors);
  const timeoutMs = parseFieldOrDefault(SUBAGENT_TIMEOUT_MS, env[SUBAGENT_TIMEOUT_MS.key], errors);
  return {
    value: {
      maxConcurrent: maxConcurrent ?? SUBAGENT_MAX_CONCURRENT.default!,
      contextLimit: contextLimit ?? SUBAGENT_CONTEXT_LIMIT.default!,
      maxOutputTokens: maxOutputTokens ?? agentEff.maxOutputTokens,
      temperature,
      maxIterations: maxIterations ?? SUBAGENT_MAX_ITERATIONS.default!,
      timeoutMs: timeoutMs ?? SUBAGENT_TIMEOUT_MS.default!,
    },
    errors,
  };
}

function parseFieldOrDefault(
  field: FieldWithDefault,
  raw: string | null | undefined,
  errors: ParseError[],
): number | null {
  if (raw === undefined || raw === null) return field.default;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return field.default;
  const parsed = parseAndValidate(field, trimmed, errors);
  return parsed ?? field.default;
}

function parseFieldOrFallback(
  field: FieldWithFallback,
  raw: string | null | undefined,
  fallback: number | null,
  errors: ParseError[],
): number | null {
  if (raw === undefined || raw === null) return fallback;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  const parsed = parseAndValidate(field, trimmed, errors);
  return parsed ?? fallback;
}

function parseAndValidate(field: FieldBase, trimmed: string, errors: ParseError[]): number | null {
  let parsed: number;
  if (field.kind === "int") {
    if (!/^-?\d+$/.test(trimmed)) {
      errors.push({ key: field.key, raw: trimmed, reason: "not_a_number" });
      return null;
    }
    parsed = Number.parseInt(trimmed, 10);
  } else {
    parsed = Number(trimmed);
  }
  if (!Number.isFinite(parsed)) {
    errors.push({ key: field.key, raw: trimmed, reason: "not_a_number" });
    return null;
  }
  if (parsed < field.min || parsed > field.max) {
    errors.push({
      key: field.key,
      raw: trimmed,
      reason: "out_of_range",
      detail: { min: field.min, max: field.max },
    });
    return null;
  }
  return parsed;
}

export function formatParseErrors(prefix: string, errors: readonly ParseError[]): string {
  const lines = errors.map((e) => {
    if (e.reason === "out_of_range") {
      return `  ${e.key}=${JSON.stringify(e.raw)} out of range ${e.detail?.min}..${e.detail?.max}`;
    }
    return `  ${e.key}=${JSON.stringify(e.raw)} not a number`;
  });
  return `${prefix}\n${lines.join("\n")}`;
}
