/**
 * Host-only mission contract acceptance.
 *
 * The user clicks "Accept contract" in the renderer. The
 * `mission.acceptContract` IPC handler (phase 6) calls this engine
 * helper with the contract hash the UI computed and showed. We:
 *
 *   1. open a tx and SELECT FOR UPDATE the missions row so any
 *      concurrent `updateDraft` / `startMission` sees a serialized
 *      view of acceptance state;
 *   2. recompute the canonical hash from the (locked) row so the user
 *      cannot accept a contract that drifted between view and click;
 *   3. validate the mission status is in {draft, ready} (you don't
 *      accept a running / completed / failed / cancelled mission —
 *      the contract is either already live or no longer relevant);
 *   4. validate no active/paused mission_run exists for this mission
 *      (acceptance after run started would be sketchy — a fresh
 *      acceptance via `/mission-renew` is the right path);
 *   5. write the four acceptance columns atomically via
 *      `updateAcceptance` (the CHECK constraint
 *      `chk_missions_acceptance_atomicity` rejects partial state at
 *      the DB level too).
 *
 * No engine event is emitted yet — phase 6 wires the IPC layer's
 * TanStack onSuccess invalidation. A cross-window
 * `engine.mission.accepted` topic lands with the right-rail
 * subscriber in puzzle 10 (per the plan).
 */

import { withTransaction } from "../../db/client.js";
import {
  getMissionForUpdate,
  updateAcceptance,
  type Mission,
} from "../../db/repos/missions.js";
import * as missionRunsRepo from "../../db/repos/mission-runs.js";

import {
  CONTRACT_HASH_VERSION,
  computeContractHash,
} from "./contract-hash.js";
import { missionToDraft } from "./mapper.js";

const ACCEPTABLE_MISSION_STATUSES = new Set<string>(["draft", "ready"]);
/**
 * Puzzle 04 MVP invariant: acceptance is host-only. A future
 * delegated-approver flow would widen this to a typed enum; for now
 * we pin the literal so the IPC schema layer in phase 6 can rely on
 * `accepted_contract_by === "host"` without any runtime branching.
 */
const ACCEPTANCE_ACTOR = "host" as const;

export interface AcceptContractInput {
  readonly sessionId: string;
  readonly missionId: string;
  /** Hash that the renderer computed + showed to the user. */
  readonly contractHash: string;
}

export type AcceptContractOutcome =
  | {
    readonly outcome: "accepted";
    readonly missionId: string;
    readonly acceptedContractHash: string;
    readonly acceptedAt: string;
    readonly acceptedBy: string;
    readonly contractHashVersion: number;
  }
  | { readonly outcome: "mission_not_found" }
  | {
    readonly outcome: "session_mismatch";
    /** Mission's `root_session_id`, surfaced for diagnostics only. */
    readonly expectedSessionId: string;
  }
  | {
    readonly outcome: "hash_mismatch";
    readonly providedHash: string;
    readonly currentHash: string;
  }
  | {
    readonly outcome: "status_blocked";
    readonly currentStatus: string;
  }
  | {
    readonly outcome: "run_active";
    readonly missionRunId: string;
    readonly runStatus: string;
  };

/** Host-only acceptance of the current mission contract. */
export async function acceptContract(
  input: AcceptContractInput,
): Promise<AcceptContractOutcome> {
  return withTransaction(async (client) => {
    // 1. Row-locked read.
    const mission: Mission | null = await getMissionForUpdate(client, input.missionId);
    if (!mission) {
      return { outcome: "mission_not_found" } as const;
    }

    // 2. Session ownership sanity check — the renderer always passes
    //    the session id; mismatching means a stale UI / hostile call.
    if (mission.rootSessionId !== input.sessionId) {
      return {
        outcome: "session_mismatch",
        expectedSessionId: mission.rootSessionId,
      } as const;
    }

    // 3. Recompute the canonical hash from the locked row. If the
    //    UI showed an older draft, the hash won't match and the user
    //    must re-view + re-accept.
    const currentHash = computeContractHash(missionToDraft(mission));
    if (currentHash !== input.contractHash) {
      return {
        outcome: "hash_mismatch",
        providedHash: input.contractHash,
        currentHash,
      } as const;
    }

    // 4. Status gate.
    if (!ACCEPTABLE_MISSION_STATUSES.has(mission.status)) {
      return {
        outcome: "status_blocked",
        currentStatus: mission.status,
      } as const;
    }

    // 5. No active/paused mission_run — acceptance is a pre-run gate.
    //    A run already started means the contract is live (the run
    //    captured a contract snapshot via `buildMissionRunContractSnapshot`).
    const activeRun = await missionRunsRepo.getActiveRun(
      input.missionId,
      client,
    );
    if (activeRun !== null) {
      return {
        outcome: "run_active",
        missionRunId: activeRun.id,
        runStatus: activeRun.status,
      } as const;
    }

    // 6. Commit the acceptance four-tuple atomically.
    await updateAcceptance(
      client,
      input.missionId,
      currentHash,
      ACCEPTANCE_ACTOR,
      CONTRACT_HASH_VERSION,
    );

    // 7. Re-read so the returned timestamp matches the row we wrote.
    const updated = await getMissionForUpdate(client, input.missionId);
    if (!updated || updated.acceptedContractHash === null || updated.acceptedContractAt === null) {
      throw new Error(
        "acceptContract: acceptance row vanished or wrote NULL despite a successful UPDATE",
      );
    }

    return {
      outcome: "accepted",
      missionId: input.missionId,
      acceptedContractHash: updated.acceptedContractHash,
      acceptedAt: updated.acceptedContractAt,
      acceptedBy: updated.acceptedContractBy ?? ACCEPTANCE_ACTOR,
      contractHashVersion: updated.contractHashVersion ?? CONTRACT_HASH_VERSION,
    } as const;
  });
}
