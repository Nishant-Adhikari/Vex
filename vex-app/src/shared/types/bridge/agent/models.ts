import type { Result } from "../../../ipc/result.js";
import type {
  ModelsListAvailableInput,
  ModelsListAvailableResult,
} from "../../../schemas/models.js";

/**
 * Provider/model catalogue. Puzzle 1 returns the configured global
 * default from env (single option or empty); puzzle 06 adds the
 * OpenRouter `/models` fetch + per-session model migration.
 */
export interface ModelsBridge {
  readonly listAvailable: (
    input: ModelsListAvailableInput
  ) => Promise<Result<ModelsListAvailableResult>>;
}
