import type { Result } from "../../../ipc/result.js";
import type {
  MigrateProgress,
  MigrateResult,
} from "../../../schemas/database.js";

export interface DatabaseBridge {
  readonly migrate: () => Promise<Result<MigrateResult>>;
  /**
   * Subscribe to migration progress events. Returns idempotent
   * unsubscribe — call from React effect cleanup. The bus replays
   * the most recent event to new subscribers so a late join
   * (StrictMode re-mount, joined single-flight) doesn't miss the
   * planned/index/total handshake.
   */
  readonly onProgress: (
    cb: (payload: MigrateProgress) => void
  ) => () => void;
}
