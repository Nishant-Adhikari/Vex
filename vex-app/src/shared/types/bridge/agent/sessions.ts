import type { Result } from "../../../ipc/result.js";
import type {
  SessionCreateInput,
  SessionCreateResult,
  SessionDeleteInput,
  SessionDeleteResult,
  SessionGetInput,
  SessionGetModelInput,
  SessionList,
  SessionListItem,
  SessionModelDto,
  SessionSetModelInput,
  SessionSetModelResult,
  SessionSetPinnedInput,
  SessionSetPinnedResult,
} from "../../../schemas/sessions.js";

export interface SessionsBridge {
  readonly create: (
    input: SessionCreateInput
  ) => Promise<Result<SessionCreateResult>>;
  readonly list: () => Promise<Result<SessionList>>;
  readonly get: (
    input: SessionGetInput
  ) => Promise<Result<SessionListItem | null>>;
  /**
   * Pin/unpin a session. Idempotent on both sides: re-pinning preserves
   * the existing `pinnedAt`, re-unpinning is a no-op. Returns `null`
   * when the id is unknown (stale renderer cache).
   */
  readonly setPinned: (
    input: SessionSetPinnedInput
  ) => Promise<Result<SessionSetPinnedResult>>;
  /**
   * Soft-delete a session. Main enforces fail-closed against active
   * mission runs and pending approvals; the discriminated outcome
   * tells the renderer whether cache cleanup is appropriate.
   */
  readonly delete: (
    input: SessionDeleteInput
  ) => Promise<Result<SessionDeleteResult>>;
  /**
   * Resolve the per-session model. Puzzle 1 returns the global env
   * default (`AGENT_PROVIDER`/`AGENT_MODEL`) with `source:
   * "global_default" | "unconfigured"` — the `sessions.model_id`
   * column lands in puzzle 06.
   */
  readonly getModel: (
    input: SessionGetModelInput
  ) => Promise<Result<SessionModelDto>>;
  /**
   * Persist a per-session model choice. Fail-closed with
   * `sessions.feature_unavailable` until puzzle 06 adds the
   * migration + engine context loader.
   */
  readonly setModel: (
    input: SessionSetModelInput
  ) => Promise<Result<SessionSetModelResult>>;
}
