/**
 * Long-running async runner for `docker compose up`, daemon installs,
 * binary downloads, log streaming. Built on `child_process.spawn` so the
 * caller can drain stdout/stderr line-by-line — `execFile` would buffer
 * everything and DoS main when the subprocess emits MBs of progress.
 *
 * Cancellation: pass an `AbortSignal`. We send SIGTERM, then escalate to
 * SIGKILL after `gracePeriodMs` if the process is still alive. Skill §11
 * cleanup contract — every long-running spawn is owned by a registry.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { redact } from "../logger/redact.js";

export interface SpawnRunnerOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly gracePeriodMs?: number;
  /**
   * Hard upper bound for the spawned process. After this many ms the
   * process gets the same SIGTERM → SIGKILL escalation as `signal` abort.
   * Default: undefined (no extra deadline; only the externally supplied
   * signal terminates the process).
   */
  readonly timeoutMs?: number;
  readonly onStdoutLine?: (line: string) => void;
  readonly onStderrLine?: (line: string) => void;
}

export interface SpawnRunnerResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly aborted: boolean;
  readonly timedOut: boolean;
}

const DEFAULT_GRACE_MS = 5_000;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024; // safety cap for accumulated stdout/stderr

class StreamLineReader {
  private buffer = "";
  private readonly capBytes: number;
  private accumBytes = 0;

  constructor(capBytes: number = MAX_BUFFER_BYTES) {
    this.capBytes = capBytes;
  }

  push(chunk: string, onLine: (line: string) => void): string {
    const safe =
      this.accumBytes + chunk.length > this.capBytes
        ? chunk.slice(0, Math.max(0, this.capBytes - this.accumBytes))
        : chunk;
    this.accumBytes += safe.length;
    this.buffer += safe;
    let out = "";
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      onLine(line);
      out += line + "\n";
      idx = this.buffer.indexOf("\n");
    }
    return out;
  }

  flush(onLine: (line: string) => void): string {
    if (this.buffer.length === 0) return "";
    const line = this.buffer;
    this.buffer = "";
    onLine(line);
    return line;
  }
}

export async function runSpawn(
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnRunnerOptions = {}
): Promise<SpawnRunnerResult> {
  const {
    cwd,
    env,
    signal,
    gracePeriodMs = DEFAULT_GRACE_MS,
    onStdoutLine,
    onStderrLine,
  } = options;

  return new Promise((resolve) => {
    let aborted = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const stdoutReader = new StreamLineReader();
    const stderrReader = new StreamLineReader();
    let stdoutAccum = "";
    let stderrAccum = "";

    const child: ChildProcess = spawn(command, [...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const escalateKill = (): void => {
      if (child.pid && !child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        killTimer = setTimeout(() => {
          if (child.pid && !child.killed) {
            try {
              child.kill("SIGKILL");
            } catch {
              // ignore
            }
          }
        }, gracePeriodMs);
      }
    };

    const onAbort = (): void => {
      aborted = true;
      escalateKill();
    };
    const onTimeout = (): void => {
      timedOut = true;
      escalateKill();
    };

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(onTimeout, options.timeoutMs);
    }

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    // Codex turn 5 YELLOW #4: redact each line BEFORE invoking the
    // user-supplied callback (those callbacks fan out to renderer event
    // streams). Final stdout/stderr buffers are also redacted at resolve
    // time, but per-line redaction prevents secrets being broadcast in
    // realtime through the event bus.
    const safeOnStdout = onStdoutLine
      ? (line: string): void => onStdoutLine(redact(line) as string)
      : undefined;
    const safeOnStderr = onStderrLine
      ? (line: string): void => onStderrLine(redact(line) as string)
      : undefined;

    child.stdout?.on("data", (chunk: string) => {
      const flushed = stdoutReader.push(chunk, (line) => safeOnStdout?.(line));
      stdoutAccum += flushed;
    });
    child.stderr?.on("data", (chunk: string) => {
      const flushed = stderrReader.push(chunk, (line) => safeOnStderr?.(line));
      stderrAccum += flushed;
    });

    child.on("error", () => {
      stderrAccum += stderrReader.flush(() => undefined);
      stdoutAccum += stdoutReader.flush(() => undefined);
    });

    child.on("close", (code, sig) => {
      stderrAccum += stderrReader.flush((line) => safeOnStderr?.(line));
      stdoutAccum += stdoutReader.flush((line) => safeOnStdout?.(line));
      if (killTimer) clearTimeout(killTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({
        code,
        signal: sig,
        stdout: redact(stdoutAccum) as string,
        stderr: redact(stderrAccum) as string,
        aborted,
        timedOut,
      });
    });
  });
}
