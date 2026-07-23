/**
 * keep-awake-worker tests (fork feature).
 *
 * Pins the mission-gate behavior of the powerSaveBlocker reconcile:
 *   - no mission active → the blocker never engages, whatever the setting;
 *   - mission active AND the gate on → engaged;
 *   - toggling the gate off during an active run releases the blocker;
 *   - toggling it back on during an active run re-engages it;
 *   - the manual toggle stays independent of the mission gate.
 *
 * `electron`'s `powerSaveBlocker`, the engine's `activeMissionRunCount`, the
 * preferences store, and the logger are all mocked so no Electron/DB runtime is
 * needed. Module state is per-test (resetModules) so `manualOn` / `missionGate`
 * never bleed across cases.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const psb = vi.hoisted(() => ({ started: new Set<number>(), nextId: 1 }));
const mission = vi.hoisted(() => ({ count: 0 }));

vi.mock("electron", () => ({
  powerSaveBlocker: {
    start: vi.fn((_type: string) => {
      const id = psb.nextId++;
      psb.started.add(id);
      return id;
    }),
    stop: vi.fn((id: number) => {
      psb.started.delete(id);
    }),
    isStarted: vi.fn((id: number) => psb.started.has(id)),
  },
}));

vi.mock("@vex-agent/engine/core/runner/abort.js", () => ({
  activeMissionRunCount: vi.fn(() => mission.count),
}));

vi.mock("../../preferences/store.js", () => ({
  preferencesStore: {
    load: vi.fn(async () => ({ ui: { keepAwakeDuringMission: true } })),
    subscribe: vi.fn(() => () => undefined),
  },
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Worker = typeof import("../keep-awake-worker.js");

async function loadWorker(): Promise<Worker> {
  vi.resetModules();
  return import("../keep-awake-worker.js");
}

beforeEach(() => {
  psb.started.clear();
  psb.nextId = 1;
  mission.count = 0;
});

describe("keep-awake-worker mission gate", () => {
  it("never engages the blocker when no mission is active, regardless of the setting", async () => {
    const w = await loadWorker();
    mission.count = 0;

    w.setKeepAwakeMissionGate(true);
    expect(w.getKeepAwakeState().active).toBe(false);

    w.setKeepAwakeMissionGate(false);
    expect(w.getKeepAwakeState().active).toBe(false);
  });

  it("engages the blocker only when a mission is active AND the gate is on", async () => {
    const w = await loadWorker();
    mission.count = 1;

    w.setKeepAwakeMissionGate(true);
    expect(w.getKeepAwakeState().active).toBe(true);
  });

  it("releases the blocker when the gate is toggled off during an active run", async () => {
    const w = await loadWorker();
    mission.count = 1;

    w.setKeepAwakeMissionGate(true);
    expect(w.getKeepAwakeState().active).toBe(true);

    w.setKeepAwakeMissionGate(false);
    expect(w.getKeepAwakeState().active).toBe(false);
  });

  it("engages the blocker when the gate is toggled on during an active run", async () => {
    const w = await loadWorker();
    mission.count = 1;

    w.setKeepAwakeMissionGate(false);
    expect(w.getKeepAwakeState().active).toBe(false);

    w.setKeepAwakeMissionGate(true);
    expect(w.getKeepAwakeState().active).toBe(true);
  });

  it("keeps the manual toggle independent of the mission gate", async () => {
    const w = await loadWorker();
    mission.count = 0;

    // Manual holds the Mac awake even with the mission gate off and no run.
    w.setKeepAwakeMissionGate(false);
    w.setKeepAwakeManual(true);
    expect(w.getKeepAwakeState().active).toBe(true);

    w.setKeepAwakeManual(false);
    expect(w.getKeepAwakeState().active).toBe(false);
  });
});
