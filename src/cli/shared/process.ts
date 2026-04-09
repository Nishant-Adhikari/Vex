import { spawnSync } from "node:child_process";

export interface CommandResult {
  ok: boolean;
  detail: string;
}

export function runCommand(command: string, args: readonly string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
  });

  if (result.error) {
    return {
      ok: false,
      detail: result.error.message,
    };
  }

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    ok: result.status === 0,
    detail: output || "OK",
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
