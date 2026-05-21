import type { Result } from "../../../ipc/result.js";
import type {
  RuntimeRequestInput,
  RuntimeRequestResult,
  RuntimeStateDto,
} from "../../../schemas/runtime.js";

/**
 * Runtime state + control plane for the active mission run.
 * `getState` is read-only; the four control mutations fail closed
 * with `runtime.feature_unavailable` until puzzle 03 lands the
 * DB-backed control plane + runner leases.
 */
export interface RuntimeBridge {
  readonly getState: (
    input: RuntimeRequestInput
  ) => Promise<Result<RuntimeStateDto>>;
  readonly requestPause: (
    input: RuntimeRequestInput
  ) => Promise<Result<RuntimeRequestResult>>;
  readonly requestStop: (
    input: RuntimeRequestInput
  ) => Promise<Result<RuntimeRequestResult>>;
  readonly requestResume: (
    input: RuntimeRequestInput
  ) => Promise<Result<RuntimeRequestResult>>;
  readonly cancelWake: (
    input: RuntimeRequestInput
  ) => Promise<Result<RuntimeRequestResult>>;
}
