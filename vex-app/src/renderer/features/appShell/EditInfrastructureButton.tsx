/**
 * Topbar button — routes the user back into the wizard surface to edit
 * infrastructure-level settings (master password, wallets, provider,
 * embedding, etc.).
 *
 * The wizard itself decides which steps are "back-edit"-able via the
 * Review screen's per-card Edit action. Here we enter the wizard in
 * reconfiguration mode so completed installs land on Review instead of
 * immediately bouncing back to the app shell.
 */

import { useCallback } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings02Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button.js";
import { useUiStore } from "../../stores/uiStore.js";

interface EditInfrastructureButtonProps {
  readonly compact?: boolean;
}

export function EditInfrastructureButton({
  compact = false,
}: EditInfrastructureButtonProps): JSX.Element {
  const openWizard = useUiStore((s) => s.openWizard);
  const onClick = useCallback((): void => {
    openWizard("reconfigure");
  }, [openWizard]);
  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      onClick={onClick}
      aria-label="Edit infrastructure"
      className="border border-white/[0.08] bg-white/[0.03] text-[var(--color-text-secondary)] hover:bg-white/[0.08] hover:text-foreground"
    >
      <HugeiconsIcon icon={Settings02Icon} size={16} aria-hidden />
      {compact ? null : <span>Settings</span>}
    </Button>
  );
}
