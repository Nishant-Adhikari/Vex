import type { Result } from "../../../ipc/result.js";
import type {
  AvailableWalletsDto,
  PreparedIntentDto,
  SessionWalletScopeDto,
  WalletsActionResult,
  WalletsCancelPreparedIntentInput,
  WalletsGetPreparedIntentInput,
  WalletsListAvailableInput,
  WalletsListSessionInput,
  WalletsSetScopeInput,
  WalletsSetScopeResult,
} from "../../../schemas/wallets.js";

/**
 * Per-session wallet scope, DB-backed (phase 5C). `setSessionWalletScope`
 * resolves wallet ids server-side and fails closed on unknown ids with
 * `wallets.invalid_selection`; prepared-intent reads/cancels are
 * DB-backed (phase 4). Wallet side effects use hot wallets created or
 * imported by the user during onboarding. This bridge exposes only that
 * user-wallet flow.
 */
export interface WalletsBridge {
  readonly listAvailable: (
    input: WalletsListAvailableInput
  ) => Promise<Result<AvailableWalletsDto>>;
  readonly listSessionWallets: (
    input: WalletsListSessionInput
  ) => Promise<Result<SessionWalletScopeDto>>;
  readonly setSessionWalletScope: (
    input: WalletsSetScopeInput
  ) => Promise<Result<WalletsSetScopeResult>>;
  readonly getPreparedIntent: (
    input: WalletsGetPreparedIntentInput
  ) => Promise<Result<PreparedIntentDto | null>>;
  readonly cancelPreparedIntent: (
    input: WalletsCancelPreparedIntentInput
  ) => Promise<Result<WalletsActionResult>>;
}
