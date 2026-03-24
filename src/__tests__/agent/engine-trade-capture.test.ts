import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationSession, Message } from "../../agent/types.js";

const mockBuildSystemPrompt = vi.fn(async () => "system prompt");
const mockInferWithTools = vi.fn();
const mockExecuteTool = vi.fn();
const mockCaptureTradeFromResult = vi.fn(async () => {});
const mockCreateSession = vi.fn(async () => {});
const mockAddMessage = vi.fn(async () => {});
const mockLogUsage = vi.fn(async () => {});
const mockGetUsageStats = vi.fn(async () => ({
  sessionTokens: 0,
  sessionCost: 0,
  lifetimeTokens: 0,
  lifetimeCost: 0,
  requestCount: 0,
  lastRequestAt: null,
  lastBackupAt: null,
}));
const mockEnqueueApproval = vi.fn(async () => {});

let idCounter = 0;

vi.mock("../../agent/tools.js", () => ({
  buildSystemPrompt: (...args: unknown[]) => mockBuildSystemPrompt(...args),
}));

vi.mock("../../agent/id.js", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}-${++idCounter}`),
}));

vi.mock("../../agent/tool-registry.js", () => ({
  toOpenAITools: vi.fn(() => []),
  isInternal: vi.fn(() => false),
  isMutating: vi.fn((name: string) => name === "solana_swap_execute"),
}));

vi.mock("../../agent/inference.js", () => ({
  inferWithTools: (...args: unknown[]) => mockInferWithTools(...args),
  inferNonStreaming: vi.fn(),
  loadInferenceConfig: vi.fn(),
}));

vi.mock("../../agent/executor.js", () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
}));

vi.mock("../../agent/billing.js", () => ({
  getLedgerState: vi.fn(async () => null),
  isLowBalance: vi.fn(() => false),
  recordBillingSnapshot: vi.fn(async () => {}),
}));

vi.mock("../../agent/context.js", () => ({
  calculateBudget: vi.fn(),
  calculateHybridBudget: vi.fn(() => ({ shouldCompact: false })),
  parseCompactionResult: vi.fn(),
}));

vi.mock("../../agent/internal-tool-handlers.js", () => ({
  processInternalTools: vi.fn(async () => {}),
}));

vi.mock("../../agent/trade-capture.js", () => ({
  captureTradeFromResult: (...args: unknown[]) => mockCaptureTradeFromResult(...args),
}));

vi.mock("../../agent/db/repos/memory.js", () => ({
  appendMemory: vi.fn(async () => {}),
}));

vi.mock("../../agent/db/repos/sessions.js", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  updateSessionTokenCount: vi.fn(async () => {}),
  archiveSessionMessages: vi.fn(async () => {}),
  checkpointSession: vi.fn(async () => {}),
}));

vi.mock("../../agent/db/repos/messages.js", () => ({
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
}));

vi.mock("../../agent/db/repos/usage.js", () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
  getUsageStats: (...args: unknown[]) => mockGetUsageStats(...args),
}));

vi.mock("../../agent/db/repos/approvals.js", () => ({
  enqueue: (...args: unknown[]) => mockEnqueueApproval(...args),
}));

vi.mock("../../agent/prompts/compaction.js", () => ({
  buildCompactionPrompt: vi.fn(),
  getCompactionSystemPrompt: vi.fn(),
}));

vi.mock("../../agent/session-lock.js", () => ({
  withSessionLock: vi.fn(async (_sessionId: string, fn: () => Promise<void>) => fn()),
}));

vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { processMessage, resumeAfterApproval } = await import("../../agent/engine.js");

function makeSession(): ConversationSession {
  return {
    id: "session-1",
    messages: [],
    loadedKnowledge: new Map<string, string>(),
    inferenceConfig: {
      provider: "test-provider",
      model: "test-model",
      endpoint: "http://localhost",
      contextLimit: 64_000,
      inputPricePerM: 1,
      outputPricePerM: 2,
      recommendedMinLockedOg: 1,
      alertThresholdOg: 1.2,
    },
  };
}

describe("engine trade capture hooks", () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it("captures successful CLI executions during the main inference loop", async () => {
    const session = makeSession();
    const events: Message[] = [];

    mockInferWithTools
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ name: "solana_swap_execute", arguments: { amount: "1" } }],
        usage: { promptTokens: 0, completionTokens: 0 },
      })
      .mockResolvedValueOnce({
        content: "done",
        toolCalls: null,
        usage: { promptTokens: 0, completionTokens: 0 },
      });

    mockExecuteTool.mockResolvedValue({
      id: "result-1",
      command: "solana_swap_execute",
      success: true,
      output: "{\"success\":true}",
      argv: ["solana", "swap", "execute", "--amount", "1", "--json", "--yes"],
      durationMs: 12,
    });

    await processMessage(session, "swap now", (event) => {
      events.push({
        role: "assistant",
        content: event.type,
        timestamp: new Date().toISOString(),
      });
    }, "full");

    expect(mockCreateSession).toHaveBeenCalledWith("session-1");
    expect(mockExecuteTool).toHaveBeenCalledWith(
      expect.objectContaining({ command: "solana_swap_execute", confirm: true }),
      true,
    );
    expect(mockCaptureTradeFromResult).toHaveBeenCalledWith(
      "solana_swap_execute",
      ["solana", "swap", "execute", "--amount", "1", "--json", "--yes"],
      "{\"success\":true}",
    );
    expect(events.map((event) => event.content)).toContain("done");
  });

  it("queues restricted mutations for approval without capturing trades early", async () => {
    const session = makeSession();
    const emitted: string[] = [];

    mockInferWithTools.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ name: "solana_swap_execute", arguments: { amount: "1" } }],
      usage: { promptTokens: 0, completionTokens: 0 },
    });

    await processMessage(session, "swap later", (event) => {
      emitted.push(event.type);
    }, "restricted");

    expect(mockEnqueueApproval).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(mockCaptureTradeFromResult).not.toHaveBeenCalled();
    expect(emitted).toContain("approval_required");
  });

  it("captures trades when an approved tool is resumed", async () => {
    const session = makeSession();

    mockExecuteTool.mockResolvedValue({
      id: "result-2",
      command: "solana_swap_execute",
      success: true,
      output: "{\"success\":true,\"signature\":\"sig\"}",
      argv: ["solana", "swap", "execute", "--amount", "1", "--json", "--yes"],
      durationMs: 20,
    });
    mockInferWithTools.mockResolvedValueOnce({
      content: "approved done",
      toolCalls: null,
      usage: { promptTokens: 0, completionTokens: 0 },
    });

    await resumeAfterApproval(
      session,
      { command: "solana_swap_execute", args: { amount: "1" }, confirm: true },
      () => {},
      "restricted",
      "tool-call-1",
    );

    expect(mockExecuteTool).toHaveBeenCalledWith(
      { command: "solana_swap_execute", args: { amount: "1" }, confirm: true },
      true,
    );
    expect(mockCaptureTradeFromResult).toHaveBeenCalledWith(
      "solana_swap_execute",
      ["solana", "swap", "execute", "--amount", "1", "--json", "--yes"],
      "{\"success\":true,\"signature\":\"sig\"}",
    );
  });
});
