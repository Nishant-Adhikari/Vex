import type { Result } from "../../../ipc/result.js";
import type { EnvState } from "../../../schemas/onboarding.js";
import type {
  KeystoreSetInput,
  KeystoreSetResult,
  SetWizardStateInput,
  WizardState,
} from "../../../schemas/wizard.js";
import type {
  WalletGenerateEvmResult,
  WalletGenerateSolanaResult,
  WalletImportEvmInput,
  WalletImportEvmResult,
  WalletImportSolanaInput,
  WalletImportSolanaResult,
  WalletOpenBackupFolderInput,
  WalletOpenBackupFolderResult,
  WalletRestoreInput,
  WalletRestoreResult,
} from "../../../schemas/wallets.js";
import type {
  ApiKeysSetInput,
  ApiKeysSetResult,
  PolymarketAutoSetupInput,
  PolymarketAutoSetupResult,
} from "../../../schemas/api-keys.js";
import type {
  EmbeddingConfigureInput,
  EmbeddingConfigureResult,
} from "../../../schemas/embedding.js";
import type {
  AgentCoreConfigureInput,
  AgentCoreConfigureResult,
} from "../../../schemas/agent-core.js";
import type {
  ProviderPersistInput,
  ProviderPersistResult,
} from "../../../schemas/provider.js";
import type {
  CompleteSetupInput,
  CompleteSetupResult,
} from "../../../schemas/finalize.js";

export interface OnboardingBridge {
  readonly getEnvState: () => Promise<Result<EnvState>>;
  readonly getWizardState: () => Promise<Result<WizardState>>;
  readonly setWizardState: (
    input: SetWizardStateInput
  ) => Promise<Result<WizardState>>;
  readonly keystoreSet: (
    input: KeystoreSetInput
  ) => Promise<Result<KeystoreSetResult>>;
  readonly walletGenerateEvm: () => Promise<Result<WalletGenerateEvmResult>>;
  readonly walletGenerateSolana: () => Promise<Result<WalletGenerateSolanaResult>>;
  readonly walletImportEvm: (
    input: WalletImportEvmInput
  ) => Promise<Result<WalletImportEvmResult>>;
  readonly walletImportSolana: (
    input: WalletImportSolanaInput
  ) => Promise<Result<WalletImportSolanaResult>>;
  readonly walletRestoreFromBackup: (
    input: WalletRestoreInput
  ) => Promise<Result<WalletRestoreResult>>;
  readonly walletOpenBackupFolder: (
    input: WalletOpenBackupFolderInput
  ) => Promise<Result<WalletOpenBackupFolderResult>>;
  readonly apiKeysSet: (
    input: ApiKeysSetInput
  ) => Promise<Result<ApiKeysSetResult>>;
  /**
   * One-click Polymarket setup (Phase 2 feature #7). Derives CLOB API
   * credentials from the unlocked EVM wallet keystore via the engine
   * primitive, persists them inside the encrypted secret vault, and
   * returns the wallet address. Result does NOT carry credentials —
   * the renderer reads canonical envState for confirmation.
   */
  readonly polymarketAutoSetup: (
    input: PolymarketAutoSetupInput
  ) => Promise<Result<PolymarketAutoSetupResult>>;
  readonly embeddingConfigure: (
    input: EmbeddingConfigureInput
  ) => Promise<Result<EmbeddingConfigureResult>>;
  readonly agentCoreConfigure: (
    input: AgentCoreConfigureInput
  ) => Promise<Result<AgentCoreConfigureResult>>;
  readonly providerPersist: (
    input: ProviderPersistInput
  ) => Promise<Result<ProviderPersistResult>>;
  readonly completeSetup: (
    input: CompleteSetupInput
  ) => Promise<Result<CompleteSetupResult>>;
}
