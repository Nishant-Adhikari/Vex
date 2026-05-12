/**
 * In-session settings panel — Ctrl+S to toggle, Tab / Shift+Tab to cycle.
 *
 * This component owns the panel shell and input routing only. Settings data,
 * edit logic, and individual tab bodies live under `components/settings/`.
 */

import React, { useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { ShellViewState, Store } from "../state/store.js";
import { useStore } from "../state/store.js";
import { EditOverlay, TabNav } from "./settings/chrome.js";
import { handleEditInput, hydrateTabData, setToast } from "./settings/logic.js";
import { handleTabInput, TabContent } from "./settings/registry.js";

interface SettingsPanelProps {
  store: Store;
}

export function SettingsPanel({ store }: SettingsPanelProps): React.JSX.Element | null {
  const open = useStore(store, (s) => s.settingsTab !== null);
  const tab = useStore(store, (s) => s.settingsTab);
  const edit = useStore(store, (s) => s.settingsEdit);
  const toast = useStore(store, (s) => s.settingsToast);

  useEffect(() => {
    if (!tab) return;
    void hydrateTabData(store, tab);
  }, [tab, store]);

  useInput(
    (input, key) => {
      if (!tab) return;
      if (edit) {
        handleEditInput(store, edit, input, key);
        return;
      }
      handleTabInput(store, tab, input, key);
    },
    { isActive: open },
  );

  if (!open || !tab) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="blue"
      paddingX={1}
      height="100%"
      overflow="hidden"
    >
      <TabNav active={tab} />
      <Box marginTop={1}>
        <TabContent store={store} tab={tab} />
      </Box>
      {edit ? <EditOverlay edit={edit} /> : null}
      {toast ? (
        <Box marginTop={1}>
          <Text color={toast.kind === "ok" ? "green" : "red"}>{toast.text}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>
          Tab/Shift+Tab — cycle. Ctrl+S — close. Per-tab hotkeys shown inside.
        </Text>
      </Box>
    </Box>
  );
}

export { setToast as _settingsSetToast };
export type { ShellViewState as _ShellViewState };
