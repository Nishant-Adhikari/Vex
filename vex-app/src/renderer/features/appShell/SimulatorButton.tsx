import { useCallback, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AiInnovation02Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/utils.js";
import { useUiStore } from "../../stores/uiStore.js";

interface SimulatorButtonProps {
  readonly compact?: boolean;
}

export function SimulatorButton({
  compact = false,
}: SimulatorButtonProps): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const onClick = useCallback((): void => {
    setAppShellView("simulator");
  }, [setAppShellView]);

  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      onClick={onClick}
      aria-label="Open simulator"
      className={cn(
        "h-9 w-full rounded-none border-0 border-t border-[var(--vex-line)] bg-transparent text-[10px] tracking-[0.18em] text-[var(--vex-text-2)] hover:bg-white/[0.035] hover:text-foreground",
        compact ? "justify-center px-0" : "justify-start gap-2 px-4",
      )}
    >
      <HugeiconsIcon icon={AiInnovation02Icon} size={15} aria-hidden />
      {compact ? null : <span>Simulator</span>}
    </Button>
  );
}
