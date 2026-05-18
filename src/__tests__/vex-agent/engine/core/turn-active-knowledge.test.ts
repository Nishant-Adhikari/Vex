/**
 * Drift test — guards that what tool descriptions and policy decisions claim
 * about Active Knowledge and the Knowledge Layer Rules actually appears in the
 * final system prompt sent to the inference provider.
 *
 * This test exists because the repo previously had drift between description
 * (memory_manage said "Memory is in every prompt") and the real prompt builder
 * (which never injected memory). We assert against the captured providerMessages
 * to make sure that drift cannot recur for the knowledge layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAddMessage = vi.fn();
const mockLogUsage = vi.fn();
const mockUpdateTokenCount = vi.fn();
const mockListActive = vi.fn().mockResolvedValue([]);
const mockListKinds = vi.fn().mockResolvedValue([]);

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: vi.fn(),
  getLiveMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("@vex-agent/db/repos/usage.js", () => ({
  logUsage: (...a: unknown[]) => mockLogUsage(...a),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  updateTokenCount: (...a: unknown[]) => mockUpdateTokenCount(...a),
  getSession: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/knowledge.js", () => ({
  listActiveForHotContext: (...a: unknown[]) => mockListActive(...a),
  listKnownKinds: (...a: unknown[]) => mockListKinds(...a),
  // PR2 cutover: executeTurn pre-fetches an active count for the
  // knowledge-state banner alongside the curated Active Knowledge block.
  countActiveHotContextEntries: vi.fn().mockResolvedValue(0),
}));

// PR2 cutover: executeTurn pre-fetches session-memory stats for the
// memory-state banner. Default = empty so existing assertions stay focused on
// the Active Knowledge block.
vi.mock("@vex-agent/db/repos/session-memories/index.js", () => ({
  getSessionMemoryStats: vi.fn().mockResolvedValue({
    activeCount: 0,
    compactCount: 0,
    recentThemes: [],
    unresolvedOutstandingCount: 0,
  }),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vex-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

const { executeTurn } = await import("@vex-agent/engine/core/turn.js");

function makeContext() {
  return {
    sessionId: "session-1",
    sessionKind: "agent" as const,
    sessionPermission: "restricted" as const,
    missionId: null,
    missionRunId: null,
    isSubagent: false,
    loadedDocuments: new Map<string, string>(),
    memoryScopeKey: "session-1",
  };
}

function makeProvider() {
  return {
    chatCompletion: vi.fn().mockResolvedValue({
      content: "ok",
      toolCalls: null,
      usage: { promptTokens: 100, completionTokens: 10, cachedTokens: 0, reasoningTokens: 0 },
    }),
    calculateCost: vi.fn().mockReturnValue({ totalCost: 0.001, currency: "USD" }),
  };
}

function makeConfig() {
  return {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    contextLimit: 128000,
    maxOutputTokens: 4096,
    inputPricePerM: 3,
    outputPricePerM: 15,
  };
}

function getSystemPrompt(provider: ReturnType<typeof makeProvider>): string {
  const [providerMessages] = provider.chatCompletion.mock.calls[0]!;
  // First message is always the system prompt
  return providerMessages[0].content as string;
}

describe("turn — Active Knowledge drift guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListActive.mockResolvedValue([]);
    mockListKinds.mockResolvedValue([]);
  });

  // ── Active Knowledge block injection ─────────────────────────

  it("system prompt does NOT include '# Active Knowledge' when both repo lists are empty", async () => {
    const provider = makeProvider();
    await executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []);
    const systemPrompt = getSystemPrompt(provider);
    expect(systemPrompt).not.toContain("# Active Knowledge");
  });

  it("system prompt includes '# Active Knowledge' when repo returns hot-context entries", async () => {
    mockListActive.mockResolvedValue([
      {
        id: 42,
        kind: "pumpfun_entry_pattern",
        title: "low-holder pump entry",
        summary: "Tokens with under 50 holders show short-term continuation",
        pinned: false,
        validUntil: "2026-04-13T12:00:00Z",
        updatedAt: "2026-04-06T12:00:00Z",
      },
    ]);
    const provider = makeProvider();
    await executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []);
    const systemPrompt = getSystemPrompt(provider);
    expect(systemPrompt).toContain("# Active Knowledge");
    expect(systemPrompt).toContain("pumpfun_entry_pattern");
    expect(systemPrompt).toContain("low-holder pump entry");
  });

  it("system prompt includes 'Known kinds' section when repo returns kind taxonomy", async () => {
    mockListKinds.mockResolvedValue([
      { kind: "pumpfun_entry_pattern", count: 12 },
      { kind: "risk_rule", count: 3 },
    ]);
    const provider = makeProvider();
    await executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []);
    const systemPrompt = getSystemPrompt(provider);
    expect(systemPrompt).toContain("Known kinds");
    expect(systemPrompt).toContain("pumpfun_entry_pattern (12)");
    expect(systemPrompt).toContain("risk_rule (3)");
  });

  // ── Knowledge Layer Rules drift guards ──────────────────────

  it("system prompt always includes the Memory Layers section (PR3 reorg — was Knowledge Layer Rules)", async () => {
    // The PR3-clarity reorg restructured tool-usage.ts around decisions
    // rather than domains; the "Knowledge Layer Rules" heading became
    // "Memory Layers", folding the substrate boundaries (live state /
    // memory / knowledge / documents) into one cross-cutting section.
    const provider = makeProvider();
    await executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []);
    const systemPrompt = getSystemPrompt(provider);
    expect(systemPrompt).toContain("## 5. Memory Layers");
  });

  it("Memory Layers section explicitly says knowledge is ENGLISH-ONLY (decision #23)", async () => {
    const provider = makeProvider();
    await executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []);
    const systemPrompt = getSystemPrompt(provider);
    const memIdx = systemPrompt.indexOf("Memory Layers");
    expect(memIdx).toBeGreaterThan(0);
    const memSection = systemPrompt.slice(memIdx);
    // PR3 reorg copy: "ENGLISH-ONLY for embeddings"
    expect(memSection).toMatch(/ENGLISH-ONLY|English-only|english/i);
  });

  it("reuse-existing-kinds rule survived the reorg (decision #7 — now on knowledge_write ToolDef.description)", async () => {
    // Codex PR3 plan-review (5b–5d): heavy knowledge-lifecycle prose
    // moves OUT of tool-usage.ts and INTO the relevant ToolDef
    // descriptions so the model sees the rule at tool-choice time, not
    // just in the system prompt. "Reuse a kind from Known kinds before
    // creating a new one" now lives on knowledge_write's description.
    const provider = makeProvider();
    await executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []);
    // Use a token-budget-equivalent assertion: any of the three knowledge
    // surfaces (system prompt OR the knowledge_write tool description in
    // the openAI tools array) must enforce reuse. Reading the registry
    // directly is the cleanest path since the ToolDef payload is what
    // the model actually sees.
    const { getToolDef } = await import(
      "../../../../vex-agent/tools/registry.js"
    );
    const knowledgeWriteDef = getToolDef("knowledge_write");
    expect(knowledgeWriteDef?.description.toLowerCase()).toContain("reuse");
    expect(knowledgeWriteDef?.description).toMatch(/Known kinds|known kinds/i);
  });

  // ── Pre-fetch parameters ─────────────────────────────────────

  it("calls listActiveForHotContext with limit 12 and listKnownKinds with limit 30", async () => {
    const provider = makeProvider();
    await executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []);
    expect(mockListActive).toHaveBeenCalledWith({ limit: 12 });
    expect(mockListKinds).toHaveBeenCalledWith({ limit: 30 });
  });

  it("does not crash the turn when repo throws", async () => {
    mockListActive.mockRejectedValueOnce(new Error("DB unavailable"));
    const provider = makeProvider();
    await expect(
      executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []),
    ).resolves.not.toThrow();
    // Provider was still called — turn proceeds with empty Active Knowledge.
    expect(provider.chatCompletion).toHaveBeenCalled();
  });
});
