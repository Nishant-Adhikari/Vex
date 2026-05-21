import type { Result } from "../../../ipc/result.js";
import type { Capabilities } from "../../../schemas/capabilities.js";

export interface CapabilitiesBridge {
  readonly get: () => Promise<Result<Capabilities>>;
}
