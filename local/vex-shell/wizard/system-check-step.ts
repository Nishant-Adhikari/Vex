/**
 * System-check step — verifies Docker / Compose / Model Runner without
 * prompting for secrets. Bootstrap validation runs later, after wizard steps
 * have unlocked the vault and collected required API keys.
 *
 * Stays @clack/prompts-driven (wizard is linear); in-session live system
 * refresh is handled by the Ink Services tab (3F).
 */

import { confirm, log, spinner, isCancel } from "@clack/prompts";
import type { SystemCheckResult } from "../../../src/cli/setup/system.js";
import {
  collectSystemChecks,
  startLocalServices,
} from "../../../src/cli/setup/system.js";
import { ensureRequiredEnvDefaults } from "../../../src/cli/setup/setup.js";
import { bootstrapShell } from "../platform/bootstrap.js";
import { recordBootstrapResult } from "../platform/diagnostics.js";
import type { BootstrapResult } from "../platform/bootstrap.js";
import { shouldOfferLocalServicesStart } from "./bootstrap-recovery.js";

export interface SystemCheckOutcome {
  systemChecks: readonly SystemCheckResult[];
  aborted: boolean;
}

export interface BootstrapValidationOutcome {
  bootstrap: BootstrapResult;
  aborted: boolean;
}

const MAX_BOOTSTRAP_RETRIES = 3;

function renderSystemChecks(checks: readonly SystemCheckResult[]): void {
  for (const check of checks) {
    const mark = check.ok ? "OK" : "MISSING";
    const line = `${check.label.padEnd(24)} ${mark}  ${check.detail}`;
    if (check.ok) log.success(line);
    else log.warn(line);
  }
}

async function runBootstrapOnce(): Promise<BootstrapResult> {
  const s = spinner();
  s.start("Running bootstrap checks (DB migrations + embeddings probe)");
  const result = await bootstrapShell();
  recordBootstrapResult(result);
  if (result.ok) {
    s.stop(`Bootstrap OK (${result.durationMs}ms)`);
  } else {
    s.stop(`Bootstrap failed at ${result.failure?.stage ?? "unknown"}`);
  }
  return result;
}

export async function runSystemCheckStep(): Promise<SystemCheckOutcome> {
  log.step("System check");

  const systemChecks = collectSystemChecks();
  renderSystemChecks(systemChecks);

  const missing = systemChecks.filter((c) => !c.ok && c.label !== "Node.js 22+");
  if (missing.length > 0) {
    log.warn(
      `${missing.length} system requirement(s) missing. Fix manually (see hints above) or press Ctrl+C to quit. Continuing will likely fail at bootstrap.`,
    );
  }

  try {
    ensureRequiredEnvDefaults();
  } catch (err) {
    log.error(
      `Failed to configure local defaults: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { systemChecks, aborted: true };
  }

  return { systemChecks, aborted: false };
}

export async function runBootstrapValidationStep(): Promise<BootstrapValidationOutcome> {
  log.step("Bootstrap checks");

  // First bootstrap attempt
  let bootstrap = await runBootstrapOnce();

  // If failure looks like services down, offer auto-start
  let attempts = 1;
  while (!bootstrap.ok && attempts < MAX_BOOTSTRAP_RETRIES) {
    const failureMsg = bootstrap.failure?.message ?? "";

    if (!shouldOfferLocalServicesStart(bootstrap)) {
      log.error(
        `Bootstrap failed at ${bootstrap.failure?.stage}: ${failureMsg}. Not auto-recoverable.`,
      );
      if (bootstrap.failure?.hint) log.info(`Hint: ${bootstrap.failure.hint}`);
      break;
    }

    const shouldStart = await confirm({
      message: "Bootstrap failed — Postgres / embeddings appear to be down. Start local services (docker compose up -d) now?",
      initialValue: true,
    });
    if (isCancel(shouldStart) || !shouldStart) {
      log.warn("Skipping auto-start. Bootstrap will stay failed.");
      break;
    }

    try {
      const s = spinner();
      s.start("Starting local services (docker compose up -d)");
      startLocalServices();
      s.stop("Local services started.");
    } catch (err) {
      log.error(
        `startLocalServices failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }

    attempts += 1;
    bootstrap = await runBootstrapOnce();
  }

  if (!bootstrap.ok) {
    const shouldContinue = await confirm({
      message: "Bootstrap is still failing. Continue into the shell anyway? (features requiring DB / embeddings will error at runtime)",
      initialValue: false,
    });
    if (isCancel(shouldContinue) || !shouldContinue) {
      return { bootstrap, aborted: true };
    }
  }

  return { bootstrap, aborted: false };
}
