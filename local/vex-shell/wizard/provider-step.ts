/**
 * Provider step — Ink-side replacement for `chooseProvider()`.
 *
 * OpenRouter branch: API key prompt + manual model id text input. The
 * operator picks the model id from https://openrouter.ai/models — we do
 * not fetch the catalog (avoids the 400-entry list and a network round-trip
 * that fails offline).
 *
 * 0G Compute branch: delegate to the existing readline-based guided flow
 * via `legacyChooseProvider`. Re-implementing the on-chain ceremony
 * (deposit + fund + ack + smoke) in @clack is large and tracked as a 3F+
 * follow-up.
 */

import { confirm, isCancel, log, password, select, text } from "@clack/prompts";
import { readAppEnvMap } from "../../../src/cli/setup/status.js";
import { writeAppEnvValue } from "../../../src/providers/env-resolution.js";
import { synchronizeTrackedEnv } from "../../../src/cli/setup/setup.js";
import { switchProvider } from "../../../src/vex-agent/inference/registry.js";
import { loadComputeState } from "../../../src/tools/0g-compute/compute-state.js";
import type { ProviderSummary } from "../platform/render.js";
import { detectInitialProvider, chooseProvider as legacyChooseProvider } from "../platform/provider.js";

export interface ProviderOutcome {
  aborted: boolean;
  summary: ProviderSummary;
}

async function activateOpenRouter(): Promise<ProviderOutcome> {
  const envMap = readAppEnvMap();
  let apiKey = envMap.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    const input = await password({
      message: "OPENROUTER_API_KEY (create one at https://openrouter.ai/keys)",
      validate: (v) => (v?.trim() ? undefined : "API key is required"),
    });
    if (isCancel(input)) return { aborted: true, summary: currentSummary() };
    apiKey = String(input).trim();
    writeAppEnvValue("OPENROUTER_API_KEY", apiKey);
    process.env.OPENROUTER_API_KEY = apiKey;
  }

  const picked = await text({
    message: "OpenRouter model id (find IDs at https://openrouter.ai/models)",
    placeholder: envMap.AGENT_MODEL ?? "e.g. anthropic/claude-sonnet-4.5",
    initialValue: envMap.AGENT_MODEL,
    validate: (v) => (v?.trim() ? undefined : "Model id is required"),
  });
  if (isCancel(picked)) return { aborted: true, summary: currentSummary() };
  const modelId = String(picked).trim();
  writeAppEnvValue("AGENT_MODEL", modelId);
  process.env.AGENT_MODEL = modelId;

  synchronizeTrackedEnv();
  const provider = await switchProvider("openrouter");
  if (!provider) {
    log.error("switchProvider('openrouter') returned null — check key and model.");
    return { aborted: false, summary: { name: "none", detail: "OpenRouter activation failed." } };
  }
  log.success(`OpenRouter active. model=${modelId}`);
  return { aborted: false, summary: { name: "openrouter", detail: `model=${modelId}` } };
}

async function activate0G(): Promise<ProviderOutcome> {
  log.info("0G Compute setup requires the guided on-chain flow (deposit, fund sub-account, acknowledge).");
  const proceed = await confirm({
    message: "Run the existing readline-based 0G guided setup now?",
    initialValue: true,
  });
  if (isCancel(proceed) || !proceed) {
    return { aborted: false, summary: { name: "none", detail: "0G setup skipped." } };
  }
  const summary = await legacyChooseProvider();
  return { aborted: false, summary };
}

function currentSummary(): ProviderSummary {
  if (process.env.OPENROUTER_API_KEY?.trim() && process.env.AGENT_MODEL?.trim()) {
    return { name: "openrouter", detail: `model=${process.env.AGENT_MODEL}` };
  }
  const state = loadComputeState();
  if (state) {
    return {
      name: "0g-compute",
      detail: `provider=${state.activeProvider.slice(0, 10)}… model=${state.model}`,
    };
  }
  return { name: "none", detail: "Not configured." };
}

export async function runProviderStep(): Promise<ProviderOutcome> {
  log.step("Provider");
  const existing = await detectInitialProvider();
  log.info(`Current: ${existing.name}${existing.detail ? ` (${existing.detail})` : ""}`);

  const choice = await select<"openrouter" | "0g-compute" | "keep">({
    message: "Inference provider",
    options: [
      { value: "openrouter", label: "OpenRouter (hosted inference, manual model id)" },
      { value: "0g-compute", label: "0G Compute (decentralised, guided setup)" },
      { value: "keep", label: "Keep current" },
    ],
    initialValue: existing.name === "0g-compute" ? "0g-compute" : "openrouter",
  });
  if (isCancel(choice)) return { aborted: true, summary: existing };
  if (choice === "keep") return { aborted: false, summary: existing };
  if (choice === "openrouter") return activateOpenRouter();
  return activate0G();
}
