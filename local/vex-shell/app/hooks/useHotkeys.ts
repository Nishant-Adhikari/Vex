/**
 * Global hotkeys for the Ink shell.
 *   - Ctrl+D → toggle Sidebar
 *   - Ctrl+L → clear visible message buffer (does not touch DB)
 *   - Ctrl+S → toggle SettingsPanel
 *   - Ctrl+O → toggle Tool-calls history panel
 *   - Tab / Shift+Tab → cycle settings tabs (only when settings panel open
 *     AND tool-calls panel closed; ToolCallsPanel owns Tab when open)
 *
 * All global shortcuts are silenced while the SettingsPanel has an inline
 * edit form active — typed characters there go to the edit value, not to
 * us. SettingsPanel owns input fully in that mode.
 */

import { useInput } from "ink";
import type { Store } from "../state/store.js";
import { SETTINGS_TAB_ORDER } from "../state/store.js";
import { hasSubagentAttention } from "../state/subagents.js";

export function useHotkeys(store: Store): void {
  useInput((input, key) => {
    if (store.getState().settingsEdit !== null) {
      return; // SettingsPanel owns input while editing
    }

    if (key.ctrl && input === "d") {
      store.setState((s) => ({ sidebarOpen: !s.sidebarOpen }));
    }
    if (key.ctrl && input === "l") {
      store.setState({ messages: [] });
    }
    if (key.ctrl && input === "s") {
      store.setState((s) => ({
        settingsTab: s.settingsTab === null
          ? selectSettingsStartTab(hasSubagentAttention(s.subagentRows))
          : null,
        settingsCursor: 0,
        // Close tool-calls panel if opening settings (single panel at a time).
        toolCallsOpen: s.settingsTab === null ? false : s.toolCallsOpen,
      }));
    }
    if (key.ctrl && input === "o") {
      store.setState((s) => {
        const opening = !s.toolCallsOpen;
        return {
          toolCallsOpen: opening,
          // Park cursor on the freshest entry on open.
          toolCallsCursor: opening
            ? Math.max(0, s.recentToolCalls.length - 1)
            : s.toolCallsCursor,
          // Close settings if opening tool-calls (single panel at a time).
          settingsTab: opening ? null : s.settingsTab,
        };
      });
    }
    if (key.tab) {
      store.setState((s) => {
        // ToolCallsPanel owns Tab when it's open — see its own useInput.
        if (s.toolCallsOpen) return {};
        if (s.settingsTab === null) return {};
        const idx = SETTINGS_TAB_ORDER.indexOf(s.settingsTab);
        const next = key.shift
          ? (idx - 1 + SETTINGS_TAB_ORDER.length) % SETTINGS_TAB_ORDER.length
          : (idx + 1) % SETTINGS_TAB_ORDER.length;
        return { settingsTab: SETTINGS_TAB_ORDER[next], settingsCursor: 0 };
      });
    }
  });
}

export function selectSettingsStartTab(hasSubagentAlert: boolean): (typeof SETTINGS_TAB_ORDER)[number] {
  return hasSubagentAlert ? "subagents" : SETTINGS_TAB_ORDER[0];
}
