/**
 * Zustand UI-only store per skill §5.
 *
 * Layer rules:
 *  - Domain/IPC data lives in TanStack Query, NEVER here.
 *  - Persist whitelist is intentionally narrow (sidebarOpen). currentView
 *    is recomputed on launch; logBuffer is in-memory only.
 *  - logBuffer is bounded to MAX_RENDER_LOGS to honor skill §11 (no
 *    unbounded buffers).
 *
 * Theme is intentionally NOT in M1 — applying it requires DOM root sync
 * + prefers-color-scheme listener + Settings UI to mutate it. Phase 2
 * adds it properly. Storing dead state today only invites drift.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const MAX_RENDER_LOGS = 500;

export type View =
  | "splash"
  | "systemCheck"
  | "dockerBootstrap"
  | "composeBootstrap"
  | "migrations"
  | "wizard"
  | "unlock"
  | "appShell";

export type WizardEntryMode = "setup" | "reconfigure";
export type UnlockReturnView = "wizard" | "appShell";
export type SessionModeFilter = "all" | "agent" | "mission";

export interface UiLogEntry {
  readonly id: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
  readonly ts: number;
}

interface UiState {
  readonly sidebarOpen: boolean;
  readonly currentView: View;
  readonly wizardEntryMode: WizardEntryMode;
  readonly unlockReturnView: UnlockReturnView;
  readonly logBuffer: ReadonlyArray<UiLogEntry>;
  readonly sessionModeFilter: SessionModeFilter;
  /**
   * Currently-selected session in the app shell sidebar. `null` means
   * the welcome state is shown (no session opened yet). NOT persisted —
   * session selection is launch-ephemeral; domain data still lives in
   * TanStack Query.
   */
  readonly activeSessionId: string | null;
  readonly setSidebarOpen: (value: boolean) => void;
  readonly setSessionModeFilter: (value: SessionModeFilter) => void;
  readonly setCurrentView: (value: View) => void;
  readonly openWizard: (mode: WizardEntryMode) => void;
  readonly openUnlock: (returnView: UnlockReturnView) => void;
  readonly setActiveSessionId: (value: string | null) => void;
  readonly appendLog: (entry: UiLogEntry) => void;
  readonly clearLogs: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      currentView: "splash",
      wizardEntryMode: "setup",
      unlockReturnView: "appShell",
      logBuffer: [],
      sessionModeFilter: "all",
      activeSessionId: null,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSessionModeFilter: (sessionModeFilter) => set({ sessionModeFilter }),
      setCurrentView: (currentView) => set({ currentView }),
      openWizard: (wizardEntryMode) =>
        set({ currentView: "wizard", wizardEntryMode }),
      openUnlock: (unlockReturnView) =>
        set({ currentView: "unlock", unlockReturnView }),
      setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
      appendLog: (entry) =>
        set((state) => ({
          logBuffer: [...state.logBuffer, entry].slice(-MAX_RENDER_LOGS),
        })),
      clearLogs: () => set({ logBuffer: [] }),
    }),
    {
      name: "vex-ui",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);
