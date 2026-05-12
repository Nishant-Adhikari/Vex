/**
 * Provider selection flow — wires the shell to `inference/registry::switchProvider`
 * for explicit, in-process provider toggling. The 0G branch reuses the
 * production primitives from `tools/0g-compute/{readiness,operations,pricing}.ts`
 * and persists API keys via `writeAppEnvValue` from `src/providers/env-resolution.ts`.
 *
 * UX rules:
 *  - Every on-chain mutation (ledger deposit, sub-account funding, ack) is
 *    behind an explicit `confirm()` with the recommended amount visible.
 *  - After a fresh 0G setup, the shell runs a smoke proof
 *    (`chatCompletionSimple`) so the operator sees the new endpoint actually
 *    answers before leaving setup.
 *  - OpenRouter persistence prompts for the API key and model when missing,
 *    writing them to `CONFIG_DIR/.env` and re-syncing `process.env` so
 *    `switchProvider` resolves with the fresh values.
 */

import {
  confirm,
  promptMenu,
  promptText,
  renderSection,
} from "../../../src/cli/setup/ui.js";
import {
  getActiveProvider,
  switchProvider,
} from "../../../src/vex-agent/inference/registry.js";
import { checkComputeReadiness } from "../../../src/tools/0g-compute/readiness.js";
import {
  loadComputeState,
  saveComputeState,
} from "../../../src/tools/0g-compute/compute-state.js";
import {
  ackWithReadback,
  depositToLedger,
  fundProvider,
  getLedgerBalance,
  getServiceMetadata,
  getSubAccountBalance,
  hasLedger,
  isProviderAcked,
  listChatServices,
} from "../../../src/tools/0g-compute/operations.js";
import {
  calculateProviderPricing,
  formatPricePerMTokens,
} from "../../../src/tools/0g-compute/pricing.js";
import { getAuthenticatedBroker } from "../../../src/tools/0g-compute/broker-factory.js";
import { writeAppEnvValue } from "../../../src/providers/env-resolution.js";
import { synchronizeTrackedEnv } from "../../../src/cli/setup/setup.js";
import type { ProviderSummary } from "./render.js";
import { writeLine } from "./render.js";
import { providerLog, withTiming } from "./log.js";

export async function detectInitialProvider(): Promise<ProviderSummary> {
  if (process.env.OPENROUTER_API_KEY?.trim() && process.env.AGENT_MODEL?.trim()) {
    process.env.AGENT_PROVIDER = "openrouter";
    return summarize("openrouter", `model=${process.env.AGENT_MODEL}`);
  }
  const state = loadComputeState();
  if (state) {
    process.env.AGENT_PROVIDER = "0g-compute";
    return summarize(
      "0g-compute",
      `provider=${shortAddress(state.activeProvider)} model=${state.model}`,
    );
  }
  return { name: "none", detail: "Not configured. Run /provider to choose OpenRouter or 0G." };
}

export async function chooseProvider(): Promise<ProviderSummary> {
  renderSection("Select provider");

  const target = await promptMenu("Which inference provider should this shell drive?", [
    {
      id: "openrouter",
      label: "OpenRouter",
      description: "Hosted inference. Shell will prompt for API key and model if missing.",
    },
    {
      id: "0g-compute",
      label: "0G Compute",
      description: "Decentralised inference via on-chain ledger + provider sub-account.",
    },
    {
      id: "cancel",
      label: "Cancel",
      description: "Keep the current provider.",
    },
  ]);

  if (target === "cancel") return summarizeCurrent();
  if (target === "openrouter") return await activateOpenRouter();
  return await activate0gCompute();
}

// ── OpenRouter ─────────────────────────────────────────────────

async function activateOpenRouter(): Promise<ProviderSummary> {
  return withTiming(providerLog, "provider.openrouter.activate", async () => {
    await ensureOpenRouterCredentials();

    const provider = await switchProvider("openrouter");
    if (!provider) {
      writeLine("OpenRouter provider failed to initialise. See logs above.");
      return summarizeCurrent();
    }
    const model = process.env.AGENT_MODEL ?? "?";
    writeLine(`OpenRouter active. model=${model}`);
    return summarize("openrouter", `model=${model}`);
  });
}

