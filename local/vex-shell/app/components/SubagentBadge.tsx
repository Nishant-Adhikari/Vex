import React from "react";
import { Text } from "ink";
import type { SubagentRow } from "../state/store.js";
import { summarizeSubagents } from "../state/subagents.js";

export function SubagentBadge({ rows }: { rows: readonly SubagentRow[] }): React.JSX.Element | null {
  const summary = summarizeSubagents(rows);
  if (!summary) return null;

  return (
    <>
      {"  "}subagents=<Text color={summary.color}>{summary.label}</Text>
    </>
  );
}
