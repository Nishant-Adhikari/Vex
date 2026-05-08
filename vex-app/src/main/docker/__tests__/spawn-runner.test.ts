/**
 * Smoke tests for the long-running spawn helper. Uses Node's `printf`
 * surrogate (`node -e`) to keep the test suite portable across CI.
 */

import { describe, expect, it } from "vitest";
import { runSpawn } from "../spawn-runner.js";

describe("runSpawn", () => {
  it("captures stdout via line callback and final stdout buffer", async () => {
    const lines: string[] = [];
    const result = await runSpawn(
      process.execPath,
      ["-e", "console.log('a'); console.log('b'); console.log('c');"],
      { onStdoutLine: (line) => lines.push(line) }
    );
    expect(result.code).toBe(0);
    expect(lines).toEqual(["a", "b", "c"]);
    expect(result.stdout).toBe("a\nb\nc\n");
    expect(result.aborted).toBe(false);
  });

  it("captures stderr separately", async () => {
    const errLines: string[] = [];
    const result = await runSpawn(
      process.execPath,
      ["-e", "console.error('boom'); process.exit(7);"],
      { onStderrLine: (line) => errLines.push(line) }
    );
    expect(result.code).toBe(7);
    expect(errLines).toEqual(["boom"]);
  });

  it("honors AbortSignal and reports aborted=true", async () => {
    const ac = new AbortController();
    const promise = runSpawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000);"],
      { signal: ac.signal, gracePeriodMs: 200 }
    );
    setTimeout(() => ac.abort(), 50);
    const result = await promise;
    expect(result.aborted).toBe(true);
  });
});