async function ensureOpenRouterCredentials(): Promise<void> {
  let apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    writeLine("OPENROUTER_API_KEY is missing. Get one at https://openrouter.ai/keys.");
    apiKey = (await promptText("Paste OpenRouter API key:", false)).trim();
    if (!apiKey) {
      throw new Error("OpenRouter API key is required");
    }
    writeAppEnvValue("OPENROUTER_API_KEY", apiKey);
    process.env.OPENROUTER_API_KEY = apiKey;
    providerLog.info("provider.openrouter.api_key_persisted");
  }

  let model = process.env.AGENT_MODEL?.trim();
  if (!model) {
    writeLine("AGENT_MODEL is missing. Examples: anthropic/claude-sonnet-4-6, openai/gpt-4o.");
    model = (await promptText("Model id:", false)).trim();
    if (!model) {
      throw new Error("AGENT_MODEL is required");
    }
    writeAppEnvValue("AGENT_MODEL", model);
    process.env.AGENT_MODEL = model;
    providerLog.info("provider.openrouter.model_persisted", { model });
  }

  // Make sure any other tracked env keys (e.g. AGENT_PROVIDER) are picked up
  // from the freshly-written `.env` before we resolve the provider.
  synchronizeTrackedEnv();
}

// ── 0G Compute ─────────────────────────────────────────────────

async function activate0gCompute(): Promise<ProviderSummary> {
  return withTiming(providerLog, "provider.0g.activate", async () => {
    const readiness = await checkComputeReadiness();
    renderReadiness(readiness);
    if (!readiness.ready) {
      const remediated = await guided0gSetup();
      if (!remediated) {
        writeLine("0G setup not completed. Provider unchanged.");
        return summarizeCurrent();
      }
    }

    const provider = await switchProvider("0g-compute");
    if (!provider) {
      writeLine("0G provider failed to initialise. See logs above.");
      return summarizeCurrent();
    }

    await runSmokeProbe(provider);

    const state = loadComputeState();
    const detail = state
      ? `provider=${shortAddress(state.activeProvider)} model=${state.model}`
      : "active";
    writeLine(`0G Compute active. ${detail}`);
    return summarize("0g-compute", detail);
  });
}

async function guided0gSetup(): Promise<boolean> {
  renderSection("0G Compute — guided setup");

  const broker = await getAuthenticatedBroker();
  const services = await listChatServices(broker);
  if (services.length === 0) {
    writeLine("No chat services available on the 0G network. Aborting.");
    return false;
  }

  const choice = await promptMenu(
    "Pick a provider/model",
    services.map((svc, idx) => ({
      id: String(idx),
      label: `${svc.model} — ${shortAddress(svc.provider)}`,
      description: `input ${formatPricePerMTokens(svc.inputPrice)} 0G/M  output ${formatPricePerMTokens(svc.outputPrice)} 0G/M`,
    })),
  );
  const svc = services[Number(choice)];
  if (!svc) {
    writeLine("Invalid selection.");
    return false;
  }
  const providerAddress = svc.provider;
  const model = svc.model;
  const pricing = calculateProviderPricing(svc.inputPrice, svc.outputPrice);

  writeLine();
  writeLine(`Pricing summary for ${shortAddress(providerAddress)}:`);
  writeLine(`- input  ${formatPricePerMTokens(svc.inputPrice)} 0G per 1M tokens`);
  writeLine(`- output ${formatPricePerMTokens(svc.outputPrice)} 0G per 1M tokens`);
  writeLine(`- recommended min locked: ${pricing.recommendedMinLockedOg.toFixed(4)} 0G`);
  writeLine(`- alert threshold:        ${pricing.recommendedAlertLockedOg.toFixed(4)} 0G`);
  writeLine();

  if (!(await stepDeposit(broker, pricing.recommendedMinLockedOg))) return false;
  if (!(await stepFundProvider(broker, providerAddress, pricing.recommendedMinLockedOg))) return false;
  if (!(await stepAck(broker, providerAddress))) return false;

  // Pull metadata once to confirm endpoint resolves before we save state.
  const metadata = await getServiceMetadata(broker, providerAddress);
  saveComputeState({
    activeProvider: providerAddress,
    model: metadata.model || model,
    configuredAt: Date.now(),
  });
  writeLine(`compute-state.json saved (endpoint: ${metadata.endpoint}).`);
  providerLog.info("provider.0g.state_saved", {
    providerAddress,
    model: metadata.model || model,
    endpoint: metadata.endpoint,
  });
  return true;
}

async function stepDeposit(broker: Awaited<ReturnType<typeof getAuthenticatedBroker>>, recommended: number): Promise<boolean> {
  if (await hasLedger(broker)) {
    const ledger = await getLedgerBalance(broker);
    if (ledger) writeLine(`Ledger total: ${ledger.totalOg.toFixed(4)} 0G`);
    return true;
  }

  const suggested = recommended.toFixed(4);
  const amount = (await promptText(`Initial ledger deposit in 0G (recommended ${suggested}):`, false)).trim();
  if (!amount) {
    writeLine("Deposit amount required. Aborting.");
    return false;
  }
  if (!(await confirm(`Deposit ${amount} 0G to ledger?`, true))) {
    writeLine("Deposit cancelled by operator.");
    return false;
  }
  await withTiming(providerLog, "provider.0g.deposit", () => depositToLedger(broker, amount), { amount });
  writeLine(`Ledger created with ${amount} 0G.`);
  return true;
}

