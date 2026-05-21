import type { Result } from "../../../ipc/result.js";
import type {
  LastTurnUsageResult,
  SessionUsageTotalsDto,
  UsageInput,
} from "../../../schemas/usage.js";

/**
 * Usage meter — last-turn snapshot + session totals from
 * `usage_log`. Empty sessions resolve to all-zero totals + `null`
 * last-turn, never an error.
 */
export interface UsageBridge {
  readonly getSessionTotals: (
    input: UsageInput
  ) => Promise<Result<SessionUsageTotalsDto>>;
  readonly getLastTurn: (
    input: UsageInput
  ) => Promise<Result<LastTurnUsageResult>>;
}
