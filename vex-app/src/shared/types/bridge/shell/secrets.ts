import type { Result } from "../../../ipc/result.js";
import type {
  SecretsLockResult,
  SecretsStatus,
  SecretsUnlockInput,
  SecretsUnlockResult,
  ResetToFreshVaultInput,
  ResetToFreshVaultResult,
  TouchIdStatusDto,
  TouchIdEnableResult,
  TouchIdDisableResult,
  TouchIdUnlockDto,
} from "../../../schemas/secrets.js";

export interface SecretsBridge {
  readonly status: () => Promise<Result<SecretsStatus>>;
  readonly unlock: (
    input: SecretsUnlockInput
  ) => Promise<Result<SecretsUnlockResult>>;
  readonly lock: () => Promise<Result<SecretsLockResult>>;
  readonly resetToFreshVault: (
    input: ResetToFreshVaultInput,
  ) => Promise<Result<ResetToFreshVaultResult>>;
  readonly touchIdStatus: () => Promise<Result<TouchIdStatusDto>>;
  readonly touchIdEnable: () => Promise<Result<TouchIdEnableResult>>;
  readonly touchIdDisable: () => Promise<Result<TouchIdDisableResult>>;
  readonly touchIdUnlock: () => Promise<Result<TouchIdUnlockDto>>;
}
