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
import { Button } from "../../components/ui/button.js";
import { useUiStore } from "../../stores/uiStore.js";

export function EditInfrastructureButton(): JSX.Element {
  const openWizard = useUiStore((s) => s.openWizard);
  const onClick = useCallback((): void => {
    openWizard("reconfigure");
  }, [openWizard]);
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      Edit infrastructure
    </Button>
  );
}
