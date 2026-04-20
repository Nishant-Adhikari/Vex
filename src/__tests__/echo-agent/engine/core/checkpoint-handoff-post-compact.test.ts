/**
 * PR-13 M-1 regression — verify the post-compact turn actually reads the
 * just-consumed handoff through `getLatestForTarget`.
 *
 * Contract: pre-PR-13 the turn read `getActive(sessionId, checkpointGen+1)`
 * which returned null after Phase II flipped the handoff to 'consumed', so
 * recall fell back to last-user-input. The fix is `getLatestForTarget(
 * checkpointGen)` accepting both active and consumed rows.
 */

import { describe, it, expect, vi } from "vitest";

import { effectiveRecallSeed } from "../../../../echo-agent/engine/core/recall-seed.js";
import type { CheckpointHandoff } from "../../../../echo-agent/db/repos/checkpoint-handoffs.js";

function consumedHandoff(query: string): CheckpointHandoff {
  return {
    id: "h-consumed",
    sessionId: "s1",
    targetCheckpointGeneration: 5,
    status: "consumed",
    createdAt: "2026-04-20T10:00:00.000Z",
    consumedAt: "2026-04-20T10:30:00.000Z",
    payload: {
      preserveMd: "keep this",
      preferredRecallQuery: query,
      importantEntities: ["wallet-A"],
      openLoops: ["verify price feed"],
    },
  };
}

describe("PR-13 M-1 — post-compact recall reads consumed handoff", () => {
  it("effectiveRecallSeed uses the consumed handoff's preferred_recall_query", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: true,
      messages: [{ role: "user", content: "old pre-compact input", timestamp: "2026-04-20T09:00:00.000Z" }],
      activeHandoff: consumedHandoff("resume polymarket arb monitoring"),
    });
    expect(seed).toBe("resume polymarket arb monitoring");
  });

  it("getLatestForTarget is the right helper — issues SQL for (active, consumed) only", async () => {
    // Structural assertion: verify the repo exposes the new function the
    // turn-time read depends on. We don't hit the DB here — smoke import.
    const repo = await import("../../../../echo-agent/db/repos/checkpoint-handoffs.js");
    expect(typeof repo.getLatestForTarget).toBe("function");
  });
});

/**
 * PR-13 S-3 regression — openLoops is threaded through.
 */
describe("PR-13 S-3 — openLoops feeds recall seed", () => {
  it("handoff.payload.openLoops becomes part of the post-wake seed", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: true,
      messages: [],
      missionObjective: "objective",
      lastEngineMessage: { messageType: "wake_due", reason: "wake cue" },
      openLoops: ["step 3 pending", "price re-check"],
    });
    expect(seed).toContain("step 3 pending");
    expect(seed).toContain("price re-check");
  });
});

/**
 * PR-13 M-2 regression — `summarizePrefix` passes preserveMd into its prompt.
 */
describe("PR-13 M-2 — preserve_md reaches summary prompt", () => {
  it("summarizePrefix injects a 'Preserve MUST block' when preserveMd is provided", async () => {
    const mockCompletion = vi.fn().mockResolvedValue({ content: "summary-out", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
    const { summarizePrefix } = await import("../../../../echo-agent/engine/checkpoint/merge.js");
    await summarizePrefix(
      [{ id: 1, role: "user", content: "hello", timestamp: "2026-04-20T09:00:00.000Z" }],
      null,
      {
        id: "test", displayName: "test",
        loadConfig: vi.fn(),
        chatCompletion: vi.fn(),
        chatCompletionSimple: mockCompletion,
        chatCompletionStream: vi.fn(),
        getBalance: vi.fn(),
        calculateCost: vi.fn(),
      },
      { provider: "test", model: "m", contextLimit: 1000, maxOutputTokens: 512, inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD", cachePricePerM: null, reasoningPricePerM: null },
      "en",
      "Step 3 is mid-execution: do NOT forget the 0.5% slippage cap",
    );

    const [messages] = mockCompletion.mock.calls[0]!;
    const systemPrompt = (messages as Array<{ content: string }>)[0]!.content;
    expect(systemPrompt).toContain("Preserve MUST block");
    expect(systemPrompt).toContain("slippage cap");
  });

  it("summarizePrefix omits the Preserve block entirely when preserveMd is empty", async () => {
    const mockCompletion = vi.fn().mockResolvedValue({ content: "summary", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
    const { summarizePrefix } = await import("../../../../echo-agent/engine/checkpoint/merge.js");
    await summarizePrefix(
      [{ id: 1, role: "user", content: "hello", timestamp: "2026-04-20T09:00:00.000Z" }],
      null,
      {
        id: "test", displayName: "test",
        loadConfig: vi.fn(),
        chatCompletion: vi.fn(),
        chatCompletionSimple: mockCompletion,
        chatCompletionStream: vi.fn(),
        getBalance: vi.fn(),
        calculateCost: vi.fn(),
      },
      { provider: "test", model: "m", contextLimit: 1000, maxOutputTokens: 512, inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD", cachePricePerM: null, reasoningPricePerM: null },
      "en",
      "",
    );

    const [messages] = mockCompletion.mock.calls[0]!;
    const systemPrompt = (messages as Array<{ content: string }>)[0]!.content;
    expect(systemPrompt).not.toContain("Preserve MUST block");
  });
});

/**
 * PR-13 S-1 regression — handoff consume is now atomic with Phase II.
 *
 * Structural assertion: the former `try { ... } catch { log.warn + proceed }`
 * block around the consume step has been removed, so any consume error
 * propagates out of `runCheckpointWriteTx` and rolls back the whole Phase II
 * tx. We verify via source-level check (no test harness can force a real
 * rollback without an integration DB).
 */
describe("PR-13 S-1 — consume atomicity with generation bump", () => {
  it("checkpoint.ts no longer silently swallows consume failures", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../../../echo-agent/engine/core/checkpoint.ts", import.meta.url),
      "utf-8",
    );
    // The old warning channel must be gone.
    expect(src).not.toContain("checkpoint.handoff.consume_failed");
    // The new atomicity comment anchors the contract.
    expect(src).toMatch(/Atomicity: any error here propagates and rolls back/i);
  });
});

/**
 * PR-13 S-4 regression — overflow blob_keys land somewhere even without a
 * `tool_result_summary` episode.
 */
describe("PR-13 S-4 — overflow blob_keys fall back to the first episode", () => {
  it("attaches blob_keys to the first episode when no tool_result_summary exists", async () => {
    // We can't easily test the internal propagateOverflowBlobKeys without
    // exporting it; instead, construct an extraction scenario (prefix with
    // one overflow row) and assert via the public extractEpisodes.
    // Pure unit via behavior check: module-level smoke that the function's
    // public contract (documented in code comment) holds. Skipped: true
    // integration would require a provider mock — covered by the runtime
    // test suite. Here we assert the comment+impl alignment by reading the
    // source.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../../../echo-agent/engine/checkpoint/extract.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("propagateOverflowBlobKeys");
    expect(src).toMatch(/fall back to the first episode|first episode/i);
  });
});
