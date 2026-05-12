/**
 * VEX Ink-shell orchestrator. Order of operations:
 *   1. Assert interactive TTY + install SIGINT/SIGTERM handlers.
 *   2. Run the linear @clack wizard — system-check + bootstrap + keystore +
 *      wallets + api-keys + embedding + agent-core + provider + mode + wake.
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
import type { SessionKind } from "../../src/vex-agent/db/repos/sessions.js";
import { runWizard, type WizardResult } from "./wizard/run-wizard.js";
import { App } from "./app/App.js";
import {
  createInitialState,
  createStore,
  type InitialPromptIntent,
} from "./app/state/store.js";
import { activateTuiLogSink } from "./platform/log.js";
import { createSessionReporter } from "./platform/session-report.js";

function mapModeToSessionKind(mode: WizardResult["mode"]): SessionKind {
  return mode === "full_autonomous" ? "full_autonomous" : "chat";
}

function buildInitialPromptIntent(wizard: WizardResult): InitialPromptIntent | null {
  if (!wizard.initialPrompt) return null;
  if (wizard.mode === "mission") {
    return {
      kind: "mission-setup",
      text: wizard.initialPrompt,
      loopMode: wizard.missionLoopMode ?? "restricted",
    };
  }
  if (wizard.mode === "full_autonomous") {
    return { kind: "user-message", text: wizard.initialPrompt };
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

  // Auto-start the wake executor when the operator picked full_autonomous,
  // even if they did not explicitly toggle wake in the wizard step. Without
  // it the very first `loop_defer` would park the session forever and the
  // mode would be untestable end-to-end. `enableWake` is idempotent, so the
  // explicit toggle still wins when both apply.
  if (wizard.wake || wizard.mode === "full_autonomous") {
    enableWake({
      intervalMs: wizard.wakeIntervalMs,
      batchSize: wizard.wakeBatchSize,
    });
  }
  process.env.VEX_SHELL_WIZARD_MODE = wizard.mode;

  const store = createStore(
    createInitialState({
      provider: wizard.provider,
      mode: wizard.mode,
      missionLoopMode: wizard.missionLoopMode ?? "restricted",
      wakeEnabled: wizard.wake,
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
      const sessionId = await createShellSession(sessionKind);
      const summary = await summarizeSession(sessionId);
      const reporter = createSessionReporter({
        sessionId,
        mode: wizard.mode,
        sessionKind,
        loopMode:
          wizard.mode === "mission"
            ? wizard.missionLoopMode ?? "restricted"
            : wizard.mode === "full_autonomous"
              ? "full"
              : "off",
        provider: wizard.provider.name,
        providerDetail: wizard.provider.detail,
        wakeEnabled: wizard.wake || wizard.mode === "full_autonomous",
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
