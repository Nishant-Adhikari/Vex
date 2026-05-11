/**
 * Provider env-state probe (M10).
 *
 * Mirrors the engine's runtime resolution in
 * `src/vex-agent/inference/registry.ts:41-108` so the wizard's skip
 * card reflects what the engine will actually pick at next startup:
 *
 *   1. If `AGENT_PROVIDER` is set to "openrouter" or "0g-compute"
 *      explicitly → use it.
 *   2. Else if `OPENROUTER_API_KEY` + `AGENT_MODEL` both present → openrouter.
 *   3. Else if compute-state.json exists and parses → 0g-compute.
 *   4. Else → null (not configured).
 *
 * `configured` = `name !== null` AND prerequisites met:
 *   - openrouter: OPENROUTER_API_KEY + AGENT_MODEL both present.
 *   - 0g-compute: compute-state.json exists, parses, and has a non-empty
 *     `model` field.
 *
 * `modelLabel`:
 *   - openrouter → AGENT_MODEL value (or null if missing).
 *   - 0g-compute → compute-state.json `model` field (or null if file
 *     missing/malformed). Capped at 200 chars defensively.
 *
 * `readComputeStateSafely` NEVER throws — malformed or unreadable
 * compute-state.json → returns null + logs warn (codex turn 3 RED).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../paths/config-dir.js";
import { readEnvValue } from "./env-state.js";
import type { ProviderState } from "@shared/schemas/onboarding.js";
import { log } from "../logger/index.js";

/**
 * Resolve the compute-state.json path lazily so that consumers (and
 * tests) can override `CONFIG_DIR` AFTER module-load. Must match
 * engine's `src/tools/0g-compute/constants.ts` (`ZG_COMPUTE_STATE_FILE`).
 * Cross-boundary direct import would pull engine's logger + ZG SDK;
 * we duplicate the path layout and rely on test fixtures + the engine
 * constant to catch drift.
 */
export function computeStateFile(): string {
  return path.join(CONFIG_DIR, "0g-compute", "compute-state.json");
}

const MAX_MODEL_LABEL = 200;

interface ComputeStateShape {
  readonly activeProvider?: unknown;
  readonly model?: unknown;
}

async function readComputeStateSafely(
  filePath: string,
): Promise<{
  readonly model: string;
} | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
  let parsed: ComputeStateShape;
  try {
    parsed = JSON.parse(raw) as ComputeStateShape;
  } catch (cause) {
    log.warn(
      `[provider-state] compute-state.json present but unparseable; treating as not configured`,
      cause,
    );
    return null;
  }
  if (
    typeof parsed.activeProvider !== "string" ||
    parsed.activeProvider.length === 0
  ) {
    return null;
  }
  if (typeof parsed.model !== "string" || parsed.model.length === 0) {
    return null;
  }
  return { model: parsed.model };
}

function capLabel(value: string | null): string | null {
  if (value === null) return null;
  return value.length > MAX_MODEL_LABEL
    ? value.slice(0, MAX_MODEL_LABEL)
    : value;
}

export async function probeProvider(envPath: string): Promise<ProviderState> {
  const [openRouterKey, modelValue, agentProvider, computeState] =
    await Promise.all([
      // Use `readEnvValue` (not `readEnvKeyPresence`) so `KEY=""` is
      // correctly treated as "not configured" — matches engine
      // `loadEnvConfig` which requires non-empty key.
      readEnvValue(envPath, "OPENROUTER_API_KEY"),
      readEnvValue(envPath, "AGENT_MODEL"),
      readEnvValue(envPath, "AGENT_PROVIDER"),
      readComputeStateSafely(computeStateFile()),
    ]);
  const hasOpenRouterKey = openRouterKey !== null;

  // Step 1: explicit AGENT_PROVIDER wins (matches engine `registry.ts:47-69`).
  // Bogus explicit value → engine logs error + returns null + agent won't
  // start. Mirror that here: don't fall through to fallback when user
  // explicitly chose an unsupported provider — otherwise the wizard
  // skip-card would say "openrouter configured" while the engine refuses
  // to start.
  if (agentProvider !== null) {
    if (agentProvider === "openrouter") {
      const openrouterReady = hasOpenRouterKey && modelValue !== null;
      return {
        configured: openrouterReady,
        name: "openrouter",
        modelLabel: capLabel(modelValue),
      };
    }
    if (agentProvider === "0g-compute") {
      const computeReady = computeState !== null;
      return {
        configured: computeReady,
        name: "0g-compute",
        modelLabel: capLabel(computeState?.model ?? null),
      };
    }
    // Explicit but unsupported (e.g. `AGENT_PROVIDER=bogus`) — fail closed.
    // Don't log the raw value; env values are not secrets by contract but
    // get misused. Codex turn 6 YELLOW.
    log.warn(
      `[provider-state] AGENT_PROVIDER is set to an unsupported value; treating as not configured`,
    );
    return { configured: false, name: null, modelLabel: null };
  }

  // Step 2: fallback to key+model → openrouter.
  if (hasOpenRouterKey && modelValue !== null) {
    return {
      configured: true,
      name: "openrouter",
      modelLabel: capLabel(modelValue),
    };
  }

  // Step 3: fallback to compute-state.json → 0g-compute.
  if (computeState !== null) {
    return {
      configured: true,
      name: "0g-compute",
      modelLabel: capLabel(computeState.model),
    };
  }

  // Step 4: not configured.
  return { configured: false, name: null, modelLabel: null };
}
