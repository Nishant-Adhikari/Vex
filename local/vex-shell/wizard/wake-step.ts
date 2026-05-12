/**
 * Wake executor toggle + optional tuning (intervalMs, batchSize).
 *
 * Required for full_autonomous and paused_wake missions to auto-resume
 * without a user message. Advanced fields are hidden behind a confirm.
 */

import { confirm, isCancel, text } from "@clack/prompts";

export interface WakeOutcome {
  aborted: boolean;
  enabled: boolean;
  intervalMs?: number;
  batchSize?: number;
}

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_BATCH_SIZE = 10;

export async function runWakeStep(): Promise<WakeOutcome> {
  const enabled = await confirm({
    message: "Enable wake executor?",
    initialValue: false,
    active: "yes (recommended for mission / full_autonomous)",
    inactive: "no (manual resume only)",
  });
  if (isCancel(enabled)) return { aborted: true, enabled: false };
  if (!enabled) return { aborted: false, enabled: false };

  const wantAdvanced = await confirm({
    message: "Customize wake interval / batch size?",
    initialValue: false,
  });
  if (isCancel(wantAdvanced)) return { aborted: true, enabled };
  if (!wantAdvanced) return { aborted: false, enabled: true };

  const intervalInput = await text({
    message: `wake intervalMs (60-60000, default ${DEFAULT_INTERVAL_MS})`,
    placeholder: String(DEFAULT_INTERVAL_MS),
    validate: (v) => {
      if (!v || v === "") return undefined;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 60 || n > 60000) return "Must be integer 60..60000";
      return undefined;
    },
  });
  if (isCancel(intervalInput)) return { aborted: true, enabled };
  const intervalMs = String(intervalInput).trim() ? parseInt(String(intervalInput), 10) : DEFAULT_INTERVAL_MS;

  const batchInput = await text({
    message: `wake batchSize (1-100, default ${DEFAULT_BATCH_SIZE})`,
    placeholder: String(DEFAULT_BATCH_SIZE),
    validate: (v) => {
      if (!v || v === "") return undefined;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 100) return "Must be integer 1..100";
      return undefined;
    },
  });
  if (isCancel(batchInput)) return { aborted: true, enabled };
  const batchSize = String(batchInput).trim() ? parseInt(String(batchInput), 10) : DEFAULT_BATCH_SIZE;

  return { aborted: false, enabled: true, intervalMs, batchSize };
}
