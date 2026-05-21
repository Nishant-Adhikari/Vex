import type { Result } from "../../../ipc/result.js";
import type {
  MissionCommandInput,
  MissionCommandResult,
  MissionGetDraftInput,
  MissionGetDraftResult,
} from "../../../schemas/mission.js";

/**
 * Mission draft + contract + command surface. `getDraft` reads the
 * latest `status = 'draft'` mission row for the session; every
 * other method fail-closes with `mission.feature_unavailable` until
 * puzzle 04 lands host-only acceptance + `/rewind`/`/restore`/
 * `/mission-renew`.
 */
export interface MissionBridge {
  readonly getDraft: (
    input: MissionGetDraftInput
  ) => Promise<Result<MissionGetDraftResult>>;
  readonly updateDraft: (
    input: MissionCommandInput
  ) => Promise<Result<MissionCommandResult>>;
  readonly getDiff: (
    input: MissionCommandInput
  ) => Promise<Result<MissionCommandResult>>;
  readonly acceptContract: (
    input: MissionCommandInput
  ) => Promise<Result<MissionCommandResult>>;
  readonly start: (
    input: MissionCommandInput
  ) => Promise<Result<MissionCommandResult>>;
  readonly continue: (
    input: MissionCommandInput
  ) => Promise<Result<MissionCommandResult>>;
  readonly recover: (
    input: MissionCommandInput
  ) => Promise<Result<MissionCommandResult>>;
  readonly rewind: (
    input: MissionCommandInput
  ) => Promise<Result<MissionCommandResult>>;
  readonly restore: (
    input: MissionCommandInput
  ) => Promise<Result<MissionCommandResult>>;
  readonly renew: (
    input: MissionCommandInput
  ) => Promise<Result<MissionCommandResult>>;
  readonly stop: (
    input: MissionCommandInput
  ) => Promise<Result<MissionCommandResult>>;
}
