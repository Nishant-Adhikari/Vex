/**
 * Engine -> renderer transcript-event bridge.
 *
 * Subscribes to the in-process `transcriptEventBus` (canonical engine
 * spine in `src/vex-agent/engine/events/transcript-bus.ts`), revalidates
 * every emit through the shared Zod schema, and broadcasts the
 * already-parsed payload to every BrowserWindow via the existing
 * `broadcastToAllWindows` helper.
 *
 * Bus -> bridge contract:
 *  - the bus emits only AFTER the writing transaction commits, so a
 *    visible event always corresponds to a row the renderer can fetch
 *    through `messages.getTail`;
 *  - the bridge re-validates with `.strict()` even though the engine
 *    type-checks the emit shape — defense-in-depth so a mistake in
 *    engine writes never reaches preload as a raw object;
 *  - the preload subscriber re-validates on receive (third layer);
 *  - the renderer only uses the event as a refresh signal — the DB row
 *    fetched via `messages.getTail` is the canonical state.
 *
 * Import discipline (codex review constraint #3): the bridge imports the
 * bus directly from `transcript-bus.js`, NOT through the
 * `engine/events/index.js` barrel. The barrel also re-exports
 * `appendMessage` / `addMessageReturningId` which would pull the DB
 * client into main-process module graph at bridge-setup time. We only
 * need the singleton bus and the type.
 */

import { EV } from "@shared/ipc/channels.js";
import { transcriptAppendEventSchema } from "@shared/schemas/messages.js";
import {
  transcriptEventBus,
  type TranscriptAppendEvent,
} from "@vex-agent/engine/events/transcript-bus.js";
import { broadcastToAllWindows } from "../lifecycle/broadcast.js";
import { log } from "../logger/index.js";
import { createBugReport } from "../support/bug-report-service.js";

/**
 * Subscribe the transcript bus to the IPC broadcaster. Returns the
 * teardown callback — caller pushes it into `globalCleanup` so app
 * quit / reload removes the listener cleanly.
 */
export function setupTranscriptBridge(): () => void {
  const off = transcriptEventBus.subscribe((event: TranscriptAppendEvent) => {
    const parsed = transcriptAppendEventSchema.safeParse(event);
    if (!parsed.success) {
      // Drop malformed payloads — never broadcast a value that did not
      // round-trip through the shared schema. Keep the log structured
      // so support bundles surface the violation without leaking the
      // raw payload (which may carry unbounded engine state).
      log.warn(
        "[agent:transcript-bridge] dropped invalid engine.transcriptAppend payload",
        { issues: parsed.error.issues },
      );
      // Back-fill puzzle 2 (BUG-REPORTING phase 2): record the drop as
      // an `ipc_validation_failure` automatic bug report. Fail-closed:
      // a support DB outage must not crash the bridge.
      //
      // Source is `main` here (not `agent`) because the bridge runs in
      // vex-app/main, not engine — using `createBugReport` directly
      // matches the trust boundary instead of going through the
      // engine-side `BugReportSink`.
      void createBugReport({
        reportKind: "automatic",
        source: "main",
        category: "ipc_validation_failure",
        severity: "warning",
        title: "transcript-bridge.invalid_payload_dropped",
        description: "",
        context: { issueCount: parsed.error.issues.length },
        refs:
          typeof (event as { sessionId?: unknown }).sessionId === "string"
            ? { sessionId: (event as { sessionId: string }).sessionId }
            : {},
      }).catch((err) => {
        log.warn(
          "[agent:transcript-bridge] back-fill bug report failed",
          err,
        );
      });
      return;
    }
    broadcastToAllWindows(EV.engine.transcriptAppend, parsed.data);
  });

  return () => {
    off();
  };
}
