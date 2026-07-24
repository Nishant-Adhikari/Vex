/**
 * Sidebar footer key — opens the Signals sub-view (today's ingested
 * TrendRadar signals + the LLM-as-judge grade). Mirrors `MissionsButton` /
 * `MemoryButton`: a quiet full-width registry row carrying its own border-t
 * hairline so the footer stack stays separated.
 */

import { useCallback, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Radar01Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/utils.js";
import { useUiStore } from "../../stores/uiStore.js";

interface SignalsButtonProps {
  readonly compact?: boolean;
}

export function SignalsButton({ compact = false }: SignalsButtonProps): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const onClick = useCallback((): void => {
    setAppShellView("signals");
  }, [setAppShellView]);

  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      onClick={onClick}
      aria-label="Open signals"
      className={cn(
        "h-9 w-full rounded-none border-0 border-t border-[var(--vex-line)] bg-transparent text-[10px] tracking-[0.18em] text-[var(--vex-text-2)] hover:bg-white/[0.035] hover:text-foreground",
        compact ? "justify-center px-0" : "justify-start gap-2 px-4",
      )}
    >
      <HugeiconsIcon icon={Radar01Icon} size={15} aria-hidden />
      {compact ? null : <span>Signals</span>}
    </Button>
  );
}
