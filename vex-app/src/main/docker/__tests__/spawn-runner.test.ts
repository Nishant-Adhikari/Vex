/**
 * Smoke tests for the long-running spawn helper. Uses Node's `printf`
 * surrogate (`node -e`) to keep the test suite portable across CI.
 */

import { describe, expect, it } from "vitest";
import { runSpawn } from "../spawn-runner.js";

function stdoutCommand(): { readonly command: string; readonly args: string[] } {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "echo a&&echo b&&echo c"],
    };
  }
  return { command: "printf", args: ["a\nb\nc\n"] };
}

function stderrCommand(): { readonly command: string; readonly args: string[] } {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "echo boom 1>&2&&exit /b 7"],
    };
  }
  return { command: "sh", args: ["-c", "printf 'boom\\n' >&2; exit 7"] };
}

function hangCommand(): { readonly command: string; readonly args: string[] } {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "ping -n 30 127.0.0.1 >NUL"],
    };
  }
  return { command: "sleep", args: ["30"] };
}

describe("runSpawn", () => {
  it("captures stdout via line callback and final stdout buffer", async () => {
    const lines: string[] = [];
    const command = stdoutCommand();
    const result = await runSpawn(
      command.command,
      command.args,
      { onStdoutLine: (line) => lines.push(line) }
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("a\nb\nc\n");
    expect(lines).toEqual(["a", "b", "c"]);
    expect(result.aborted).toBe(false);
  });

  it("captures stderr separately", async () => {
    const errLines: string[] = [];
    const command = stderrCommand();
    const result = await runSpawn(
      command.command,
      command.args,
      { onStderrLine: (line) => errLines.push(line) }
    );
    expect(result.code).toBe(7);
    expect(errLines).toEqual(["boom"]);
  });

  it("honors AbortSignal and reports aborted=true", async () => {
    const ac = new AbortController();
    const command = hangCommand();
    const promise = runSpawn(
      command.command,
      command.args,
      { signal: ac.signal, gracePeriodMs: 200 }
    );
    setTimeout(() => ac.abort(), 50);
    const result = await promise;
    expect(result.aborted).toBe(true);
  });
});
