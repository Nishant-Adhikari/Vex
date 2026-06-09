/**
 * Unit tests for the regime worker tick (S6b). IO is fully injected
 * (`RegimeWorkerDeps`) — no network, no DB, no real OpenRouter. These prove the
 * gate ordering, the fail-closed gather/classify paths, the F4 single-source
 * confidence cap, the source labelling, and the vault env lifecycle
 * (tick before unlock = no-op; after unlock = work; after lock = no-op again —
 * the env gates are re-read EVERY tick, never cached).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  runRegimeTick,
  type RegimeWorkerDeps,
} from "@vex-agent/engine/regime/regime-worker.js";
import { REGIME_MIN_INTERVAL_HOURS, REGIME_WEB_QUERIES } from "@vex-agent/engine/regime/policy.js";
import type { RegimeSnapshot } from "@vex-agent/db/repos/regime-snapshots.js";
import type { JudgeProvider } from "@vex-agent/memory/manager/judge.js";

const NOW = new Date("2026-06-10T12:00:00Z");

const VALID_VERDICT_JSON = JSON.stringify({
  trendLabel: "bull",
  volLabel: "high",
  confidence: "high",
  rationale: "broad agreement across sources",
});

function stubProvider(content: string): () => Promise<JudgeProvider> {
  return async () => ({
    loadConfig: async () => ({ model: "stub" }),
    chatCompletionSimple: async () => ({ content }),
  });
}

function persistedSnapshot(overrides: Partial<RegimeSnapshot> = {}): RegimeSnapshot {
  return {
    id: 11,
    trendLabel: "bull",
    volLabel: "high",
    confidence: "high",
    source: "hybrid",
    rationale: "r",
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<RegimeWorkerDeps> = {}): {
  deps: RegimeWorkerDeps;
  insert: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn(async (input: Record<string, unknown>) =>
    persistedSnapshot(input as Partial<RegimeSnapshot>),
  );
  const deps: RegimeWorkerDeps = {
    searchWeb: vi.fn(async () => [{ title: "t", snippet: "s" }]),
    searchTweets: vi.fn(async () => [{ text: "tw", likes: 100, retweets: 5 }]),
    makeProvider: stubProvider(VALID_VERDICT_JSON),
    getLatestSnapshot: vi.fn(async () => null),
    insertSnapshot: insert as unknown as RegimeWorkerDeps["insertSnapshot"],
    now: () => NOW,
    ...overrides,
  };
  return { deps, insert };
}

/** Inject the full happy-path env (provider + both sources). */
function stubFullEnv(): void {
  vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
  vi.stubEnv("AGENT_MODEL", "test/model");
  vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
  vi.stubEnv("RETTIWT_API_KEY", "test-rettiwt-key");
}