async function stepFundProvider(
  broker: Awaited<ReturnType<typeof getAuthenticatedBroker>>,
  providerAddress: string,
  recommended: number,
): Promise<boolean> {
  const sub = await getSubAccountBalance(broker, providerAddress);
  if (sub && sub.lockedOg > 0) {
    writeLine(`Sub-account already funded: ${sub.lockedOg.toFixed(4)} 0G.`);
    if (sub.lockedOg >= recommended) return true;
    const ok = await confirm(
      `Sub-account locked ${sub.lockedOg.toFixed(4)} 0G is below recommended ${recommended.toFixed(4)}. Top up?`,
      false,
    );
    if (!ok) return true;
  }

  const suggested = recommended.toFixed(4);
  const amount = (await promptText(`Fund sub-account for ${shortAddress(providerAddress)} (0G, recommended ${suggested}):`, false)).trim();
  if (!amount) {
    writeLine("Funding amount required. Aborting.");
    return false;
  }
  if (!(await confirm(`Transfer ${amount} 0G from ledger to provider sub-account?`, true))) {
    writeLine("Funding cancelled by operator.");
    return false;
  }
  await withTiming(
    providerLog,
    "provider.0g.fund_provider",
    () => fundProvider(broker, providerAddress, amount),
    { providerAddress, amount },
  );
  writeLine(`Sub-account funded with ${amount} 0G.`);
  return true;
}

async function stepAck(
  broker: Awaited<ReturnType<typeof getAuthenticatedBroker>>,
  providerAddress: string,
): Promise<boolean> {
  if (await isProviderAcked(broker, providerAddress)) return true;

  if (!(await confirm("Acknowledge provider signer? (one-time on-chain ack, may take ~2 minutes)", true))) {
    writeLine("Ack cancelled by operator.");
    return false;
  }
  writeLine("Acknowledging provider signer (this may take up to 2 minutes)...");
  const acked = await withTiming(
    providerLog,
    "provider.0g.ack",
    () => ackWithReadback(broker, providerAddress),
    { providerAddress },
  );
  if (!acked) {
    writeLine("ACK readback timed out. Try again later.");
    return false;
  }
  writeLine("Provider signer acknowledged.");
  return true;
}

async function runSmokeProbe(provider: NonNullable<Awaited<ReturnType<typeof switchProvider>>>): Promise<void> {
  try {
    const config = await provider.loadConfig();
    if (!config) {
      writeLine("Smoke probe skipped: provider returned no config.");
      return;
    }
    const result = await withTiming(
      providerLog,
      "provider.0g.smoke",
      () => provider.chatCompletionSimple(
        [{ role: "user", content: "Reply with the single word: pong." }],
        config,
      ),
    );
    writeLine();
    writeLine(`Smoke probe ok. Model said: ${result.content.trim().slice(0, 200)}`);
    writeLine(`Tokens: prompt=${result.usage.promptTokens} completion=${result.usage.completionTokens}`);
    writeLine();
  } catch (err) {
    writeLine();
    writeLine(`Smoke probe failed: ${err instanceof Error ? err.message : String(err)}`);
    writeLine("State saved. Try again later or run /provider to redo setup.");
    providerLog.warn("provider.0g.smoke_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Render helpers ─────────────────────────────────────────────

function renderReadiness(readiness: Awaited<ReturnType<typeof checkComputeReadiness>>): void {
  renderSection("0G Compute — readiness");
  const rows: Array<[string, { ok: boolean; detail?: string; hint?: string }]> = [
    ["wallet", readiness.checks.wallet],
    ["broker", readiness.checks.broker],
    ["ledger", readiness.checks.ledger],
    ["subAccount", readiness.checks.subAccount],
    ["ack", readiness.checks.ack],
  ];
  for (const [label, check] of rows) {
    const status = check.ok ? "OK" : "MISSING";
    const detail = check.detail ? ` — ${check.detail}` : "";
    writeLine(`- ${label.padEnd(11)} ${status}${detail}`);
    if (!check.ok && check.hint) {
      writeLine(`             hint: ${check.hint}`);
    }
  }
}

function summarizeCurrent(): ProviderSummary {
  const active = getActiveProvider();
  if (!active) return { name: "none", detail: "No provider resolved." };
  if (active.id === "openrouter") {
    return summarize("openrouter", `model=${process.env.AGENT_MODEL ?? "?"}`);
  }
  const state = loadComputeState();
  const detail = state
    ? `provider=${shortAddress(state.activeProvider)} model=${state.model}`
    : "active";
  return summarize("0g-compute", detail);
}

function summarize(name: ProviderSummary["name"], detail: string): ProviderSummary {
  return { name, detail };
}

function shortAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
