/**
 * Agent core tuning — AGENT_CONTEXT_LIMIT / AGENT_MAX_OUTPUT_TOKENS /
 * AGENT_TEMPERATURE + SUBAGENT_* (all six). Optional step; defaults are
 * sane for most flows. In-session Advanced tab (3F) exposes the same
 * surface for post-start edits.
 *
 * M9 refactor: field metadata (key/min/max/default) imported from
 * `src/lib/agent-config.ts` (shared with engine + vex-app onboarding).
 * Prompt order, write timing, and abort behavior preserved.
 */

import { confirm, isCancel, log, text } from "@clack/prompts";
import {
  AGENT_CONTEXT_LIMIT,
  AGENT_MAX_OUTPUT_TOKENS,
  AGENT_TEMPERATURE,
  SUBAGENT_CONTEXT_LIMIT,
  SUBAGENT_MAX_CONCURRENT,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_MAX_OUTPUT_TOKENS,
  SUBAGENT_TEMPERATURE,
  SUBAGENT_TIMEOUT_MS,
  type FieldBase,
  type FieldWithDefault,
  type FieldWithFallback,
} from "../../../src/lib/agent-config.js";
import { readAppEnvMap } from "../../../src/cli/setup/status.js";
import { writeAppEnvValue } from "../../../src/providers/env-resolution.js";
import { synchronizeTrackedEnv } from "../../../src/cli/setup/setup.js";

export interface AgentCoreOutcome {
  aborted: boolean;
  changed: boolean;
}

type IntPromptField = (FieldWithDefault | FieldWithFallback) & { kind: "int" };

const AGENT_INT_FIELDS: IntPromptField[] = [
  AGENT_CONTEXT_LIMIT as IntPromptField,
  AGENT_MAX_OUTPUT_TOKENS as IntPromptField,
];

const SUBAGENT_INT_FIELDS: IntPromptField[] = [
  SUBAGENT_MAX_CONCURRENT as IntPromptField,
  SUBAGENT_CONTEXT_LIMIT as IntPromptField,
  SUBAGENT_MAX_OUTPUT_TOKENS as IntPromptField,
  SUBAGENT_MAX_ITERATIONS as IntPromptField,
  SUBAGENT_TIMEOUT_MS as IntPromptField,
];

function defaultHint(field: FieldBase): string {
  if ("default" in field && field.default !== null && field.default !== undefined) {
    return `, default ${(field as FieldWithDefault).default}`;
  }
  if ("fallbackFrom" in field && (field as FieldWithFallback).fallbackFrom) {
    const from = (field as FieldWithFallback).fallbackFrom;
    return `, falls back to ${from}`;
  }
  return "";
}

async function promptIntField(
  field: IntPromptField,
  current: string | undefined,
): Promise<string | symbol> {
  const input = await text({
    message: `${field.key} [${field.min}..${field.max}${defaultHint(field)}] (current: ${current ?? "<unset>"}, Enter to keep)`,
    validate: (v) => {
      if (!v || v === "") return undefined;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n)) return "Must be an integer";
      if (n < field.min || n > field.max) return `Out of range ${field.min}..${field.max}`;
      return undefined;
    },
  });
  if (isCancel(input)) return input;
  const trimmed = String(input).trim();
  if (!trimmed) return current ?? "";
  writeAppEnvValue(field.key, trimmed);
  process.env[field.key] = trimmed;
  return trimmed;
}

async function promptFloatField(
  field: FieldBase & { kind: "float" },
  current: string | undefined,
): Promise<string | symbol> {
  const input = await text({
    message: `${field.key} [${field.min}..${field.max}${defaultHint(field)}] (current: ${current ?? "<unset>"}, Enter to keep)`,
    validate: (v) => {
      if (!v || v === "") return undefined;
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return "Must be a number";
      if (n < field.min || n > field.max) return `Out of range ${field.min}..${field.max}`;
      return undefined;
    },
  });
  if (isCancel(input)) return input;
  const trimmed = String(input).trim();
  if (!trimmed) return current ?? "";
  writeAppEnvValue(field.key, trimmed);
  process.env[field.key] = trimmed;
  return trimmed;
}

export async function runAgentCoreStep(): Promise<AgentCoreOutcome> {
  log.step("Agent + subagent tuning");

  const wantCustomize = await confirm({
    message: "Override agent / subagent tunings now? (context limits, output tokens, temperature, subagent caps)",
    initialValue: false,
  });
  if (isCancel(wantCustomize)) return { aborted: true, changed: false };
  if (!wantCustomize) return { aborted: false, changed: false };

  const envMap = readAppEnvMap();
  let changed = false;

  for (const field of AGENT_INT_FIELDS) {
    const res = await promptIntField(field, envMap[field.key]);
    if (typeof res === "symbol") return { aborted: true, changed };
    if (res !== (envMap[field.key] ?? "")) changed = true;
  }

  const temp = await promptFloatField(AGENT_TEMPERATURE as FieldBase & { kind: "float" }, envMap.AGENT_TEMPERATURE);
  if (typeof temp === "symbol") return { aborted: true, changed };
  if (temp !== (envMap.AGENT_TEMPERATURE ?? "")) changed = true;

  const wantSubagents = await confirm({
    message: "Also override subagent defaults?",
    initialValue: false,
  });
  if (isCancel(wantSubagents)) return { aborted: true, changed };

  if (wantSubagents) {
    for (const field of SUBAGENT_INT_FIELDS) {
      const res = await promptIntField(field, envMap[field.key]);
      if (typeof res === "symbol") return { aborted: true, changed };
      if (res !== (envMap[field.key] ?? "")) changed = true;
    }
    const subTemp = await promptFloatField(
      SUBAGENT_TEMPERATURE as FieldBase & { kind: "float" },
      envMap.SUBAGENT_TEMPERATURE,
    );
    if (typeof subTemp === "symbol") return { aborted: true, changed };
    if (subTemp !== (envMap.SUBAGENT_TEMPERATURE ?? "")) changed = true;
  }

  if (changed) {
    synchronizeTrackedEnv();
    log.success("Agent / subagent tunings updated.");
  }
  return { aborted: false, changed };
}
