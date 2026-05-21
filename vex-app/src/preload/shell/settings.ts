import { z } from "zod";
import { CH } from "../../shared/ipc/channels.js";
import type { SettingsBridge } from "../../shared/types/bridge/shell/settings.js";
import { invokeWithSchema } from "../_dispatch.js";

const setTelemetryConsentInputSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const settings = {
  getPreferences() {
    return invokeWithSchema(CH.settings.getPreferences, {});
  },
  setTelemetryConsent(input: { enabled: boolean }) {
    return invokeWithSchema(
      CH.settings.setTelemetryConsent,
      input,
      setTelemetryConsentInputSchema
    );
  },
} satisfies SettingsBridge;
