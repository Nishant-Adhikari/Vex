/**
 * Shell state — single source of truth for the Ink app.
 *
 * Minimal reducer-based store (no external dep). Each component subscribes to
 * the slice it cares about via `useStore`. Keep the state shape flat — it is
 * rendered every turn, so avoid deep nesting that forces re-renders everywhere.
 *
 * Lifecycle:
 *   - Wizard (pre-app) populates `provider`, `mode`, `wakeEnabled`.
 *   - `useSession` polls session/mission/approvals and pushes into `session`.
 *   - Chat turns write `pendingTurn` (startedAt + optional toolCalls) and
 *     append to `messages`. 2D adds tool-call stream via `useTurnState`.
 */

import { useCallback, useRef, useSyncExternalStore } from "react";
import type { ProviderSummary } from "../../platform/render.js";
import type { WizardMode, WizardPermission } from "../../wizard/mode-step.js";
import { RECENT_TOOL_CALLS_LIMIT } from "./types.js";
import type {
  ChatMessageLine,
  InitialPromptIntent,
  PendingTurn,
  ShellViewState,
  ToolCallEntry,
} from "./types.js";

export { RECENT_TOOL_CALLS_LIMIT, SETTINGS_TAB_ORDER } from "./types.js";
export type {
  ApprovalItem,
  ChatMessageLine,
  InitialPromptIntent,
  KnowledgeHit,
  MessageRole,
  PendingTurn,
  RecentSession,
  SettingsEditMode,
  SettingsFieldKind,
  SettingsTabId,
  ShellViewState,
  SubagentRow,
  ToolCallEntry,
} from "./types.js";

export function createInitialState(init: {
  provider: ProviderSummary;
  mode: WizardMode;
  permission?: WizardPermission;
  initialPromptIntent?: InitialPromptIntent | null;
}): ShellViewState {
  return {
    provider: init.provider,
    mode: init.mode,
    permission: init.permission ?? "restricted",
    session: null,
    messages: [],
    approvals: [],
    pendingTurn: null,
    lastError: null,
    sidebarOpen: false,
    latencyMs: [],
    initialPromptIntent: init.initialPromptIntent ?? null,
    settingsTab: null,
    settingsCursor: 0,
    settingsEdit: null,
    settingsToast: null,
    recentSessions: [],
    knowledgeResults: [],
    subagentRows: [],
    toolCallsOpen: false,
    toolCallsCursor: 0,
    recentToolCalls: [],
    reporter: null,
  };
}

// ── Tool call history helpers ────────────────────────────────────

/** Append a pending tool call entry, FIFO-trimmed to the ring-buffer limit. */
export function appendToolCall(
  state: ShellViewState,
  entry: ToolCallEntry,
): Partial<ShellViewState> {
  const next = [...state.recentToolCalls, entry];
  const trimmed = next.length > RECENT_TOOL_CALLS_LIMIT
    ? next.slice(-RECENT_TOOL_CALLS_LIMIT)
    : next;
  return {
    recentToolCalls: trimmed,
    // Keep cursor on the freshest entry while the panel is closed; if it's
    // open and the user is browsing older calls, leave the cursor alone.
    toolCallsCursor: state.toolCallsOpen
      ? Math.min(state.toolCallsCursor, Math.max(0, trimmed.length - 1))
      : Math.max(0, trimmed.length - 1),
  };
}

/** Mutate the most recent matching pending entry with its result. */
export function completeToolCall(
  state: ShellViewState,
  toolCallId: string,
  result: string,
  status: "done" | "failed",
  endedAt: string,
): Partial<ShellViewState> {
  const idx = [...state.recentToolCalls]
    .map((entry, i) => ({ entry, i }))
    .reverse()
    .find(({ entry }) => entry.toolCallId === toolCallId && entry.status === "pending")?.i;
  if (idx === undefined) return {};
  const next = state.recentToolCalls.slice();
  next[idx] = { ...next[idx]!, result, status, endedAt };
  return { recentToolCalls: next };
}

// ── Store plumbing ───────────────────────────────────────────────

type Listener = () => void;

export interface Store {
  getState: () => ShellViewState;
  setState: (patch: Partial<ShellViewState> | ((s: ShellViewState) => Partial<ShellViewState>)) => void;
  subscribe: (listener: Listener) => () => void;
}

export function createStore(initial: ShellViewState): Store {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState: (patch) => {
      const delta = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...delta };
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ── React binding ────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function shallowEqualSnapshot<T>(prev: T, next: T): boolean {
  if (Object.is(prev, next)) return true;

  if (Array.isArray(prev) || Array.isArray(next)) {
    if (!Array.isArray(prev) || !Array.isArray(next)) return false;
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i += 1) {
      if (!Object.is(prev[i], next[i])) return false;
    }
    return true;
  }

  if (!isPlainObject(prev) || !isPlainObject(next)) return false;

  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;

  for (const key of prevKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) return false;
    if (!Object.is(prev[key], next[key])) return false;
  }
  return true;
}

export function useStore<T>(store: Store, selector: (s: ShellViewState) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const snapshotRef = useRef<{
    initialized: boolean;
    state: ShellViewState | null;
    selector: ((s: ShellViewState) => T) | null;
    value: T | undefined;
  }>({
    initialized: false,
    state: null,
    selector: null,
    value: undefined,
  });

  const subscribe = useCallback(
    (listener: Listener) => store.subscribe(listener),
    [store],
  );

  const getSnapshot = useCallback((): T => {
    const state = store.getState();
    const selector = selectorRef.current;
    const cached = snapshotRef.current;

    if (cached.initialized && cached.state === state && cached.selector === selector) {
      return cached.value as T;
    }

    const value = selector(state);
    if (cached.initialized && shallowEqualSnapshot(cached.value as T, value)) {
      cached.state = state;
      cached.selector = selector;
      return cached.value as T;
    }

    snapshotRef.current = {
      initialized: true,
      state,
      selector,
      value,
    };
    return value;
  }, [store]);

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
}

// ── Derived helpers ──────────────────────────────────────────────

export const LATENCY_BUFFER_SIZE = 5;

export function pushLatency(state: ShellViewState, ms: number): Partial<ShellViewState> {
  const next = [...state.latencyMs, ms];
  return {
    latencyMs: next.length > LATENCY_BUFFER_SIZE ? next.slice(-LATENCY_BUFFER_SIZE) : next,
  };
}

export function appendMessage(
  state: ShellViewState,
  line: ChatMessageLine,
): Partial<ShellViewState> {
  return { messages: [...state.messages, line] };
}
