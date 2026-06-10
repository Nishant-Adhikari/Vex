/**
 * Constants for the compose bootstrap surface — step counter formula
 * shared with SystemCheck / DockerBootstrap and the bounded log buffer
 * size.
 */

import { WIZARD_STEP_IDS } from "@shared/schemas/wizard.js";

const SETUP_VIEWS_BEFORE_WIZARD = 4;
export const TOTAL_ONBOARDING_STEPS =
  SETUP_VIEWS_BEFORE_WIZARD + (WIZARD_STEP_IDS.length - 1);
export const COMPOSE_BOOTSTRAP_STEP = 3;

/**
 * Bounded log retention. The renderer pulls a circular buffer from the
 * `onComposeLog` push stream; main is the source of truth, so we never
 * try to keep a full history here. 50 lines covers a typical first-run
 * (~15 log events including container starts + 2 health probes per
 * service) plus retry attempts.
 */
export const COMPOSE_LOG_BUFFER_MAX = 50;
