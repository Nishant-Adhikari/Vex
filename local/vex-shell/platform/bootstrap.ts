/**
 * Bootstrap startup sequence — mirrors `runConnectFlow()` from
 * `src/cli/setup/flow.ts` so the local shell uses the production config
 * contract without copying setup code. `runBootstrapChecks` does NOT unlock
 * the vault and does require `JUPITER_API_KEY` in `process.env`; setup unlocks
 * the vault before that check.
 *
 * `bootstrapShell()` also captures the cold-start state (system checks +
 * wallet status) so the cockpit can render it without re-probing on every
 * `/status` call. Refresh helpers below expose targeted re-checks.
 */

import {
  ensureJupiterApiKey,
  ensureKeystorePassword,
  ensureRequiredEnvDefaults,
  synchronizeTrackedEnv,
} from "../../../src/cli/setup/setup.js";
import { runBootstrapChecks, McpBootstrapError } from "../../../src/mcp/bootstrap.js";
import { McpHealthError } from "../../../src/mcp/runtime/health.js";
import {
  collectSystemChecks,
  type SystemCheckResult,
} from "../../../src/cli/setup/system.js";
import {
  getEvmWalletStatus,
  getSolanaWalletStatus,
  type WalletStatus,
} from "../../../src/cli/setup/status.js";
import { bootstrapLog, withTiming, withTimingSync } from "./log.js";

export type BootstrapStage =
  | "env_defaults"
  | "keystore_password"
  | "jupiter_api_key"
  | "sync_env"
  | "bootstrap_checks";

export interface BootstrapFailure {
  stage: BootstrapStage;
  message: string;
  hint?: string;
}

export interface ColdStartState {
  systemChecks: readonly SystemCheckResult[];
  wallets: { evm: WalletStatus; solana: WalletStatus };
  /** Epoch ms — when this snapshot was taken. */
  capturedAt: number;
}

export interface BootstrapResult {
  ok: boolean;
  failure?: BootstrapFailure;
  /** Always populated, even on failure — cockpit needs the snapshot. */
  coldStart: ColdStartState;
  /** Total wall time of the startup sequence. */
  durationMs: number;
}

/**
 * Run the full startup chain. Returns a structured result instead of
 * throwing so the cockpit can render the sections individually and offer
 * guided remediation. Throws only on truly unexpected non-bootstrap errors
 * (e.g. fs corruption) — those propagate to the top-level `runShell` catch.
 */
export async function bootstrapShell(): Promise<BootstrapResult> {
  const startedAt = Date.now();
  bootstrapLog.info("bootstrap.begin");

  // Read-only cold-start snapshot first so cockpit has the picture even if
  // a later stage fails.
  const coldStart = collectColdStartState();

  const reportFailure = (stage: BootstrapStage, err: unknown): BootstrapResult => {
    const failure = mapFailure(stage, err);
    bootstrapLog.warn("bootstrap.failed", {
      stage,
      message: failure.message,
      hint: failure.hint,
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: false,
      failure,
      coldStart,
      durationMs: Date.now() - startedAt,
    };
  };

  try {
    withTimingSync(bootstrapLog, "bootstrap.env_defaults", () => ensureRequiredEnvDefaults());
  } catch (err) {
    return reportFailure("env_defaults", err);
  }

  try {
    await withTiming(bootstrapLog, "bootstrap.keystore_password", () => ensureKeystorePassword());
  } catch (err) {
    return reportFailure("keystore_password", err);
  }

  try {
    await withTiming(bootstrapLog, "bootstrap.jupiter_api_key", () => ensureJupiterApiKey());
  } catch (err) {
    return reportFailure("jupiter_api_key", err);
  }

  try {
    withTimingSync(bootstrapLog, "bootstrap.sync_env", () => synchronizeTrackedEnv());
  } catch (err) {
    return reportFailure("sync_env", err);
  }

  try {
    await withTiming(bootstrapLog, "bootstrap.bootstrap_checks", () => runBootstrapChecks());
  } catch (err) {
    return reportFailure("bootstrap_checks", err);
  }

  const durationMs = Date.now() - startedAt;
  bootstrapLog.info("bootstrap.completed", { durationMs });

  return {
    ok: true,
    coldStart: collectColdStartState(), // re-snapshot after wallets/services may have changed
    durationMs,
  };
}

/** Read-only snapshot of system/wallet state — safe to call any time. */
export function collectColdStartState(): ColdStartState {
  return {
    systemChecks: collectSystemChecks(),
    wallets: {
      evm: getEvmWalletStatus(),
      solana: getSolanaWalletStatus(),
    },
    capturedAt: Date.now(),
  };
}

function mapFailure(stage: BootstrapStage, err: unknown): BootstrapFailure {
  if (err instanceof McpBootstrapError || err instanceof McpHealthError) {
    return { stage, message: err.message, hint: err.hint };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { stage, message };
}
