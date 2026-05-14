/**
 * VEX Ink-shell orchestrator. Order of operations:
 *   1. Assert interactive TTY + install SIGINT/SIGTERM handlers.
 *   2. Run the linear @clack wizard — system-check + keystore + wallets +
 *      api-keys + embedding + bootstrap + agent-core + provider + mode.
 *   3. Apply wake toggle (with optional intervalMs / batchSize).
 *   4. Create a session in the kind the wizard picked. `mission` maps to chat —
 *      App.tsx auto-sends `processMissionSetupTurn(goal)` via the initial
 *      prompt intent stored in the Ink store.
 *   5. Render the Ink `<App/>` on stderr; wait for exit.
 *   6. Run shutdown hooks (wake stop, close DB pool, flush logs).
 */

import React from "react";
import { render } from "ink";
import { assertInteractiveLauncher } from "../../src/cli/setup/ui.js";
import {
  enableWake,
  enableSync,
  installSignalHandlers,
  onShutdown,
  runShutdown,
} from "./platform/runtime.js";
import {
  createShellSession,
  summarizeSession,
} from "./platform/session-host.js";
import type { SessionKind } from "../../src/vex-agent/engine/types.js";
import { runWizard, type WizardResult } from "./wizard/run-wizard.js";
import { App } from "./app/App.js";
import {
  createInitialState,
  createStore,
  type InitialPromptIntent,
} from "./app/state/store.js";
import { activateTuiLogSink } from "./platform/log.js";
import { createSessionReporter } from "./platform/session-report.js";

function mapModeToSessionKind(_mode: WizardResult["mode"]): SessionKind {
  // Post-M12: vex-shell is single-terminal-session, always agent mode.
  // Mission setup happens inside the agent session via prompts; the engine
  // promotes sessionKind to "mission" once the missions row exists.
  return "agent";
}

function buildInitialPromptIntent(wizard: WizardResult): InitialPromptIntent | null {
  if (!wizard.initialPrompt) return null;
  if (wizard.mode === "mission") {
    return {
      kind: "mission-setup",
      text: wizard.initialPrompt,
      permission: wizard.permission ?? "restricted",
    };
  }
  return null;
}

export async function runInkShell(): Promise<void> {
  assertInteractiveLauncher();
  installSignalHandlers();

  const wizard = await runWizard();
  if (wizard.aborted) {
    process.stderr.write("[vex-shell] wizard cancelled — exiting.\n");
    return;
  }

  // Wake executor always-on post-M12 (codex review round 1) — no env-driven
  // kill switch. mission loops rely on `loop_defer` + the executor.
  enableWake({ intervalMs: 2000, batchSize: 10 });

  const store = createStore(
    createInitialState({
      provider: wizard.provider,
      mode: wizard.mode,
      permission: wizard.permission ?? "restricted",
      initialPromptIntent: buildInitialPromptIntent(wizard),
    }),
  );

  const bootstrapOk = wizard.bootstrap?.ok ?? false;

  if (bootstrapOk) {
    enableSync();
  }

  if (bootstrapOk && wizard.provider.name !== "none") {
    try {
      const sessionKind = mapModeToSessionKind(wizard.mode);
      const permission = wizard.permission ?? "restricted";
      const sessionId = await createShellSession({ mode: sessionKind, permission });
      const summary = await summarizeSession(sessionId);
      const reporter = createSessionReporter({
        sessionId,
        mode: wizard.mode,
        permission,
        provider: wizard.provider.name,
        providerDetail: wizard.provider.detail,
      });
      store.setState({ session: summary ?? null, reporter });
      onShutdown(async () => {
        await reporter.end("user_exit");
      });
    } catch (err) {
      store.setState({
        lastError: `Session create failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else if (!bootstrapOk) {
    store.setState({
      lastError: `Bootstrap incomplete (${wizard.bootstrap?.failure?.stage ?? "unknown"}): ${wizard.bootstrap?.failure?.message ?? "see logs"}`,
    });
  }

  const restoreTuiLogSink = activateTuiLogSink();
  const instance = render(<App store={store} />, {
    stdout: process.stderr,
    stdin: process.stdin,
    stderr: process.stderr,
    interactive: process.stdin.isTTY === true && process.stderr.isTTY === true,
    alternateScreen: true,
    maxFps: 20,
    incrementalRendering: true,
  });
  onShutdown(() => {
    instance.unmount();
  });

  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
    restoreTuiLogSink();
    await runShutdown();
  }
}
