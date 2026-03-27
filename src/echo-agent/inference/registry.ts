/**
 * Provider registry — resolves and caches the active inference provider.
 *
 * Resolution priority:
 * 1. AGENT_PROVIDER env (explicit choice)
 * 2. OPENROUTER_API_KEY present → OpenRouter
 * 3. compute-state.json exists → 0G Compute
 * 4. null (agent won't start)
 */

import type { InferenceProvider } from "./types.js";
import { loadEnvConfig } from "./config.js";
import { loadComputeState } from "@tools/0g-compute/readiness.js";
import logger from "@utils/logger.js";

// ── Lazy imports (avoid loading unused provider dependencies) ────

async function createOpenRouterProvider(): Promise<InferenceProvider> {
  const { OpenRouterProvider } = await import("./openrouter.js");
  return new OpenRouterProvider();
}

async function createZeroGProvider(): Promise<InferenceProvider> {
  const { ZeroGComputeProvider } = await import("./0g-compute.js");
  return new ZeroGComputeProvider();
}

const PROVIDER_FACTORIES: Record<string, () => Promise<InferenceProvider>> = {
  "openrouter": createOpenRouterProvider,
  "0g-compute": createZeroGProvider,
};

// ── Singleton cache ──────────────────────────────────────────────

let cachedProvider: InferenceProvider | null = null;

/**
 * Resolve which provider to use based on ENV config.
 * Returns null if no provider is configured — agent should not start.
 */
export async function resolveProvider(): Promise<InferenceProvider | null> {
  if (cachedProvider) return cachedProvider;

  const envConfig = loadEnvConfig();

  // 1. Explicit env var — fail fast on misconfiguration
  if (envConfig.agentProvider) {
    const factory = PROVIDER_FACTORIES[envConfig.agentProvider];
    if (!factory) {
      logger.error("inference.registry.unknown_provider", {
        provider: envConfig.agentProvider,
        supported: Object.keys(PROVIDER_FACTORIES),
      });
      return null;
    }
    try {
      cachedProvider = await factory();
      logger.info("inference.registry.resolved", {
        provider: envConfig.agentProvider,
        source: "AGENT_PROVIDER",
      });
      return cachedProvider;
    } catch (err) {
      logger.error("inference.registry.init_failed", {
        provider: envConfig.agentProvider,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // 2. OpenRouter API key present
  if (envConfig.openrouterApiKey) {
    try {
      cachedProvider = await createOpenRouterProvider();
      logger.info("inference.registry.resolved", {
        provider: "openrouter",
        source: "OPENROUTER_API_KEY",
      });
      return cachedProvider;
    } catch (err) {
      logger.warn("inference.registry.openrouter_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. 0G Compute state exists
  if (loadComputeState()) {
    try {
      cachedProvider = await createZeroGProvider();
      logger.info("inference.registry.resolved", {
        provider: "0g-compute",
        source: "compute-state.json",
      });
      return cachedProvider;
    } catch (err) {
      logger.warn("inference.registry.0g_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.error("inference.registry.none_configured", {
    hint: "Set OPENROUTER_API_KEY or configure 0G Compute via 'echoclaw echo connect'",
  });
  return null;
}

/** Get the cached provider. Must call resolveProvider() first. */
export function getActiveProvider(): InferenceProvider | null {
  return cachedProvider;
}

/** Reset cached provider — for tests only. */
export function resetProvider(): void {
  cachedProvider = null;
}
