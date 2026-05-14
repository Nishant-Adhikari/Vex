/**
 * Agent core configuration writer (M9 Step 5).
 *
 * Tri-state per submitted field:
 *   - absent  → no change to .env (existing value preserved)
 *   - number  → set/overwrite via appendToDotenvFile
 *   - null    → REMOVE the key via removeFromDotenvFile (engine
 *               reads will fall back to compile-time default)
 *
 * Cross-field validation runs on the EFFECTIVE merged config:
 *   effective = defaults_from_agent_config
 *               ⊕ existing_env_values
 *               ⊕ submitted_overrides_or_clears
 *
 * That catches the codex turn 2 RED #4 case: existing
 * AGENT_CONTEXT_LIMIT=1000, user submits only maxOutputTokens=2000
 * — payload-only check would miss it; effective-config check
 * rejects with `validation.invalid_input` + violation tag.
 *
 * Empty-payload Continue (codex turn 4 BLOCKING): even with no
 * submission, we re-read existing .env, compute effective, and
 * validate. A user who manually edited .env into a broken state
 * (e.g. MAX_OUT > CONTEXT) gets blocked at Step 5 until they fix
 * it via this form OR direct .env edit.
 *
 * Engine + GUI share `parseAgentEnv` / `parseSubagentEnv` from
 * `src/lib/agent-config.ts`. Engine treats invalid SUBAGENT_* as
 * silent fallback; GUI treats them as a hard validation error
 * (defense at the write boundary). Per-field parse errors collected
 * by the shared helper become `validation.invalid_input` with a
 * per-key violation list.
 */

import {
  appendToDotenvFile,
  readDotenvFileValue,
  removeFromDotenvFile,
} from "@vex-lib/dotenv.js";
import {
  AGENT_CONTEXT_LIMIT,
  AGENT_MAX_OUTPUT_TOKENS,
  AGENT_TEMPERATURE,
  parseAgentEnv,
  parseSubagentEnv,
  SUBAGENT_CONTEXT_LIMIT,
  SUBAGENT_MAX_CONCURRENT,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_MAX_OUTPUT_TOKENS,
  SUBAGENT_TEMPERATURE,
  SUBAGENT_TIMEOUT_MS,
} from "@vex-lib/agent-config.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  AGENT_CORE_CANONICAL_ORDER,
  type AgentCoreConfigureInput,
  type AgentCoreConfigureResult,
} from "@shared/schemas/agent-core.js";
import { ENV_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";
import { stripManagedSecretsFromDotenvFile } from "@vex-lib/local-secret-vault.js";

export interface AgentCoreWriterOptions {
  /** Override `ENV_FILE` for tests; production callers omit. */
  readonly envFile?: string;
}

type CanonicalKey = (typeof AGENT_CORE_CANONICAL_ORDER)[number];

/** Maps the input shape to the canonical .env keys for write planning. */
function planFromInput(input: AgentCoreConfigureInput): Map<CanonicalKey, number | null> {
  const plan = new Map<CanonicalKey, number | null>();
  if (input.contextLimit !== undefined) plan.set("AGENT_CONTEXT_LIMIT", input.contextLimit);
  if (input.maxOutputTokens !== undefined) plan.set("AGENT_MAX_OUTPUT_TOKENS", input.maxOutputTokens);
  if (input.temperature !== undefined) plan.set("AGENT_TEMPERATURE", input.temperature);
  const sub = input.subagent;
  if (sub !== undefined) {
    if (sub.maxConcurrent !== undefined) plan.set("SUBAGENT_MAX_CONCURRENT", sub.maxConcurrent);
    if (sub.contextLimit !== undefined) plan.set("SUBAGENT_CONTEXT_LIMIT", sub.contextLimit);
    if (sub.maxOutputTokens !== undefined) plan.set("SUBAGENT_MAX_OUTPUT_TOKENS", sub.maxOutputTokens);
    if (sub.temperature !== undefined) plan.set("SUBAGENT_TEMPERATURE", sub.temperature);
    if (sub.maxIterations !== undefined) plan.set("SUBAGENT_MAX_ITERATIONS", sub.maxIterations);
    if (sub.timeoutMs !== undefined) plan.set("SUBAGENT_TIMEOUT_MS", sub.timeoutMs);
  }
  return plan;
}

const ALL_KEYS: readonly CanonicalKey[] = [
  AGENT_CONTEXT_LIMIT.key,
  AGENT_MAX_OUTPUT_TOKENS.key,
  AGENT_TEMPERATURE.key,
  SUBAGENT_MAX_CONCURRENT.key,
  SUBAGENT_CONTEXT_LIMIT.key,
  SUBAGENT_MAX_OUTPUT_TOKENS.key,
  SUBAGENT_TEMPERATURE.key,
  SUBAGENT_MAX_ITERATIONS.key,
  SUBAGENT_TIMEOUT_MS.key,
] as const;

function readEnvSnapshot(envFile: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of ALL_KEYS) {
    try {
      out[k] = readDotenvFileValue(k, envFile);
    } catch {
      out[k] = null;
    }
  }
  return out;
}

