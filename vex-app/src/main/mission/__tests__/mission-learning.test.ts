/**
 * Mission LEARNING pass tests — the finalize-triggered orchestration, exercised
 * with fully injected deps + an in-memory strategy store (no real inference /
 * DB). Covers:
 *   - retrospective banked at finalize (always, even with the loop off)
 *   - KILL SWITCH off → no rewrite, prior version untouched
 *   - propose-then-approve DEFAULT → accepted revision stored PENDING (not live)
 *   - full-auto → accepted revision activated
 *   - rejected decision → audit row, prior active version stays
 *   - anti-overfit no_lessons → nothing persisted
 *   - fail-soft: a thrown dep never throws out of the pass
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi } from "vitest";
import type { StrategyVersionRow } from "@vex-agent/db/repos/strategy-versions.js";
import type { RewriteDecision } from "../strategy-rewrite.js";
import type { LearningDeps } from "../mission-learning.js";
import { resolveStrategyLoopConfig } from "../strategy-config.js";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@vex-lib/openrouter-client.js", () => ({ OpenRouter: class {} }));

const { runMissionLearning } = await import("../mission-learning.js");

const EVENT = {
  missionId: "m1",
  runId: "run-1",
  sessionId: "s1",
  outcome: "completed",
  stopReason: "goal_reached",
};

/** Minimal in-memory strategy store implementing the persist seam. */
class Store {
  versions: StrategyVersionRow[] = [];
  private seq = 0;
  row(over: Partial<StrategyVersionRow>): StrategyVersionRow {
    return {
      id: `v${this.seq}`,
      versionNo: this.seq,
      content: "",
      status: "pending",
      isBaseline: false,
      active: false,
      drivingMissionRunId: null,
      drivingLessons: [],
      rejectionReason: null,
      audit: {},
      model: null,
      createdAt: new Date().toISOString(),
      activatedAt: null,
      ...over,
    };
  }
  ensureBaseline = async (content: string): Promise<StrategyVersionRow> => {
    let base = this.versions.find((v) => v.isBaseline);
    if (!base) {
      base = this.row({ id: "base", content, status: "baseline", isBaseline: true, active: true });
      this.seq++;
      this.versions.push(base);
    }
    return base;
  };
  getActive = async (): Promise<StrategyVersionRow | null> =>
    this.versions.find((v) => v.active) ?? null;
  getBaseline = async (): Promise<StrategyVersionRow | null> =>
    this.versions.find((v) => v.isBaseline) ?? null;
  getRecentAdopted = async (): Promise<string[]> =>
    this.versions.filter((v) => v.activatedAt).map((v) => v.content);
  insertProposal = async (input: {
    id: string;
    content: string;
    status: "pending" | "rejected";
    drivingMissionRunId: string | null;
    drivingLessons: string[];
    rejectionReason: string | null;
    audit: Record<string, unknown>;
    model: string | null;
  }): Promise<StrategyVersionRow> => {
    this.seq++;
    const r = this.row({
      id: input.id,
      versionNo: this.seq,
      content: input.content,
      status: input.status,
      drivingMissionRunId: input.drivingMissionRunId,
      drivingLessons: input.drivingLessons,
      rejectionReason: input.rejectionReason,
      audit: input.audit,
    });
    this.versions.push(r);
    return r;
  };
  activateVersion = async (id: string): Promise<StrategyVersionRow | null> => {
    const t = this.versions.find((v) => v.id === id);
    if (!t || t.status === "rejected") return null;
    for (const v of this.versions) v.active = false;
    t.active = true;
    if (!t.isBaseline) t.status = "active";
    t.activatedAt = new Date().toISOString();
    return t;
  };
}

function makeDeps(
  store: Store,
  decision: RewriteDecision,
  over: Partial<LearningDeps> = {},
): { deps: LearningDeps; bank: ReturnType<typeof vi.fn>; propose: ReturnType<typeof vi.fn> } {
  const bank = vi.fn(async () => undefined);
  const propose = vi.fn(async () => decision);
  const deps: LearningDeps = {
    bankRetrospective: bank,
    ensureBaseline: store.ensureBaseline,
    getActive: store.getActive,
    getBaseline: store.getBaseline,
    getRecentAdopted: store.getRecentAdopted,
    listRecentLessons: async () => [],
    insertProposal: store.insertProposal,
    activateVersion: store.activateVersion,
    propose,
    config: { ...resolveStrategyLoopConfig({}), enabled: true, autoApprove: false },
    ...over,
  };
  return { deps, bank, propose };
}

