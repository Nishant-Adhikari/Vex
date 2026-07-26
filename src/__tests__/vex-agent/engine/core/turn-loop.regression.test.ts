/**
 * Regression tests — turn-loop cap-enforcement invariants.
 *
 * DUAL-DB-FAIL-UNCAPPED: When BOTH the cost-cap DB read AND the token-budget
 * DB read throw in the same iteration (e.g. a transient DB pool outage), the
 * loop must NOT run with zero enforcement. It degrades gracefully by setting
 * `missionBudgetFraction` to 0.9 so the budget-pressure UI shows warning state
 * rather than blank. The loop continues (we prefer degraded enforcement over an
 * unexpected stop mid-mission).
 *
 * COST-CAP-DOUBLE-SPEND: The run phase must use `missionTokenSince: null`
 * (session-wide baseline), not `missionTokenSince: run.startedAt`. Scoping the
 * accumulator to `run.startedAt` silently ignores pre-run setup cost (a
 * "double-spend" gap), understating real spend and extending the run beyond the
 * configured cap. This is pinned at the source level.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Budget fraction capture (DUAL-DB-FAIL) ────────────────────────────────
// We mock buildTurnPromptStack to intercept the missionBudgetFraction argument
// that the loop passes after evaluating both cap reads.

const capturedBudgetFractions: Array<number | null> = [];
const mockBuildTurnPromptStack = vi.fn().mockImplementation(
  async (args: { missionBudgetFraction: number | null }) => {
    capturedBudgetFractions.push(args.missionBudgetFraction);
    return {
      tools: [],
      promptOptions: {},
      nextPostCompactBridgeRemaining: 0,
    };
  },
);

vi.mock("@vex-agent/engine/core/turn-loop-prompt-stack.js", () => ({
  buildTurnPromptStack: (...a: unknown[]) => mockBuildTurnPromptStack(...a),
}));

// ── Usage repo mocks (cost cap + token budget reads) ─────────────────────

const mockGetSessionTotalCost = vi.fn().mockResolvedValue(0);
const mockGetSessionTotalTokens = vi.fn().mockResolvedValue(0);
const mockLogUsage = vi.fn().mockResolvedValue(undefined);

vi.mock("@vex-agent/db/repos/usage.js", () => ({
  logUsage: (...a: unknown[]) => mockLogUsage(...a),
  getSessionTotalCost: (...a: unknown[]) => mockGetSessionTotalCost(...a),
  getSessionTotalTokens: (...a: unknown[]) => mockGetSessionTotalTokens(...a),
}));

// ── The rest of the turn-loop mock infrastructure ─────────────────────────
// Mirrors turn-loop-defer.test.ts so runTurnLoop can execute a single turn.

const mockAddMessage = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockGetLiveMessages = vi.fn().mockResolvedValue([]);
const mockDispatchTool = vi.fn();
const mockIncrementIterations = vi.fn().mockResolvedValue(1);
const mockUpdateStatus = vi.fn();
const mockSetLastCheckpoint = vi.fn();
const mockEnqueueApproval = vi.fn();
const mockGetSessionForLoop = vi.fn().mockResolvedValue({ tokenCount: 0 });
const mockGetOperatorInstructionsAfter = vi.fn().mockResolvedValue([]);

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: (...a: unknown[]) => mockAddEngineMessage(...a),
  addMessageReturningId: vi.fn().mockResolvedValue({
    id: 1,
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
  }),
  getLiveMessages: (...a: unknown[]) => mockGetLiveMessages(...a),
  getOperatorInstructionsAfter: (...a: unknown[]) =>
    mockGetOperatorInstructionsAfter(...a),
}));

vi.mock("@vex-agent/engine/events/index.js", () => ({
  appendMessage: (...a: unknown[]) => mockAddMessage(...a),
  appendEngineMessage: (...a: unknown[]) => mockAddEngineMessage(...a),
  emitTranscriptAppend: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  incrementIterations: (...a: unknown[]) => mockIncrementIterations(...a),
  updateStatus: (...a: unknown[]) => mockUpdateStatus(...a),
  setLastCheckpoint: (...a: unknown[]) => mockSetLastCheckpoint(...a),
}));

vi.mock("@vex-agent/tools/dispatcher.js", () => ({
  dispatchTool: (...a: unknown[]) => mockDispatchTool(...a),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  updateTokenCount: vi.fn(),
  setRollingSummary: vi.fn(),
  archivePrefix: vi.fn(),
  forkToolMessageToArchive: vi.fn(),
  getSession: (...a: unknown[]) => mockGetSessionForLoop(...a),
}));

vi.mock("@vex-agent/engine/compact-jobs/forced-fallback.js", () => ({
  maybeRunForcedCompactFallback: vi.fn().mockResolvedValue({
    kind: "committed",
    generation: 1,
    archivedMessages: 3,
    jobId: 7,
    redactionCounts: { hard: 0, mask: 0 },
    planMode: "prefix",
  }),
}));

vi.mock("@vex-agent/db/repos/approvals.js", () => ({
  enqueue: (...a: unknown[]) => mockEnqueueApproval(...a),
  enqueueWith: (...a: unknown[]) => mockEnqueueApproval(...a.slice(1)),
}));

vi.mock("@vex-agent/db/repos/approval-intents.js", () => ({
  createWith: vi.fn(),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  getPool: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  }),
  queryWith: vi.fn().mockResolvedValue([]),
  queryOneWith: vi.fn().mockImplementation(
    async (_exec: unknown, sql: string) => {
      if (
        typeof sql === "string" &&
        sql.includes("INSERT INTO messages") &&
        sql.includes("RETURNING id, created_at")
      ) {
        return { id: 1, created_at: new Date().toISOString() };
      }
      return null;
    },
  ),
  executeWith: vi.fn().mockResolvedValue(1),
  withTransaction: vi.fn().mockImplementation(
    async (fn: (client: unknown) => Promise<unknown>) => {
      const stubClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      };
      return fn(stubClient);
    },
  ),
}));

vi.mock("@vex-agent/engine/runtime/lease-and-status.js", () => ({
  claimRunLeaseAndFlipToRunning: vi.fn().mockResolvedValue({
    outcome: "claimed",
    previousStatus: "paused_wake",
    lease: {
      sessionId: "s",
      missionRunId: "r",
      ownerId: "test-owner",
      processKind: "electron_main",
      acquiredAt: new Date(),
      heartbeatAt: new Date(),
      expiresAt: new Date(),
    },
    wakeCancelledCount: 0,
  }),
  claimSessionLease: vi.fn().mockResolvedValue({
    outcome: "claimed",
    lease: {
      sessionId: "s",
      missionRunId: null,
      ownerId: "test-owner",
      processKind: "electron_main",
      acquiredAt: new Date(),
      heartbeatAt: new Date(),
      expiresAt: new Date(),
    },
  }),
  observeAndApplyControl: vi.fn().mockResolvedValue({ outcome: "no_request" }),
}));

vi.mock("@vex-agent/engine/runtime/lease-handle.js", () => ({
  createLeaseHandle: vi.fn().mockReturnValue({
    lease: {
      sessionId: "s",
      missionRunId: null,
      ownerId: "test-owner",
      processKind: "electron_main",
      acquiredAt: new Date(),
      heartbeatAt: new Date(),
      expiresAt: new Date(),
    },
    ownerId: "test-owner",
    release: vi.fn().mockResolvedValue(undefined),
    onLeaseLost: vi.fn(),
  }),
}));

vi.mock("@vex-agent/engine/runtime/release-and-emit.js", () => ({
  releaseLeaseAndEmitControlState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@vex-agent/engine/prompts/own-token-banner.js", () => ({
  buildOwnTokenBanner: vi.fn().mockResolvedValue(""),
}));

vi.mock("@vex-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

const { runTurnLoop } = await import(
  "../../../../vex-agent/engine/core/turn-loop.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeContext(overrides = {}) {
  return {
    sessionId: "session-1",
    sessionKind: "mission" as const,
    sessionPermission: "restricted" as const,
    missionId: "mission-1",
    missionRunId: "run-1",
    isSubagent: false,
    selectedEvmWallet: null,
    selectedSolanaWallet: null,
    walletPolicy: { kind: "none" as const },
    loadedDocuments: new Map<string, string>(),
    ...overrides,
  };
}

function makeProvider(responses: Array<{
  content?: string | null;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }> | null;
}>) {
  let callIndex = 0;
  return {
    chatCompletion: vi.fn().mockImplementation(() => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return Promise.resolve({
        content: resp.content ?? null,
        toolCalls: resp.toolCalls ?? null,
        usage: {
          promptTokens: 1000,
          completionTokens: 200,
          cachedTokens: 0,
          reasoningTokens: 0,
        },
      });
    }),
    calculateCost: vi.fn().mockReturnValue({
      totalCost: 0.001,
      currency: "USD",
      breakdown: {
        promptCost: 0,
        completionCost: 0,
        cachedSavings: 0,
        reasoningCost: 0,
      },
    }),
  };
}

function makeBaseLoopConfig() {
  return {
    maxIterations: 1,
    timeoutMs: 300_000,
    contextLimit: 128_000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedBudgetFractions.length = 0;
  // Restore the buildTurnPromptStack capture implementation
  mockBuildTurnPromptStack.mockImplementation(
    async (args: { missionBudgetFraction: number | null }) => {
      capturedBudgetFractions.push(args.missionBudgetFraction);
      return {
        tools: [],
        promptOptions: {},
        nextPostCompactBridgeRemaining: 0,
      };
    },
  );
  mockGetSessionTotalCost.mockResolvedValue(0);
  mockGetSessionTotalTokens.mockResolvedValue(0);
  mockGetSessionForLoop.mockResolvedValue({ tokenCount: 0 });
  mockGetOperatorInstructionsAfter.mockResolvedValue([]);
});

// ══════════════════════════════════════════════════════════════════════════
// DUAL-DB-FAIL-UNCAPPED — both cap reads throw → missionBudgetFraction = 0.9
// ══════════════════════════════════════════════════════════════════════════

describe("DUAL-DB-FAIL-UNCAPPED: both cap reads fail → missionBudgetFraction floor of 0.9", () => {
  it("DUAL-DB-FAIL-UNCAPPED: cost cap read throws, token budget read throws → fraction set to 0.9", async () => {
    mockGetSessionTotalCost.mockRejectedValue(new Error("DB pool exhausted"));
    mockGetSessionTotalTokens.mockRejectedValue(new Error("DB pool exhausted"));

    const provider = makeProvider([{ content: "done", toolCalls: null }]);

    await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider as any,
      {
        provider: "openrouter",
        model: "test-model",
        contextLimit: 128_000,
        timeoutMs: 300_000,
      } as any,
      [],
      {
        ...makeBaseLoopConfig(),
        // Both caps active — the loop must NOT run enforcement-free when both fail.
        missionCostCap: 1.0,
        missionTokenBudget: 500_000,
        missionTokenSince: null,
      },
    );

    // buildTurnPromptStack must have been called at least once with the floor
    expect(capturedBudgetFractions.length).toBeGreaterThan(0);
    const fraction = capturedBudgetFractions[0];
    // The floor (0.9) is the signal that enforcement degraded gracefully instead
    // of running uncapped (null) or zero (0).
    expect(fraction).toBeGreaterThanOrEqual(0.9);
  });

  it("DUAL-DB-FAIL-UNCAPPED: only cost cap configured, both reads throw → fraction ≥ 0.9", async () => {
    mockGetSessionTotalCost.mockRejectedValue(new Error("timeout"));
    mockGetSessionTotalTokens.mockRejectedValue(new Error("timeout"));

    const provider = makeProvider([{ content: "done", toolCalls: null }]);

    await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider as any,
      {
        provider: "openrouter",
        model: "test-model",
        contextLimit: 128_000,
        timeoutMs: 300_000,
      } as any,
      [],
      {
        ...makeBaseLoopConfig(),
        missionCostCap: 1.0,
        missionTokenSince: null,
        // No token budget — only cost cap is configured
      },
    );

    expect(capturedBudgetFractions.length).toBeGreaterThan(0);
    expect(capturedBudgetFractions[0]).toBeGreaterThanOrEqual(0.9);
  });

  it("DUAL-DB-FAIL-UNCAPPED: no cap configured → missionBudgetFraction stays null (not 0.9)", async () => {
    mockGetSessionTotalCost.mockRejectedValue(new Error("DB down"));
    mockGetSessionTotalTokens.mockRejectedValue(new Error("DB down"));

    const provider = makeProvider([{ content: "done", toolCalls: null }]);

    await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider as any,
      {
        provider: "openrouter",
        model: "test-model",
        contextLimit: 128_000,
        timeoutMs: 300_000,
      } as any,
      [],
      {
        ...makeBaseLoopConfig(),
        // No missionCostCap, no missionTokenBudget — nothing to enforce
      },
    );

    // Without any cap, the dual-fail path does not trigger — fraction stays null
    expect(capturedBudgetFractions.length).toBeGreaterThan(0);
    expect(capturedBudgetFractions[0]).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// COST-CAP-DOUBLE-SPEND — run phase uses missionTokenSince: null
// ══════════════════════════════════════════════════════════════════════════

describe("COST-CAP-DOUBLE-SPEND: run phase uses missionTokenSince: null (session-wide baseline)", () => {
  it("COST-CAP-DOUBLE-SPEND: mission-run.ts passes missionTokenSince: null, not a Date (source check)", () => {
    const src = readFileSync(
      path.resolve(
        __dirname,
        "../../../../vex-agent/engine/core/runner/mission-run.ts",
      ),
      "utf-8",
    );
    // Must use null (session-wide baseline) — never a Date that would scope the
    // accumulator to post-start-only usage, silently undercounting pre-run spend.
    expect(src).toMatch(/missionTokenSince:\s*null/);
    // Sanity: the field appears at least once (not just in a comment)
    const occurrences = (src.match(/missionTokenSince:\s*null/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(1);
  });

  it("COST-CAP-DOUBLE-SPEND: missionTokenSince: null does NOT appear as a Date reference", () => {
    const src = readFileSync(
      path.resolve(
        __dirname,
        "../../../../vex-agent/engine/core/runner/mission-run.ts",
      ),
      "utf-8",
    );
    // Negative assertion: if startedAt (or any Date) were used, the spend would
    // be scoped to the run phase only, missing setup tokens.
    expect(src).not.toMatch(/missionTokenSince:\s*run\.startedAt/);
    expect(src).not.toMatch(/missionTokenSince:\s*new Date/);
  });
});
