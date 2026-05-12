/**
 * Root Ink component. Wires the cockpit, message stream, thinking indicator,
 * approvals banner, input box, and sidebar to the shell store. Also owns the
 * "send message" → engine pipeline.
 *
 * In 2C we call `routeUserMessage` directly and append user + assistant
 * messages to the store. 2D will layer `useTurnState` polling on top to
 * surface intermediate tool calls.
 */

import React, { useCallback } from "react";
import { Box, useWindowSize } from "ink";
import type { Store } from "./state/store.js";
import { useStore } from "./state/store.js";
import { useSession } from "./hooks/useSession.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { useTurnState } from "./hooks/useTurnState.js";
import { useInitialPromptIntent } from "./hooks/useInitialPromptIntent.js";
import { useSubagentMonitor } from "./hooks/useSubagentMonitor.js";
import { Cockpit } from "./components/Cockpit.js";
import { Messages } from "./components/Messages.js";
import { Thinking } from "./components/Thinking.js";
import { ApprovalBanner } from "./components/ApprovalBanner.js";
import { InputBox } from "./components/InputBox.js";
import { Sidebar } from "./components/Sidebar.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ToolCallsPanel } from "./components/ToolCallsPanel.js";
import { deriveShellLayout, STATUS_ROWS } from "./lib/shellLayout.js";
import {
  runSlashCommand,
  sendUserMessage,
} from "./flows/shellTurn.js";
import {
  sendOperatorInstruction,
  shouldSendOperatorInstruction,
} from "./flows/operatorInstruction.js";

interface AppProps {
  store: Store;
  terminalSize?: { columns: number; rows: number };
}

export function App({ store, terminalSize }: AppProps): React.JSX.Element {
  useSession(store);
  useHotkeys(store);
  useTurnState(store);
  useInitialPromptIntent(store);
  useSubagentMonitor(store);

  const windowSize = useWindowSize();
  const settingsOpen = useStore(store, (s) => s.settingsTab !== null);
  const toolCallsOpen = useStore(store, (s) => s.toolCallsOpen);
  const sidebarOpen = useStore(store, (s) => s.sidebarOpen);
  const layout = deriveShellLayout(terminalSize ?? windowSize, sidebarOpen);

  const handleInput = useCallback(
    async (value: string): Promise<void> => {
      if (value.startsWith("/")) {
        await runSlashCommand(store, value);
        return;
      }
      if (shouldSendOperatorInstruction(store)) {
        await sendOperatorInstruction(store, value);
        return;
      }
      await sendUserMessage(store, value);
    },
    [store],
  );

  return (
    <Box
      flexDirection="column"
      width={layout.columns}
      height={layout.rows}
      overflow="hidden"
    >
      <Cockpit store={store} />
      <Box
        flexDirection="row"
        flexGrow={1}
        height={layout.bodyRows}
        overflow="hidden"
      >
        <Box
          flexDirection="column"
          flexGrow={1}
          height={layout.bodyRows}
          overflow="hidden"
        >
          {toolCallsOpen ? (
            <ToolCallsPanel store={store} />
          ) : settingsOpen ? (
            <SettingsPanel store={store} />
          ) : (
            <Messages
              store={store}
              viewportRows={layout.bodyRows}
              viewportColumns={layout.mainColumns}
            />
          )}
        </Box>
        <Sidebar store={store} width={layout.sidebarColumns} />
      </Box>
      <Box
        flexDirection="column"
        height={STATUS_ROWS}
        flexShrink={0}
        overflow="hidden"
      >
        <Thinking store={store} />
        <ApprovalBanner store={store} />
      </Box>
      <InputBox store={store} onSubmit={(value) => void handleInput(value)} />
    </Box>
  );
}
