import { describe, expect, it } from "vitest";

import {
  buildSubagentMonitorRow,
  summarizeSubagentActivity,
} from "../platform/subagent-monitor.js";
import { selectSettingsStartTab } from "../app/hooks/useHotkeys.js";
import type { Message } from "../../../src/vex-agent/db/repos/messages.js";
import type { SubagentState } from "../../../src/vex-agent/db/repos/subagents.js";

const STARTED_AT = "2026-05-03T10:00:00.000Z";

function makeSubagent(overrides: Partial<SubagentState> = {}): SubagentState {
  return {
    id: "subagent-1",
    name: "VexScout",
    task: "Research token flow",
    status: "running",
    allowTrades: false,
    startedAt: STARTED_AT,
    endedAt: null,
    result: null,
    error: null,
    tokenCost: 0,
    iterations: 0,
    maxIterations: 25,
    ...overrides,
  };
}

describe("local shell subagent monitor", () => {
  it("summarizes the latest assistant tool call", () => {
    const activity = summarizeSubagentActivity([
      {
        id: 1,
        role: "assistant",
        content: "",
        timestamp: "2026-05-03T10:00:01.000Z",
        toolCalls: [{ id: "call-1", command: "dexscreener.trending", args: {} }],
      },
    ]);

    expect(activity.label).toBe("calling dexscreener.trending");
    expect(activity.lastToolName).toBe("dexscreener.trending");
    expect(activity.lastActivityAt).toBe("2026-05-03T10:00:01.000Z");
  });

  it("maps a tool result back to its tool name", () => {
    const messages: Message[] = [
      {
        id: 1,
        role: "assistant",
        content: "",
        timestamp: "2026-05-03T10:00:01.000Z",
        toolCalls: [{ id: "call-1", command: "twitter_account", args: {} }],
      },
      {
        id: 2,
        role: "tool",
        content: "ok",
        timestamp: "2026-05-03T10:00:02.000Z",
        toolCallId: "call-1",
      },
    ];

    expect(summarizeSubagentActivity(messages).label).toBe("tool result twitter_account");
  });

  it("marks a zero-activity running subagent as stalled after ten seconds", () => {
    const row = buildSubagentMonitorRow(
      makeSubagent(),
      "child-session",
      [],
      Date.parse("2026-05-03T10:00:11.000Z"),
    );

    expect(row.stalled).toBe(true);
    expect(row.attention).toBe("stalled");
  });

  it("opens settings on subagents only when attention is needed", () => {
    expect(selectSettingsStartTab(true)).toBe("subagents");
    expect(selectSettingsStartTab(false)).toBe("provider");
  });
});
