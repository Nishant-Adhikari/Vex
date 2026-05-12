import type { SubagentMonitorRow } from "../../platform/subagent-monitor.js";

export interface SubagentSummary {
  label: string;
  color: "gray" | "green" | "yellow" | "red" | "magenta";
}

export function hasSubagentAttention(rows: readonly SubagentMonitorRow[]): boolean {
  return rows.some((row) => row.attention !== "none");
}

export function summarizeSubagents(rows: readonly SubagentMonitorRow[]): SubagentSummary | null {
  if (rows.length === 0) return null;

  const errors = rows.filter((row) => row.attention === "error").length;
  if (errors > 0) return { label: `${errors} error`, color: "red" };

  const stalled = rows.filter((row) => row.attention === "stalled").length;
  if (stalled > 0) return { label: `${stalled} stalled`, color: "yellow" };

  const waiting = rows.filter((row) => row.attention === "waiting").length;
  if (waiting > 0) return { label: `${waiting} waiting`, color: "magenta" };

  const running = rows.filter((row) => row.attention === "running").length;
  if (running > 0) return { label: `${running} running`, color: "green" };

  return { label: `${rows.length} recent`, color: "gray" };
}

export function formatSubagentAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
}
