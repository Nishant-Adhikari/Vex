/**
 * vex.settings.* — Phase 1 read-only preferences + telemetry consent toggle.
 */

import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import {
  preferencesSchema,
  type Preferences,
} from "@shared/schemas/preferences.js";
import { hyperliquidSettingsUpdateInputSchema } from "@shared/schemas/hyperliquid.js";
import { hyperliquidPolicySchema } from "@vex-lib/hyperliquid-policy.js";
import { preferencesStore } from "../preferences/store.js";
import {
  disableSentry,
  initSentryIfConsented,
} from "../telemetry/sentry-lifecycle.js";
import { registerHandler } from "./register-handler.js";

const empty = z.object({}).strict();

const setTelemetryConsentInput = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export function registerSettingsHandlers(): Array<() => void> {
  const handlers: Array<() => void> = [];

  handlers.push(
    registerHandler({
      channel: CH.settings.getPreferences,
      domain: "settings",
      inputSchema: empty,
      outputSchema: preferencesSchema,
      handle: async (): Promise<Result<Preferences>> => {
        const prefs = await preferencesStore.load();
        return ok(preferencesSchema.parse(prefs));
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.settings.setHyperliquidPolicy,
      domain: "settings",
      inputSchema: hyperliquidSettingsUpdateInputSchema,
      outputSchema: preferencesSchema,
      handle: async (input): Promise<Result<Preferences>> => {
        const current = await preferencesStore.load();
        const next = await preferencesStore.update({
          hyperliquid: {
            ...current.hyperliquid,
            policy: hyperliquidPolicySchema.parse({
              ...current.hyperliquid.policy,
              ...input.policy,
            }),
          },
        });
        return ok(preferencesSchema.parse(next));
      },
    }),
  );

  handlers.push(
    registerHandler({
      channel: CH.settings.setTelemetryConsent,
      domain: "settings",
      inputSchema: setTelemetryConsentInput,
      outputSchema: preferencesSchema,
      handle: async ({ enabled }): Promise<Result<Preferences>> => {
        const next = await preferencesStore.update({
          telemetry: {
            enabled,
            consentedAt: enabled ? new Date().toISOString() : null,
          },
        });
        // M11: keep Sentry SDK lifecycle in sync with consent state.
        // initSentryIfConsented + disableSentry are both idempotent so a
        // double-flip (e.g. "off" → "off") is harmless.
        if (enabled) {
          await initSentryIfConsented();
        } else {
          await disableSentry();
        }
        return ok(next);
      },
    })
  );

  return handlers;
}