beforeEach(() => {
  // Start every test with NO provider/source env (a locked vault).
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("AGENT_MODEL", "");
  vi.stubEnv("TAVILY_API_KEY", "");
  vi.stubEnv("RETTIWT_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runRegimeTick — gates", () => {
  it("skips with no_provider_config before vault unlock (empty env) without touching ANY dep", async () => {
    const { deps, insert } = makeDeps();
    const result = await runRegimeTick(deps);
    expect(result).toEqual({ kind: "skipped", reason: "no_provider_config" });
    expect(deps.getLatestSnapshot).not.toHaveBeenCalled();
    expect(deps.searchWeb).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("skips with no_sources when the provider is configured but no source key is", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    vi.stubEnv("AGENT_MODEL", "test/model");
    const { deps, insert } = makeDeps();
    const result = await runRegimeTick(deps);
    expect(result).toEqual({ kind: "skipped", reason: "no_sources" });
    expect(deps.getLatestSnapshot).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("skips with fresh_snapshot when the latest snapshot is younger than the cadence gate", async () => {
    stubFullEnv();
    const freshMs = NOW.getTime() - (REGIME_MIN_INTERVAL_HOURS - 1) * 60 * 60 * 1000;
    const { deps, insert } = makeDeps({
      getLatestSnapshot: vi.fn(async () =>
        persistedSnapshot({ createdAt: new Date(freshMs).toISOString() }),
      ),
    });
    const result = await runRegimeTick(deps);
    expect(result).toEqual({ kind: "skipped", reason: "fresh_snapshot" });
    expect(deps.searchWeb).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("proceeds when the latest snapshot is older than the cadence gate", async () => {
    stubFullEnv();
    const staleMs = NOW.getTime() - (REGIME_MIN_INTERVAL_HOURS + 1) * 60 * 60 * 1000;
    const { deps, insert } = makeDeps({
      getLatestSnapshot: vi.fn(async () =>
        persistedSnapshot({ createdAt: new Date(staleMs).toISOString() }),
      ),
    });
    const result = await runRegimeTick(deps);
    expect(result.kind).toBe("snapshot_created");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("vault lifecycle: no-op before unlock → works after unlock → no-op again after lock", async () => {
    const { deps, insert } = makeDeps();

    // Before unlock: locked vault, everything empty.
    expect(await runRegimeTick(deps)).toEqual({ kind: "skipped", reason: "no_provider_config" });

    // Unlock injects the keys (env re-read on THIS tick — nothing was cached).
    stubFullEnv();
    const unlocked = await runRegimeTick(deps);
    expect(unlocked.kind).toBe("snapshot_created");
    expect(insert).toHaveBeenCalledTimes(1);

    // Lock scrubs the env (MANAGED_SECRET_ENV_KEYS) → the gate closes again.
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("AGENT_MODEL", "");
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("RETTIWT_API_KEY", "");
    expect(await runRegimeTick(deps)).toEqual({ kind: "skipped", reason: "no_provider_config" });
    expect(insert).toHaveBeenCalledTimes(1); // no further insert
  });
});

describe("runRegimeTick — gather (fail-closed, partial success OK)", () => {
  it("runs every fixed web query and continues on full happy path with source hybrid", async () => {
    stubFullEnv();
    const { deps, insert } = makeDeps();
    const result = await runRegimeTick(deps);
    expect(deps.searchWeb).toHaveBeenCalledTimes(REGIME_WEB_QUERIES.length);
    expect(result).toEqual({ kind: "snapshot_created", snapshotId: 11, source: "hybrid" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ trendLabel: "bull", volLabel: "high", confidence: "high", source: "hybrid" }),
    );
  });

  it("continues with one source when the other fails, labels it, and caps confidence at medium (F4)", async () => {
    stubFullEnv();
    const { deps, insert } = makeDeps({
      searchTweets: vi.fn(async () => {
        throw new Error("twitter down");
      }),
    });
    const result = await runRegimeTick(deps);
    expect(result).toMatchObject({ kind: "snapshot_created", source: "tavily" });
    // The LLM said 'high'; a single corroborating source cannot sustain it.
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "tavily", confidence: "medium" }),
    );
  });

  it("never RAISES a low confidence through the single-source cap (min, not clamp-up)", async () => {
    stubFullEnv();
    const lowVerdict = JSON.stringify({
      trendLabel: "range",
      volLabel: "unknown",
      confidence: "low",
      rationale: "sparse signals",
    });
    const { deps, insert } = makeDeps({
      makeProvider: stubProvider(lowVerdict),
      searchTweets: vi.fn(async () => {
        throw new Error("twitter down");
      }),
    });
    await runRegimeTick(deps);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ confidence: "low" }));
  });

  it("treats a source with ZERO items as unused (single-source cap applies)", async () => {
    stubFullEnv();
    const { deps, insert } = makeDeps({
      searchTweets: vi.fn(async () => []),
    });
    const result = await runRegimeTick(deps);
    expect(result).toMatchObject({ kind: "snapshot_created", source: "tavily" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ confidence: "medium" }));
  });

  it("only gathers env-enabled sources: twitter-only env yields source twitter", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    vi.stubEnv("AGENT_MODEL", "test/model");
    vi.stubEnv("RETTIWT_API_KEY", "test-rettiwt-key"); // no Tavily key
    const { deps, insert } = makeDeps();
    const result = await runRegimeTick(deps);
    expect(deps.searchWeb).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "snapshot_created", source: "twitter" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ source: "twitter" }));
  });

  it("throws (NO insert) when every configured source fails — retry comes from the next tick", async () => {
    stubFullEnv();
    const { deps, insert } = makeDeps({
      searchWeb: vi.fn(async () => {
        throw new Error("tavily down");
      }),
      searchTweets: vi.fn(async () => {
        throw new Error("twitter down");
      }),
    });
    await expect(runRegimeTick(deps)).rejects.toThrow(/regime_gather_failed/);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("runRegimeTick — classify (fail-closed, no heuristic fallback)", () => {
  it("throws (NO insert) on a response with no JSON braces", async () => {
    stubFullEnv();
    const { deps, insert } = makeDeps({ makeProvider: stubProvider("no json here") });
    await expect(runRegimeTick(deps)).rejects.toThrow(/malformed_json/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws (NO insert) on schema-invalid JSON (out-of-vocab label)", async () => {
    stubFullEnv();
    const bad = JSON.stringify({ trendLabel: "moon", volLabel: "high", confidence: "high", rationale: "x" });
    const { deps, insert } = makeDeps({ makeProvider: stubProvider(bad) });
    await expect(runRegimeTick(deps)).rejects.toThrow(/schema_invalid/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws (NO insert) when the provider config cannot load", async () => {
    stubFullEnv();
    const provider: () => Promise<JudgeProvider> = async () => ({
      loadConfig: async () => null,
      chatCompletionSimple: async () => ({ content: VALID_VERDICT_JSON }),
    });
    const { deps, insert } = makeDeps({ makeProvider: provider });
    await expect(runRegimeTick(deps)).rejects.toThrow(/provider_config/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("extracts the JSON object out of surrounding prose (judge-pattern brace extraction)", async () => {
    stubFullEnv();
    const wrapped = `Sure! Here is the verdict:\n${VALID_VERDICT_JSON}\nHope that helps.`;
    const { deps } = makeDeps({ makeProvider: stubProvider(wrapped) });
    const result = await runRegimeTick(deps);
    expect(result.kind).toBe("snapshot_created");
  });
});
