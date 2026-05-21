import type { Result } from "../../../ipc/result.js";
import type {
  SecretsLockResult,
  SecretsStatus,
  SecretsUnlockInput,
  SecretsUnlockResult,
} from "../../../schemas/secrets.js";

export interface SecretsBridge {
  readonly status: () => Promise<Result<SecretsStatus>>;
  readonly unlock: (
    input: SecretsUnlockInput
  ) => Promise<Result<SecretsUnlockResult>>;
  readonly lock: () => Promise<Result<SecretsLockResult>>;
}
