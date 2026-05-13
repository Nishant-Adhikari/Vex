/**
 * Topbar button — routes the user back into the wizard surface to edit
 * infrastructure-level settings (master password, wallets, provider,
 * embedding, etc.).
 *
 * The wizard itself decides which steps are "back-edit"-able via the
 * Review screen's per-card Edit action; here we only swap the top-level
 * view. WizardShell re-reads the persisted wizard state on mount and
 * lands the user on the review screen because `completed: true`.
 */

import { useCallback } from "react";
import { Button } from "../../components/ui/button.js";
import { useUiStore } from "../../stores/uiStore.js";

export function EditInfrastructureButton(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const onClick = useCallback((): void => {
    setCurrentView("wizard");
  }, [setCurrentView]);
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      Edit infrastructure
    </Button>
  );
}
