/**
 * Top-bar cockpit — always-visible session state (provider, wake, session,
 * mission, approvals count). Static render, re-renders only when the selector
 * output changes.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Store, ShellViewState } from "../state/store.js";
import { useStore } from "../state/store.js";
import { formatContextWindow, formatTokenCount } from "../../platform/render.js";
import { SubagentBadge } from "./SubagentBadge.js";

interface CockpitProps {
  store: Store;
}

function selectCockpit(s: ShellViewState) {
  return {
    provider: s.provider,
    wakeEnabled: s.wakeEnabled,
    session: s.session,
    approvalsCount: s.approvals.length,
    subagentRows: s.subagentRows,
  };
}

export function Cockpit({ store }: CockpitProps): React.JSX.Element {
  const { provider, wakeEnabled, session, approvalsCount, subagentRows } = useStore(store, selectCockpit);

  const sessionLabel = session
    ? `${session.id.slice(0, 16)}… (${session.kind})`
    : "none";
  const missionLabel = session?.missionStatus ?? "none";
  const contextLabel = session ? formatContextWindow(session.context) : "none";
  const tokenLabel = session ? formatTokenCount(session.usage.sessionTokens) : "0";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      height={4}
      paddingX={1}
      flexShrink={0}
      overflow="hidden"
    >
      <Text wrap="truncate">
        <Text bold color="cyan">VEX</Text>
        {"  "}provider=<Text color="green">{provider.name}</Text>
        {"  "}wake=<Text color={wakeEnabled ? "green" : "gray"}>{wakeEnabled ? "on" : "off"}</Text>
        {"  "}session=<Text color={session ? "green" : "gray"}>{sessionLabel}</Text>
        {"  "}mission=<Text color={missionLabel === "none" ? "gray" : "yellow"}>{missionLabel}</Text>
        {"  "}approvals=<Text color={approvalsCount > 0 ? "yellow" : "gray"}>{approvalsCount}</Text>
        <SubagentBadge rows={subagentRows} />
      </Text>
      <Text dimColor wrap="truncate">
        {provider.detail || "model=unset"}
        {"  "}ctx=<Text color={session?.context.band === "critical" ? "red" : session?.context.band === "warning" ? "yellow" : "gray"}>{contextLabel}</Text>
        {"  "}tok=<Text color={session ? "gray" : "gray"}>{tokenLabel}</Text>
      </Text>
    </Box>
  );
}
