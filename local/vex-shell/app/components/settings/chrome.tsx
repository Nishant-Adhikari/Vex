import React from "react";
import { Box, Text } from "ink";
import type { SettingsEditMode, SettingsTabId } from "../../state/store.js";
import { SETTINGS_TAB_ORDER } from "../../state/store.js";
import { TAB_LABELS } from "./constants.js";

export function TabNav({ active }: { active: SettingsTabId }): React.JSX.Element {
  return (
    <Box flexWrap="wrap" columnGap={2}>
      {SETTINGS_TAB_ORDER.map((id) => (
        <Text key={id} color={id === active ? "cyan" : "gray"} bold={id === active}>
          {id === active ? `[${TAB_LABELS[id]}]` : TAB_LABELS[id]}
        </Text>
      ))}
    </Box>
  );
}

export function EditOverlay({ edit }: { edit: SettingsEditMode }): React.JSX.Element {
  const display = edit.kind === "secret" ? "*".repeat(edit.value.length) : edit.value;
  return (
    <Box marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text bold color="yellow">
        Editing {edit.tab}.{edit.field}
        {edit.placeholder ? ` — ${edit.placeholder}` : ""}
      </Text>
      <Text>
        {`> ${display}`}
        <Text color="cyan">█</Text>
      </Text>
      <Text dimColor>Enter — save. Esc — cancel. Backspace — delete char.</Text>
    </Box>
  );
}
