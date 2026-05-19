/**
 * Unit tests for the renderer UI store. Verifies:
 *   1. Default state matches skill §5 expectations.
 *   2. Action mutations behave atomically.
 *   3. logBuffer is hard-bounded to MAX_RENDER_LOGS (skill §11 — no
 *      unbounded buffers in renderer state).
 *   4. localStorage persist whitelist contains ONLY sidebarOpen — never
 *      logBuffer (would leak), never currentView (transient).
 *   5. clearLogs zeros the buffer.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_RENDER_LOGS, useUiStore } from "../uiStore.js";

const STORAGE_KEY = "vex-ui";

function resetStoreToDefaults(): void {
  useUiStore.setState({
    sidebarOpen: true,
    currentView: "splash",
    wizardEntryMode: "setup",
    unlockReturnView: "appShell",
    logBuffer: [],
    sessionModeFilter: "all",
    activeSessionId: null,
    appShellView: "session",
  });
}

describe("uiStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetStoreToDefaults();
  });

  afterEach(() => {
    window.localStorage.clear();
    resetStoreToDefaults();
  });

  it("starts with the expected defaults", () => {
    const state = useUiStore.getState();
    expect(state.sidebarOpen).toBe(true);
    expect(state.currentView).toBe("splash");
    expect(state.wizardEntryMode).toBe("setup");
    expect(state.unlockReturnView).toBe("appShell");
    expect(state.sessionModeFilter).toBe("all");
    expect(state.activeSessionId).toBeNull();
    expect(state.appShellView).toBe("session");
    expect(state.logBuffer).toEqual([]);
  });

  it("setAppShellView mutates and reflects new value", () => {
    useUiStore.getState().setAppShellView("sessionsLibrary");
    expect(useUiStore.getState().appShellView).toBe("sessionsLibrary");
  });

  it("setSidebarOpen mutates and reflects new value", () => {
    useUiStore.getState().setSidebarOpen(false);
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });

  it("setSessionModeFilter mutates and reflects new value", () => {
    useUiStore.getState().setSessionModeFilter("mission");
    expect(useUiStore.getState().sessionModeFilter).toBe("mission");
  });

  it("openWizard sets the wizard view and entry mode together", () => {
    useUiStore.getState().openWizard("reconfigure");
    expect(useUiStore.getState().currentView).toBe("wizard");
    expect(useUiStore.getState().wizardEntryMode).toBe("reconfigure");
  });

  it("openUnlock sets the unlock view and return target together", () => {
    useUiStore.getState().openUnlock("wizard");
    expect(useUiStore.getState().currentView).toBe("unlock");
    expect(useUiStore.getState().unlockReturnView).toBe("wizard");
  });

  it("appendLog hard-caps logBuffer at MAX_RENDER_LOGS", () => {
    const overflow = MAX_RENDER_LOGS + 100;
    for (let i = 0; i < overflow; i += 1) {
      useUiStore.getState().appendLog({
        id: `log-${i}`,
        level: "info",
        message: `entry ${i}`,
        ts: i,
      });
    }
    const buffer = useUiStore.getState().logBuffer;
    expect(buffer).toHaveLength(MAX_RENDER_LOGS);
    expect(buffer[0]?.id).toBe(`log-${overflow - MAX_RENDER_LOGS}`);
    expect(buffer[buffer.length - 1]?.id).toBe(`log-${overflow - 1}`);
  });

  it("clearLogs empties the buffer", () => {
    useUiStore.getState().appendLog({
      id: "x",
      level: "warn",
      message: "noise",
      ts: 1,
    });
    expect(useUiStore.getState().logBuffer).toHaveLength(1);
    useUiStore.getState().clearLogs();
    expect(useUiStore.getState().logBuffer).toEqual([]);
  });

  it("persists ONLY sidebarOpen to localStorage (never logBuffer / transient navigation state)", () => {
    useUiStore.getState().setSidebarOpen(false);
    useUiStore.getState().setCurrentView("systemCheck");
    useUiStore.getState().setSessionModeFilter("mission");
    useUiStore.getState().setActiveSessionId("64dd70f7-0ff6-462e-90c0-e528681d7e5d");
    useUiStore.getState().setAppShellView("sessionsLibrary");
    useUiStore.getState().openWizard("reconfigure");
    useUiStore.getState().openUnlock("wizard");
    useUiStore.getState().appendLog({
      id: "secret-log",
      level: "error",
      message: "private payload",
      ts: 99,
    });

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);

    expect(parsed.state).toEqual({ sidebarOpen: false });
    expect(parsed.state.logBuffer).toBeUndefined();
    expect(parsed.state.currentView).toBeUndefined();
    expect(parsed.state.wizardEntryMode).toBeUndefined();
    expect(parsed.state.unlockReturnView).toBeUndefined();
    expect(parsed.state.sessionModeFilter).toBeUndefined();
    expect(parsed.state.activeSessionId).toBeUndefined();
    expect(parsed.state.appShellView).toBeUndefined();
    // Belt-and-braces: the message text must not appear anywhere serialized.
    expect(raw).not.toContain("private payload");
    expect(raw).not.toContain("secret-log");
  });
});
