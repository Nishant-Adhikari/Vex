import type { Result } from "../../../ipc/result.js";
import type {
  HealthReport,
  NetworkProbe,
  OsInfo,
} from "../../../schemas/system.js";

export interface SystemBridge {
  readonly health: () => Promise<Result<HealthReport>>;
  readonly osInfo: () => Promise<Result<OsInfo>>;
  readonly network: () => Promise<Result<NetworkProbe>>;
}
