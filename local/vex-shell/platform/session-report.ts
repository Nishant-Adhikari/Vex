/**
 * Session reporter — writes a per-session JSONL transcript of every event
 * the shell observes (user input, assistant output, tool I/O, approvals,
 * derived engine signals, errors), plus a one-shot meta summary on session
 * end. The output is consumed by an offline evaluator script — it is not
 * part of any production telemetry pipeline.
 *
 * Design constraints:
 *   - Never throw into the host. A reporter failure must never crash a turn.
 *   - Ordered append. Events serialize through a single chained promise so
 *     two parallel `recordEvent` calls cannot interleave partial JSON lines.
 *   - Crash-safe. JSONL with `flags: "a"`, line-delimited, so a `kill -9`
 *     during a write loses at most the trailing line.
 *   - Bounded shutdown. `end()` races the queue drain against a 2 s timeout
 *     so it cannot hang process exit.
 *   - Opt-out via `VEX_SHELL_REPORT_DISABLE=1`. Returns a no-op shape so the
 *     call sites stay branchless.
 *
 * File layout (default — overridable with `VEX_SHELL_REPORT_DIR`):
 *   <repo>/local/session-reports/<sessionId>.jsonl
 *   <repo>/local/session-reports/<sessionId>.meta.json
 */

import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { LOCAL_DEBUG_DIR } from "./local-paths.js";
import { runtimeLog } from "./log.js";
import {
  redactSecrets,
  reportEventSchema,
  reportMetaSchema,
  type RecordableEvent,
  type ReportEvent,
  type ReportMeta,
} from "./report-schema.js";

export type SessionEndedReason = "user_exit" | "sigint" | "sigterm" | "error";

export interface SessionReporterInit {
  readonly sessionId: string;
  readonly mode: "chat" | "mission" | "full_autonomous";
  readonly sessionKind: "chat" | "full_autonomous";
  readonly loopMode: "off" | "restricted" | "full" | null;
  readonly provider: string;
  readonly providerDetail: string;
  readonly wakeEnabled: boolean;
}

export interface SessionReporter {
  /** Fire-and-forget. Validates and queues the event; never throws. */
  recordEvent(event: RecordableEvent): void;
  /** Idempotent. Drains the queue (≤2s) and writes the meta companion. */
  end(reason: SessionEndedReason): Promise<void>;
  /** Path of the JSONL file (or null when reporter is disabled). */
  readonly reportFile: string | null;
}

const SHUTDOWN_FLUSH_MS = 2000;

const ENV_DISABLE = "VEX_SHELL_REPORT_DISABLE";
const ENV_NO_REDACT = "VEX_SHELL_REPORT_NO_REDACT";
const ENV_DIR_OVERRIDE = "VEX_SHELL_REPORT_DIR";
const ENV_GIT_SHA_HINT = "VEX_SHELL_GIT_SHA";

function envFlag(name: string): boolean {
  const raw = process.env[name];
  return raw === "1" || raw === "true";
}

function reportDir(): string {
  const override = process.env[ENV_DIR_OVERRIDE]?.trim();
  if (override && override.length > 0) return override;
  return join(LOCAL_DEBUG_DIR, "session-reports");
}

function envFingerprint(init: SessionReporterInit): string {
  const ingredients = [
    process.env.NODE_ENV ?? "",
    process.env.VEX_SHELL_WIZARD_MODE ?? "",
    init.provider,
    init.mode,
    init.loopMode ?? "",
    init.wakeEnabled ? "wake" : "nowake",
  ].join("|");
  return createHash("sha256").update(ingredients).digest("hex").slice(0, 16);
}

interface ReporterTotals {
  events: number;
  toolCalls: number;
  toolResults: number;
  approvals: number;
  errors: number;
  turns: number;
}

function noopReporter(): SessionReporter {
  return {
    recordEvent: () => {},
    end: async () => {},
    reportFile: null,
  };
}

/**
 * Construct a reporter bound to one session. The factory is synchronous —
 * filesystem work is deferred to the first `recordEvent` call so a disabled
 * reporter creates no directories or files.
 */
