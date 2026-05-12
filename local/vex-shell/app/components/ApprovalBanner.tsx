/**
 * Compact approvals status line. Full approval browsing lives in Settings /
 * Approvals; this line stays fixed-height so pending approvals cannot resize
 * the shell frame.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Store, ShellViewState, ApprovalItem } from "../state/store.js";
import { useStore } from "../state/store.js";

interface ApprovalBannerProps {
  store: Store;
}

function selectApprovals(s: ShellViewState): ApprovalItem[] {
  return s.approvals;
}

export function ApprovalBanner({ store }: ApprovalBannerProps): React.JSX.Element | null {
  const approvals = useStore(store, selectApprovals);
  if (approvals.length === 0) return null;

  const first = approvals[0]!;
  const rest = approvals.length > 1 ? ` +${approvals.length - 1} more` : "";

  return (
    <Box height={1} overflow="hidden">
      <Text color="yellow" wrap="truncate">
        Pending approval: <Text bold>{first.id}</Text> tool=<Text bold>{first.tool}</Text>
        {rest}. Use /approve &lt;id&gt;, /reject &lt;id&gt;, or Ctrl+S Approvals.
      </Text>
    </Box>
  );
}