const ACCEPTED: RewriteDecision = {
  kind: "accepted",
  content: "revised tactics content that is materially new",
  judge: { safe: true, reason: "ok" },
  audit: { stage: "accepted" },
};

describe("runMissionLearning", () => {
  it("banks the retrospective even when the kill switch is OFF, and does not rewrite", async () => {
    const store = new Store();
    const { deps, bank, propose } = makeDeps(store, ACCEPTED, {
      config: { ...resolveStrategyLoopConfig({}), enabled: false, autoApprove: false },
    });
    const res = await runMissionLearning(EVENT, deps);
    expect(res).toBe("disabled");
    expect(bank).toHaveBeenCalledWith("s1", expect.any(String));
    expect(propose).not.toHaveBeenCalled();
    expect(store.versions.filter((v) => !v.isBaseline)).toHaveLength(0);
  });

  it("DEFAULT posture: an accepted revision is stored PENDING, not activated", async () => {
    const store = new Store();
    const { deps } = makeDeps(store, ACCEPTED);
    const res = await runMissionLearning(EVENT, deps);
    expect(res).toBe("pending");
    const pending = store.versions.find((v) => v.status === "pending");
    expect(pending).toBeDefined();
    // Prior active (the baseline) is still the live version — approval required.
    const active = await store.getActive();
    expect(active?.isBaseline).toBe(true);
  });

  it("full-auto: an accepted revision is activated", async () => {
    const store = new Store();
    const { deps } = makeDeps(store, ACCEPTED, {
      config: { ...resolveStrategyLoopConfig({}), enabled: true, autoApprove: true },
    });
    const res = await runMissionLearning(EVENT, deps);
    expect(res).toBe("activated");
    const active = await store.getActive();
    expect(active?.content).toBe(ACCEPTED.content);
    expect(active?.isBaseline).toBe(false);
  });

  it("a rejected revision is recorded for audit and the prior version stays live", async () => {
    const store = new Store();
    const rejected: RewriteDecision = {
      kind: "rejected",
      reasons: ["red-flag pattern(s): raise/remove capital cap"],
      content: "raise the cap to $1000",
      judge: null,
      audit: { stage: "deterministic_gate" },
    };
    const { deps } = makeDeps(store, rejected);
    const res = await runMissionLearning(EVENT, deps);
    expect(res).toBe("rejected");
    const row = store.versions.find((v) => v.status === "rejected");
    expect(row?.rejectionReason).toMatch(/capital cap/);
    expect(row?.active).toBe(false);
    const active = await store.getActive();
    expect(active?.isBaseline).toBe(true);
  });

  it("anti-overfit no_lessons persists nothing", async () => {
    const store = new Store();
    const { deps } = makeDeps(store, { kind: "no_lessons", reason: "none recurred" });
    const res = await runMissionLearning(EVENT, deps);
    expect(res).toBe("no_lessons");
    expect(store.versions.filter((v) => !v.isBaseline)).toHaveLength(0);
  });

  it("fail-soft: a thrown dep never throws out of the pass", async () => {
    const store = new Store();
    const { deps } = makeDeps(store, ACCEPTED, {
      getActive: async () => {
        throw new Error("db down");
      },
    });
    const res = await runMissionLearning(EVENT, deps);
    expect(res).toBe("rewrite_failed");
  });

  it("fail-soft: retrospective banking failure does not abort the pass", async () => {
    const store = new Store();
    const { deps } = makeDeps(store, ACCEPTED, {
      bankRetrospective: async () => {
        throw new Error("retro down");
      },
    });
    const res = await runMissionLearning(EVENT, deps);
    // banking failed but the (enabled) rewrite still proceeded to pending
    expect(res).toBe("pending");
  });
});
