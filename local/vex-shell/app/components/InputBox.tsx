/**
 * Input box — single-line free-text. Enter submits via `onSubmit`. Disabled
 * while a turn is pending (store.pendingTurn != null) so the user can't
 * queue a second send mid-flight.
 *
 * For 2C we keep it single-line + Enter-send (Ink's `ink-text-input`).
 * Multi-line / slash-command autocomplete is 2D+.
 */

import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import {
  type MissionRunStatus,
  type FullAutonomousRunStatus,
  ACTIVE_OR_PAUSED_RUN_STATUSES,
  ACTIVE_OR_PAUSED_FULL_AUTONOMOUS_STATUSES,
} from "../../../../src/vex-agent/engine/types.js";
import type { Store, ShellViewState } from "../state/store.js";
import { useStore } from "../state/store.js";

interface InputBoxProps {
  store: Store;
  onSubmit: (value: string) => void;
}

function selectPending(s: ShellViewState) {
  return s.pendingTurn !== null;
}

function selectCanSubmitWhilePending(s: ShellViewState): boolean {
  const missionStatus = s.session?.missionStatus ?? null;
  const fullAutonomousStatus = s.session?.fullAutonomousStatus ?? null;
  return (
    (typeof missionStatus === "string" && ACTIVE_OR_PAUSED_RUN_STATUSES.has(missionStatus as MissionRunStatus))
    || (
      typeof fullAutonomousStatus === "string"
      && ACTIVE_OR_PAUSED_FULL_AUTONOMOUS_STATUSES.has(fullAutonomousStatus as FullAutonomousRunStatus)
    )
  );
}

function selectPlaceholder(s: ShellViewState): string {
  if (s.pendingTurn) return "send operator instruction to active run";
  const status = s.session?.missionStatus ?? null;
  if (!status) return "type a message, or /help";
  if (status === "ready" && s.session?.missionCommand) {
    return `/mission ${s.session.missionCommand}`;
  }
  if (status === "draft") return "describe mission details, or /mission edit";
  if (ACTIVE_OR_PAUSED_RUN_STATUSES.has(status as MissionRunStatus)) {
    return "/mission stop, /mission edit, /retry or /rewind";
  }
  return "type a message, or /help";
}

export function InputBox({ store, onSubmit }: InputBoxProps): React.JSX.Element {
  const [value, setValue] = useState("");
  const pending = useStore(store, selectPending);
  const canSubmitWhilePending = useStore(store, selectCanSubmitWhilePending);
  const placeholder = useStore(store, selectPlaceholder);

  const handleSubmit = (): void => {
    const trimmed = value.trim();
    if (!trimmed || (pending && !canSubmitWhilePending)) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <Box
      borderStyle="single"
      borderColor={pending ? "gray" : "cyan"}
      height={3}
      flexShrink={0}
      overflow="hidden"
      paddingX={1}
    >
      <Text color={pending ? "gray" : "cyan"}>{pending ? "⋯" : ">"}</Text>
      <Text> </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        showCursor={!pending || canSubmitWhilePending}
        placeholder={placeholder}
      />
    </Box>
  );
}