export function createSessionReporter(init: SessionReporterInit): SessionReporter {
  if (envFlag(ENV_DISABLE)) {
    runtimeLog.info("session.report.disabled", { reason: ENV_DISABLE });
    return noopReporter();
  }

  const redactionEnabled = !envFlag(ENV_NO_REDACT);
  const dir = reportDir();
  const reportFile = join(dir, `${init.sessionId}.jsonl`);
  const metaFile = join(dir, `${init.sessionId}.meta.json`);

  let stream: WriteStream | null = null;
  let degraded = false;
  let writeFailureLogged = false;
  let seq = 0;
  let writeQueue: Promise<void> = Promise.resolve();
  let endPromise: Promise<void> | null = null;
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  const totals: ReporterTotals = {
    events: 0,
    toolCalls: 0,
    toolResults: 0,
    approvals: 0,
    errors: 0,
    turns: 0,
  };

  function ensureStream(): WriteStream | null {
    if (stream || degraded) return stream;
    try {
      mkdirSync(dir, { recursive: true });
      stream = createWriteStream(reportFile, { flags: "a", encoding: "utf8" });
      stream.on("error", (err) => {
        if (!writeFailureLogged) {
          runtimeLog.warn("session.report.stream_error", {
            sessionId: init.sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
          writeFailureLogged = true;
        }
        degraded = true;
      });
      runtimeLog.info("session.report.opened", {
        sessionId: init.sessionId,
        file: reportFile,
        redaction: redactionEnabled,
      });
      return stream;
    } catch (err) {
      degraded = true;
      runtimeLog.warn("session.report.disabled_after_open_failed", {
        sessionId: init.sessionId,
        file: reportFile,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  function bumpTotals(kind: ReportEvent["kind"]): void {
    totals.events += 1;
    switch (kind) {
      case "toolCall":
        totals.toolCalls += 1;
        break;
      case "toolResult":
        totals.toolResults += 1;
        break;
      case "approval":
        totals.approvals += 1;
        break;
      case "error":
        totals.errors += 1;
        break;
      case "turnCompleted":
        totals.turns += 1;
        break;
      default:
        break;
    }
  }

  function applyRedaction(event: RecordableEvent): {
    event: RecordableEvent;
    redacted: boolean;
  } {
    if (event.kind === "toolCall") {
      const r = redactSecrets(event.args, { enabled: redactionEnabled });
      return {
        event: { ...event, args: r.value, redacted: r.redacted },
        redacted: r.redacted,
      };
    }
    if (event.kind === "toolResult") {
      const r = redactSecrets(event.output, { enabled: redactionEnabled });
      const redactedOutput = typeof r.value === "string" ? r.value : String(r.value);
      return {
        event: {
          ...event,
          output: redactedOutput,
          byteSize: Buffer.byteLength(redactedOutput, "utf8"),
          redacted: r.redacted,
        },
        redacted: r.redacted,
      };
    }
    return { event, redacted: false };
  }

  function buildEnvelope(input: RecordableEvent): ReportEvent {
    seq += 1;
    return {
      ...input,
      seq,
      at: new Date().toISOString(),
      sessionId: init.sessionId,
    } as ReportEvent;
  }

  function enqueueWrite(line: string): void {
    writeQueue = writeQueue.then(
      () =>
        new Promise<void>((resolve) => {
          const target = ensureStream();
          if (!target) {
            resolve();
            return;
          }
          target.write(line, (err) => {
            if (err && !writeFailureLogged) {
              runtimeLog.warn("session.report.write_failed", {
                sessionId: init.sessionId,
                error: err.message,
              });
              writeFailureLogged = true;
            }
            resolve();
          });
        }),
    );
  }

  function recordEvent(input: RecordableEvent): void {
    if (degraded || endPromise) return;
    try {
      const sanitized = applyRedaction(input);
      const envelope = buildEnvelope(sanitized.event);
      const parsed = reportEventSchema.safeParse(envelope);
      if (!parsed.success) {
        if (!writeFailureLogged) {
          runtimeLog.warn("session.report.event_invalid", {
            sessionId: init.sessionId,
            kind: input.kind,
            issues: parsed.error.issues.slice(0, 3).map((i) => i.message),
          });
          writeFailureLogged = true;
        }
        return;
      }
      bumpTotals(parsed.data.kind);
      enqueueWrite(`${JSON.stringify(parsed.data)}\n`);
    } catch (err) {
      if (!writeFailureLogged) {
        runtimeLog.warn("session.report.record_threw", {
          sessionId: init.sessionId,
          kind: input.kind,
          error: err instanceof Error ? err.message : String(err),
        });
        writeFailureLogged = true;
      }
    }
  }

  function writeMetaSnapshot(reason: SessionEndedReason): void {
    const endedAtMs = Date.now();
    const meta: ReportMeta = {
      sessionId: init.sessionId,
      mode: init.mode,
      sessionKind: init.sessionKind,
      loopMode: init.loopMode,
      provider: init.provider,
      providerDetail: init.providerDetail,
      wakeEnabled: init.wakeEnabled,
      schemaVersion: 1,
      startedAt: startedAtIso,
      endedAt: new Date(endedAtMs).toISOString(),
      endReason: reason,
      totals: { ...totals, durationMs: endedAtMs - startedAtMs },
      reportFile,
      redactionEnabled,
    };
    const parsed = reportMetaSchema.safeParse(meta);
    if (!parsed.success) {
      runtimeLog.warn("session.report.meta_invalid", {
        sessionId: init.sessionId,
        issues: parsed.error.issues.slice(0, 3).map((i) => i.message),
      });
      return;
    }
    try {
      writeFileSync(metaFile, `${JSON.stringify(parsed.data, null, 2)}\n`, { encoding: "utf8" });
    } catch (err) {
      runtimeLog.warn("session.report.meta_write_failed", {
        sessionId: init.sessionId,
        file: metaFile,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function end(reason: SessionEndedReason): Promise<void> {
    if (endPromise) return endPromise;

    endPromise = (async () => {
      const endedAtMs = Date.now();
      const finalEvent: RecordableEvent = {
        kind: "sessionEnded",
        reason,
        totals: { ...totals, durationMs: endedAtMs - startedAtMs },
      };
      try {
        const envelope: ReportEvent = {
          ...finalEvent,
          seq: seq + 1,
          at: new Date(endedAtMs).toISOString(),
          sessionId: init.sessionId,
        };
        seq += 1;
        const parsed = reportEventSchema.safeParse(envelope);
        if (parsed.success) {
          bumpTotals(parsed.data.kind);
          enqueueWrite(`${JSON.stringify(parsed.data)}\n`);
        }
      } catch (err) {
        runtimeLog.warn("session.report.end_event_threw", {
          sessionId: init.sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const drain = writeQueue.then(
        () =>
          new Promise<void>((resolve) => {
            if (!stream) {
              resolve();
              return;
            }
            stream.end(() => resolve());
          }),
      );
      const timeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          runtimeLog.warn("session.report.flush_timeout", {
            sessionId: init.sessionId,
            timeoutMs: SHUTDOWN_FLUSH_MS,
          });
          resolve();
        }, SHUTDOWN_FLUSH_MS).unref(),
      );

      await Promise.race([drain, timeout]);
      writeMetaSnapshot(reason);
    })();

    return endPromise;
  }

  // Stamp the sessionStarted event ourselves so the writer is the single
  // owner of envelope fields. Callers should not pre-emit sessionStarted.
  recordEvent({
    kind: "sessionStarted",
    mode: init.mode,
    sessionKind: init.sessionKind,
    loopMode: init.loopMode,
    provider: init.provider,
    providerDetail: init.providerDetail,
    wakeEnabled: init.wakeEnabled,
    envHash: envFingerprint(init),
    shellGitSha: process.env[ENV_GIT_SHA_HINT],
    schemaVersion: 1,
  });

  return {
    recordEvent,
    end,
    reportFile,
  };
}
