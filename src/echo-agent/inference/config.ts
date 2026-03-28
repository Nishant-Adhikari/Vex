/**
 * Inference configuration — ENV validation at startup.
 *
 * All configurable values come from .env — validated on load, fail fast.
 * Internal technical constants (timeouts, retry params) are NOT from ENV.
 *
 * @see Team Standards §16.1 Config as code, §16.2 Validation at startup
 */

import logger from "@utils/logger.js";

// ── ENV-loaded config (validated at startup) ─────────────────────

export type ProviderType = "openrouter" | "0g-compute";

export interface EnvConfig {
  /** Explicit provider choice — auto-detected if not set */
  agentProvider: ProviderType | null;
  /** Context window size in tokens */
  contextLimit: number;
  /** OpenRouter API key — required if provider=openrouter */
  openrouterApiKey: string | null;
  /** Model ID — required for OpenRouter */
  agentModel: string | null;
  /** Sampling temperature — OpenRouter only */
  temperature: number | null;
  /** Max output tokens per response */
  maxOutputTokens: number;
}

const VALID_PROVIDERS = new Set<string>(["openrouter", "0g-compute"]);

/** Default max output tokens — fallback when AGENT_MAX_OUTPUT_TOKENS not set */
const FALLBACK_MAX_OUTPUT_TOKENS = 16384;
/** Default context limit — fallback when AGENT_CONTEXT_LIMIT not set */
const FALLBACK_CONTEXT_LIMIT = 128_000;

/**
 * Load and validate all inference ENV variables.
 * Fail fast on invalid values — agent should not start with bad config.
 */
export function loadEnvConfig(): EnvConfig {
  const errors: string[] = [];

  // AGENT_PROVIDER (optional — auto-detected)
  const rawProvider = process.env.AGENT_PROVIDER?.toLowerCase().trim() ?? null;
  let agentProvider: ProviderType | null = null;
  if (rawProvider !== null) {
    if (!VALID_PROVIDERS.has(rawProvider)) {
      errors.push(`AGENT_PROVIDER="${rawProvider}" is invalid. Must be: openrouter, 0g-compute`);
    } else {
      agentProvider = rawProvider as ProviderType;
    }
  }

  // AGENT_CONTEXT_LIMIT
  const rawContextLimit = process.env.AGENT_CONTEXT_LIMIT?.trim();
  let contextLimit = FALLBACK_CONTEXT_LIMIT;
  if (rawContextLimit) {
    const parsed = Number(rawContextLimit);
    if (!Number.isFinite(parsed) || parsed < 1000 || parsed > 2_000_000) {
      errors.push(`AGENT_CONTEXT_LIMIT="${rawContextLimit}" is invalid. Must be 1000-2000000`);
    } else {
      contextLimit = parsed;
    }
  }

  // OPENROUTER_API_KEY
  const openrouterApiKey = process.env.OPENROUTER_API_KEY?.trim() ?? null;

  // AGENT_MODEL
  const agentModel = process.env.AGENT_MODEL?.trim() ?? null;

  // AGENT_TEMPERATURE (OpenRouter only)
  const rawTemp = process.env.AGENT_TEMPERATURE?.trim();
  let temperature: number | null = null;
  if (rawTemp) {
    const parsed = Number(rawTemp);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
      errors.push(`AGENT_TEMPERATURE="${rawTemp}" is invalid. Must be 0.0-2.0`);
    } else {
      temperature = parsed;
    }
  }

  // AGENT_MAX_OUTPUT_TOKENS
  const rawMaxTokens = process.env.AGENT_MAX_OUTPUT_TOKENS?.trim();
  let maxOutputTokens = FALLBACK_MAX_OUTPUT_TOKENS;
  if (rawMaxTokens) {
    const parsed = Number(rawMaxTokens);
    if (!Number.isFinite(parsed) || parsed < 256 || parsed > 128_000) {
      errors.push(`AGENT_MAX_OUTPUT_TOKENS="${rawMaxTokens}" is invalid. Must be 256-128000`);
    } else {
      maxOutputTokens = parsed;
    }
  }

  if (errors.length > 0) {
    for (const err of errors) {
      logger.error("inference.config.validation_failed", { error: err });
    }
    throw new Error(`Inference config validation failed:\n${errors.join("\n")}`);
  }

  return {
    agentProvider,
    contextLimit,
    openrouterApiKey,
    agentModel,
    temperature,
    maxOutputTokens,
  };
}

// ── Subagent config (ENV with fallbacks from AGENT_*) ───────────

export interface SubagentConfig {
  maxConcurrent: number;
  contextLimit: number;
  maxOutputTokens: number;
  temperature: number | null;
  maxIterations: number;
  timeoutMs: number;
}

const SUBAGENT_DEFAULTS = {
  maxConcurrent: 5,
  contextLimit: 16_384,
  maxIterations: 25,
  timeoutMs: 300_000,
} as const;

export function loadSubagentConfig(agentConfig: EnvConfig): SubagentConfig {
  return {
    maxConcurrent: parseIntEnv("SUBAGENT_MAX_CONCURRENT", SUBAGENT_DEFAULTS.maxConcurrent, 1, 20),
    contextLimit: parseIntEnv("SUBAGENT_CONTEXT_LIMIT", SUBAGENT_DEFAULTS.contextLimit, 1000, 2_000_000),
    maxOutputTokens: parseIntEnv("SUBAGENT_MAX_OUTPUT_TOKENS", agentConfig.maxOutputTokens, 256, 128_000),
    temperature: parseFloatEnv("SUBAGENT_TEMPERATURE", agentConfig.temperature, 0, 2),
    maxIterations: parseIntEnv("SUBAGENT_MAX_ITERATIONS", SUBAGENT_DEFAULTS.maxIterations, 1, 200),
    timeoutMs: parseIntEnv("SUBAGENT_TIMEOUT_MS", SUBAGENT_DEFAULTS.timeoutMs, 10_000, 1_800_000),
  };
}

function parseIntEnv(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return Math.floor(parsed);
}

function parseFloatEnv(key: string, fallback: number | null, min: number, max: number): number | null {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

// ── Internal constants (not from ENV — technical invariants) ─────

/** Streaming inference timeout (5 min) */
export const INFERENCE_TIMEOUT_MS = 300_000;

/** Non-streaming inference timeout (2 min) */
export const INFERENCE_SIMPLE_TIMEOUT_MS = 120_000;

/** Balance cache TTL (30s) */
export const BALANCE_CACHE_TTL_MS = 30_000;

/** OpenRouter app URL for rankings */
export const OPENROUTER_APP_URL = "https://echoclaw.ai";

/** OpenRouter app display name */
export const OPENROUTER_APP_TITLE = "EchoClaw Agent";

/** OpenRouter app category */
export const OPENROUTER_APP_CATEGORY = "cli-agent";

/** OpenRouter low balance threshold (USD) */
export const OPENROUTER_LOW_BALANCE_USD = 5.0;

/** OpenRouter SDK timeout (5 min) */
export const OPENROUTER_SDK_TIMEOUT_MS = 300_000;

/** 0G Compute default low balance threshold (0G tokens) */
export const ZG_DEFAULT_ALERT_THRESHOLD = 1.2;

/** Retry: max attempts for inference calls */
export const INFERENCE_MAX_RETRIES = 2;

/** Retry: initial backoff delay */
export const INFERENCE_BASE_DELAY_MS = 2000;

/** Retry: max backoff delay */
export const INFERENCE_MAX_DELAY_MS = 15_000;
