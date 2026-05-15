/**
 * Constants for the Docker bootstrap surface — pulled out so the
 * orchestrator and per-branch bodies share a single source of truth.
 *
 * `TOTAL_ONBOARDING_STEPS` is derived from `WIZARD_STEP_IDS.length`
 * (minus the trailing `review` step which is confirmation, not setup)
 * plus the four pre-wizard onboarding views (systemCheck,
 * dockerBootstrap, composeBootstrap, migrations). Same formula as
 * SystemCheck — keep it in sync if a wizard step is added/removed.
 */

import { WIZARD_STEP_IDS } from "@shared/schemas/wizard.js";

const SETUP_VIEWS_BEFORE_WIZARD = 4;
export const TOTAL_ONBOARDING_STEPS =
  SETUP_VIEWS_BEFORE_WIZARD + (WIZARD_STEP_IDS.length - 1);
export const DOCKER_BOOTSTRAP_STEP = 2;

// Canonical Docker install docs URLs verified via curl HEAD redirect:
// `/desktop/install/*` 301s to `/desktop/setup/install/*`. Use the
// final URLs so the user lands on the canonical page directly.
export const DOCKER_DESKTOP_MAC_URL =
  "https://docs.docker.com/desktop/setup/install/mac-install/";
export const DOCKER_DESKTOP_WIN_URL =
  "https://docs.docker.com/desktop/setup/install/windows-install/";
export const DOCKER_ENGINE_LINUX_URL = "https://docs.docker.com/engine/install/";
export const DOCKER_ROOTLESS_URL =
  "https://docs.docker.com/engine/security/rootless/";
