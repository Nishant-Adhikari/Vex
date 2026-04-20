import type { InternalToolContext } from "@echo-agent/tools/internal/types.js";

export function makeTestContext(overrides?: Partial<InternalToolContext>): InternalToolContext {
  return {
    sessionId: "test-session",
    loadedDocuments: new Map<string, string>(),
    loopMode: "off",
    approved: false,
    role: "parent",
    missionRunId: null,
    sessionKind: "chat",
    contextUsageBand: "normal",
    ...overrides,
  };
}
