import { z } from "zod";
import { CH } from "../../shared/ipc/channels.js";
import type { TelemetryBridge } from "../../shared/types/bridge/shell/telemetry.js";
import { invokeWithSchema } from "../_dispatch.js";

const reportRendererErrorInputSchema = z
  .object({
    kind: z.enum(["caught", "uncaught", "boundary"]),
    message: z.string().max(2000),
    componentStack: z.string().max(10000).nullable().optional(),
  })
  .strict();

export const telemetry = {
  reportRendererError(input) {
    return invokeWithSchema(
      CH.telemetry.reportRendererError,
      input,
      reportRendererErrorInputSchema
    );
  },
} satisfies TelemetryBridge;
