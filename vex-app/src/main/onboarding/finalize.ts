/**
 * Wizard finalize (M11 Step 9, Phase 2 refactor — Mode + Wake removed).
 *
 * Sequenced execution with explicit failure contract (codex v3 D10):
 *
 *   1. Validate envState — defensive; renderer is supposed to gate
 *      Review behind every prior step but a hand-crafted wizard-state
 *      file could land here without provider/wallets/etc.
 *   2. autoBackup() (engine bridge `@vex-lib/wallet-backup`). Throws
 *      VexError(AUTO_BACKUP_FAILED) on fs failure → mapped to
 *      onboarding.step_failed step:auto_backup. backupPath is
 *      `string | null` because the engine returns null when there's
 *      nothing to back up.
 *   3. wizardState.completed = true. fs error → onboarding.step_failed
 *      step:wizard_state (NOT internal.contract_violation per codex
 *      v2 catch — fs failure is operational, not a schema bug).
 *   4. Telemetry consent flip (only if consent=true). Failure here
 *      does NOT fail finalize — setup is already done; we surface
 *      `telemetryWarning` so the renderer can prompt the operator
 *      to retry from Settings later.
 *   5. Best-effort `${SETUP_COMPLETE_FILE}` flag write. Primary skip-
 *      gate is `wizardState.completed`; the flag exists for future
 *      vex-shell skip detection. Best-effort = log + continue.
 *
 * Phase 2 note: Mode (AGENT_MODE/AGENT_LOOP_MODE/AGENT_INITIAL_PROMPT)
 * and Wake (AGENT_WAKE_*) no longer live in the wizard. They are
 * per-session config managed by the main app shell, so the prior
 * `ensureFullAutonomousWakeCoherent()` auto-correction (codex v3
 * Y2/RED #5) is dropped — there is no global mode anymore for it to
 * key off.
 *
 * Single-flight via module-scope promise (codex v3 fix #3): a second
 * call while finalize is in flight returns the first call's promise
 * (and so the first call's `telemetryConsent` value). Renderer disables
 * the Finalize button on submit so this is defense-in-depth, not user
 * flow. The pending slot is cleared in `finally` whether the call
 * resolves or throws.
 */

import { promises as fs } from "node:fs";
import { autoBackup } from "@vex-lib/wallet-backup.js";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import { WIZARD_STEP_IDS } from "@shared/schemas/wizard.js";
import type {
  CompleteSetupInput,
  CompleteSetupResult,
} from "@shared/schemas/finalize.js";
import { SETUP_COMPLETE_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";
import { preferencesStore } from "../preferences/store.js";
import { initSentryIfConsented } from "../telemetry/sentry-lifecycle.js";
import { gatherEnvState } from "./env-state.js";
import { wizardStateStore } from "./wizard-state-store.js";
import type { EnvState } from "@shared/schemas/onboarding.js";

const PRIOR_STEPS = WIZARD_STEP_IDS.filter((id) => id !== "review");

let pending: Promise<Result<CompleteSetupResult>> | null = null;

export function completeSetup(
  input: CompleteSetupInput,
): Promise<Result<CompleteSetupResult>> {
  if (pending) return pending;
  const promise = (async () => {
    try {
      return await runFinalize(input);
    } finally {
      pending = null;
    }
  })();
  pending = promise;
  return promise;
}

interface IncompleteItem {
  readonly section: string;
  readonly reason: string;
}

function listMissingItems(envState: EnvState): IncompleteItem[] {
  const missing: IncompleteItem[] = [];
  if (!envState.hasKeystorePassword) {
    missing.push({ section: "keystore", reason: "Master password not set." });
  }
  if (envState.walletStatus.evm !== "present") {
    missing.push({ section: "wallets", reason: "EVM wallet not configured." });
  }
  if (envState.walletStatus.solana !== "present") {
    missing.push({ section: "wallets", reason: "Solana wallet not configured." });
  }
  if (!envState.apiKeys.jupiterConfigured) {
    missing.push({ section: "apiKeys", reason: "Jupiter API key required." });
  }
  if (!envState.embeddings.allFieldsConfigured) {
    missing.push({ section: "embedding", reason: "Embedding configuration incomplete." });
  }
  if (!envState.provider.configured) {
    missing.push({ section: "provider", reason: "Inference provider not configured." });
  }
  return missing;
}

function buildValidationError(missing: IncompleteItem[]): VexError {
  return {
    code: "validation.invalid_input",
    domain: "onboarding",
    message: "Setup is incomplete — finish every prior step before finalizing.",
    retryable: false,
    userActionable: true,
    redacted: true,
    details: {
      missing: missing.map((m) => ({ section: m.section, reason: m.reason })),
    },
  };
}

function buildStepFailed(
  step: "auto_backup" | "wizard_state",
  message: string,
): VexError {
  return {
    code: "onboarding.step_failed",
    domain: "onboarding",
    message,
    retryable: true,
    userActionable: true,
    redacted: true,
    details: { step },
  };
}

async function runFinalize(
  input: CompleteSetupInput,
): Promise<Result<CompleteSetupResult>> {
  // 1. Validate envState. Phase 2 refactor: Mode + Wake live outside
  // the wizard now, so no full-autonomous auto-correction runs here.
  const envState = await gatherEnvState();

  const missing = listMissingItems(envState);
  if (missing.length > 0) {
    return err(buildValidationError(missing));
  }

  // 2. autoBackup
  let backupPath: string | null = null;
  try {
    backupPath = await autoBackup();
  } catch (cause) {
    log.error("[finalize] autoBackup failed", cause);
    return err(
      buildStepFailed(
        "auto_backup",
        "Auto-backup failed before finishing setup. Check disk space and permissions, then retry.",
      ),
    );
  }

  // 3. wizardState.completed = true
  try {
    await wizardStateStore.update({
      currentStepId: "review",
      completedSteps: PRIOR_STEPS,
      completed: true,
    });
  } catch (cause) {
    log.error("[finalize] wizardState write failed", cause);
    return err(
      buildStepFailed(
        "wizard_state",
        "Could not save wizard completion state. Try again — your backup is already on disk.",
      ),
    );
  }

  // 4. Telemetry consent (post-setup, never blocks finalize)
  let telemetryWarning: string | null = null;
  if (input.telemetryConsent) {
    try {
      await preferencesStore.update({
        telemetry: {
          enabled: true,
          consentedAt: new Date().toISOString(),
        },
      });
      const initialized = await initSentryIfConsented();
      if (!initialized) {
        telemetryWarning =
          "Setup is complete, but error reporting could not be activated (DSN missing in this build). You can opt in later from Settings.";
      }
    } catch (cause) {
      log.error("[finalize] telemetry consent apply failed", cause);
      telemetryWarning =
        "Setup is complete, but turning on error reporting failed. You can enable it later from Settings.";
    }
  }

  // 5. .setup-complete flag (best-effort)
  try {
    await fs.writeFile(SETUP_COMPLETE_FILE, "", { mode: 0o600 });
  } catch (cause) {
    log.warn(
      "[finalize] could not write .setup-complete flag (best-effort, non-blocking)",
      cause,
    );
  }

  const completedAt = new Date().toISOString();
  log.info(
    `[finalize] complete completedAt=${completedAt} hasBackup=${backupPath !== null} ` +
      `telemetryConsent=${input.telemetryConsent} telemetryWarning=${
        telemetryWarning !== null
      }`,
  );

  return ok({ completedAt, backupPath, telemetryWarning });
}

/** Test-only — production callers do not import this. */
export function __resetFinalizeSingleFlightForTests(): void {
  pending = null;
}
