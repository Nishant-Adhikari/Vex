import type { Result } from "../../../ipc/result.js";
import type { TelemetryReportInput } from "../common.js";

export interface TelemetryBridge {
  readonly reportRendererError: (
    input: TelemetryReportInput
  ) => Promise<Result<{ recorded: boolean }>>;
}
