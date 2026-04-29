/**
 * Mission setup — guided conversation handler for drafting missions.
 *
 * Flow:
 * 1. Load or create mission draft
 * 2. Parse model response into patch (safe boundary)
 * 3. Convert domain → row, update DB
 * 4. Validate draft → report missing fields
 * 5. If valid → set status ready
 */

import type { MissionDraft } from "../types.js";
import { extractMissionPatch, sanitizePatch } from "./patch-parser.js";
import { domainToRow, missionToDraft } from "./mapper.js";
import { validateDraft } from "./validator.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import type { Mission } from "@vex-agent/db/repos/missions.js";

export interface SetupResult {
  missionId: string;
  status: string;
  currentDraft: Partial<MissionDraft>;
  missingFields: string[];
  ready: boolean;
}

/**
 * Create a new mission draft for a session.
 */
export async function createMissionDraft(sessionId: string): Promise<SetupResult> {
  const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await missionsRepo.createDraft(missionId, sessionId);

  return {
    missionId,
    status: "draft",
    currentDraft: {},
    missingFields: [
      "title", "goal", "capitalSource", "startingCapital",
      "allowedWallets", "allowedChains", "allowedProtocols",
      "riskProfile", "successCriteria", "stopConditions",
    ],
    ready: false,
  };
}

/**
 * Apply a model-produced patch to an existing mission draft.
 *
 * Safe pipeline: extractMissionPatch(unknown) → sanitizePatch()
 * → Partial<MissionDraft> → domainToRow() → repo.updateDraft()
 */
export async function applyMissionPatch(
  missionId: string,
  rawModelOutput: unknown,
): Promise<SetupResult> {
  // Load current mission
  const mission = await missionsRepo.getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found`);

  // Parse + sanitize (safe boundary)
  const extracted = extractMissionPatch(rawModelOutput);
  if (extracted) {
    const sanitized = sanitizePatch(extracted);
    if (Object.keys(sanitized).length > 0) {
      const rowPatch = domainToRow(sanitized);

      // Merge capital_source_json with existing to avoid losing fields on partial update
      if (rowPatch.capital_source_json && mission.capitalSourceJson) {
        rowPatch.capital_source_json = { ...mission.capitalSourceJson, ...rowPatch.capital_source_json };
      }

      await missionsRepo.updateDraft(missionId, rowPatch);
    }
  }

  // Re-load after update
  const updated = await missionsRepo.getMission(missionId);
  if (!updated) throw new Error(`Mission ${missionId} disappeared after update`);

  // Validate
  const validation = validateDraft(updated);

  // Transition to ready if all fields populated
  if (validation.valid && updated.status === "draft") {
    await missionsRepo.setStatus(missionId, "ready");
  }

  const currentDraft = missionToDraft(updated);
  const status = validation.valid ? "ready" : updated.status;

  return {
    missionId,
    status,
    currentDraft,
    missingFields: validation.missing,
    ready: validation.valid,
  };
}

/**
 * Get current setup state for a mission.
 */
export async function getMissionSetupState(missionId: string): Promise<SetupResult | null> {
  const mission = await missionsRepo.getMission(missionId);
  if (!mission) return null;

  const validation = validateDraft(mission);
  const currentDraft = missionToDraft(mission);

  return {
    missionId,
    status: mission.status,
    currentDraft,
    missingFields: validation.missing,
    ready: validation.valid,
  };
}