/**
 * Apply the submitted plan to the existing-env snapshot to produce
 * the env-shape we feed into parseAgentEnv / parseSubagentEnv.
 *   - number  → string representation overrides existing
 *   - null    → key cleared from the merged env (helper falls back
 *               to its own default / inheritance chain)
 *   - absent  → existing value preserved
 */
function mergeForValidation(
  snapshot: Record<string, string | null>,
  plan: Map<CanonicalKey, number | null>,
): Record<string, string | null | undefined> {
  const merged: Record<string, string | null | undefined> = { ...snapshot };
  for (const [key, value] of plan) {
    if (value === null) {
      merged[key] = undefined; // simulate "removed" for the parser
    } else {
      merged[key] = String(value);
    }
  }
  return merged;
}

export async function writeAgentCoreConfig(
  input: AgentCoreConfigureInput,
  options: AgentCoreWriterOptions = {},
): Promise<Result<AgentCoreConfigureResult>> {
  const targetFile = options.envFile ?? ENV_FILE;
  const plan = planFromInput(input);
  const snapshot = readEnvSnapshot(targetFile);
  const merged = mergeForValidation(snapshot, plan);

  // Per-field parse validation on the EFFECTIVE merged env.
  const agentParse = parseAgentEnv(merged);
  if (agentParse.errors.length > 0) {
    return err({
      code: "validation.invalid_input",
      domain: "onboarding",
      message: "One or more agent values are invalid.",
      retryable: false,
      userActionable: true,
      redacted: true,
      details: {
        violations: agentParse.errors.map((e) => ({
          key: e.key,
          reason: e.reason,
          ...(e.detail !== undefined ? { detail: e.detail } : {}),
        })),
      },
    });
  }
  const subParse = parseSubagentEnv(merged, agentParse.value);
  if (subParse.errors.length > 0) {
    return err({
      code: "validation.invalid_input",
      domain: "onboarding",
      message: "One or more subagent values are invalid.",
      retryable: false,
      userActionable: true,
      redacted: true,
      details: {
        violations: subParse.errors.map((e) => ({
          key: e.key,
          reason: e.reason,
          ...(e.detail !== undefined ? { detail: e.detail } : {}),
        })),
      },
    });
  }

  // Cross-field invariants on EFFECTIVE values.
  const eff = agentParse.value;
  if (eff.maxOutputTokens > eff.contextLimit) {
    return err({
      code: "validation.invalid_input",
      domain: "onboarding",
      message:
        `AGENT_MAX_OUTPUT_TOKENS (${eff.maxOutputTokens}) must not exceed ` +
        `AGENT_CONTEXT_LIMIT (${eff.contextLimit}).`,
      retryable: false,
      userActionable: true,
      redacted: true,
      details: {
        violation: "max_output_exceeds_context",
        contextLimit: eff.contextLimit,
        maxOutputTokens: eff.maxOutputTokens,
      },
    });
  }
  const subEff = subParse.value;
  if (subEff.maxOutputTokens > subEff.contextLimit) {
    return err({
      code: "validation.invalid_input",
      domain: "onboarding",
      message:
        `SUBAGENT_MAX_OUTPUT_TOKENS (${subEff.maxOutputTokens}) must not exceed ` +
        `SUBAGENT_CONTEXT_LIMIT (${subEff.contextLimit}).`,
      retryable: false,
      userActionable: true,
      redacted: true,
      details: {
        violation: "subagent_max_output_exceeds_subagent_context",
        contextLimit: subEff.contextLimit,
        maxOutputTokens: subEff.maxOutputTokens,
      },
    });
  }

  // All checks passed — apply the plan in canonical order.
  stripManagedSecretsFromDotenvFile(targetFile);

  const fieldsWritten: CanonicalKey[] = [];
  const fieldsCleared: CanonicalKey[] = [];

  for (const key of AGENT_CORE_CANONICAL_ORDER) {
    if (!plan.has(key)) continue;
    const value = plan.get(key)!;
    try {
      if (value === null) {
        const removed = removeFromDotenvFile(key, targetFile);
        if (removed) fieldsCleared.push(key);
      } else {
        appendToDotenvFile(key, String(value), targetFile);
        fieldsWritten.push(key);
      }
    } catch (cause) {
      log.error(
        `[agent-core-writer] failed to persist ${key} to ${targetFile}`,
        cause,
      );
      return err({
        code: "onboarding.env_persist_failed",
        domain: "onboarding",
        message: `Could not persist ${key}. Check disk space and permissions.`,
        retryable: true,
        userActionable: true,
        redacted: true,
        details: { partialFieldsWritten: fieldsWritten, partialFieldsCleared: fieldsCleared },
      });
    }
  }

  log.info(
    `[agent-core-writer] written=${fieldsWritten.join(",") || "<none>"} ` +
      `cleared=${fieldsCleared.join(",") || "<none>"}`,
  );
  return ok({ fieldsWritten, fieldsCleared });
}
