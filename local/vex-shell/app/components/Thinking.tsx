/**
 * Thinking indicator — spinner + elapsed ms while `routeUserMessage` is
 * pending. Renders nothing when no turn is in flight. 2D extends this with
 * the current tool-name from the polling side channel.
 */

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Store, ShellViewState } from "../state/store.js";
import { useStore } from "../state/store.js";

interface ThinkingProps {
  store: Store;
}

function selectPending(s: ShellViewState) {
  return s.pendingTurn;
}

export function Thinking({ store }: ThinkingProps): React.JSX.Element {
  const pending = useStore(store, selectPending);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!pending) return;
    const handle = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(handle);
  }, [pending]);

  if (!pending) {
    return (
      <Box height={1}>
        <Text dimColor>Ready.</Text>
      </Box>
    );
  }

  const elapsedMs = now - pending.startedAt;
  const elapsedLabel = `${(elapsedMs / 1000).toFixed(1)}s`;
  const activity = pending.currentToolName
    ? `Calling tool: ${pending.currentToolName}`
    : "Thinking…";

  return (
    <Box height={1} overflow="hidden">
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text wrap="truncate">
        {" "}
        {activity} <Text dimColor>({elapsedLabel})</Text>
      </Text>
    </Box>
  );
}
