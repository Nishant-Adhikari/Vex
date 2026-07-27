/**
 * Mission retrospective — read-only transport schema for
 * `mission.getRetrospective`.
 *
 * The retrospective is a compact, LLM-generated "lessons learned" record for a
 * finalized mission run (migration 044 `mission_retrospectives`), produced by a
 * single one-shot inference (the same OpenRouter one-shot path the Signals
 * grade uses — NOT the mission turn-loop) over the run's outcome, PnL, stop
 * reason, and executed trades WITH their agent-authored rationales.
 *
 * It is generated LAZILY on first view of the completed-mission card and cached
 * (fail-soft: inference unavailable / malformed → the read returns null and the
 * card renders without the section). Every `lessons[]` entry is an actionable
 * tweak for the NEXT mission's strategy prompt — the seed of the self-improving
 * loop (a future prompt-revision pass will fold these back automatically).
 *
 * The bounds here are the OUTPUT contract the generator's parser clamps to, so
 * a persisted row can never overflow this schema and 500 the read.
 */

import { z } from "zod";

/** One glanceable list line (a strength, a failure, or a prompt-tweak lesson). */
export const RETROSPECTIVE_LINE_MAX = 280;
/** Max entries per list — enough to be useful, capped so the card stays compact. */
export const RETROSPECTIVE_LIST_MAX = 6;
/** The narrative summary paragraph bound. */
export const RETROSPECTIVE_SUMMARY_MAX = 1_000;

const lineSchema = z.string().min(1).max(RETROSPECTIVE_LINE_MAX);
const listSchema = z.array(lineSchema).max(RETROSPECTIVE_LIST_MAX);

export const missionRetrospectiveDtoSchema = z
  .object({
    /** Compact narrative of what happened over the run. */
    summary: z.string().min(1).max(RETROSPECTIVE_SUMMARY_MAX),
    /** What worked — concrete, trade/decision-grounded. */
    wentWell: listSchema,
    /** What failed — concrete, trade/decision-grounded. */
    wentWrong: listSchema,
    /** Actionable tweaks for the NEXT mission's strategy prompt. */
    lessons: listSchema,
    /** AGENT_MODEL id that produced it — provenance/display only. */
    model: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type MissionRetrospectiveDto = z.infer<typeof missionRetrospectiveDtoSchema>;

// ── getRetrospective (latest retrospective for a SESSION) ────────

export const missionGetRetrospectiveInputSchema = z
  .object({ sessionId: z.string().min(1) })
  .strict();
export type MissionGetRetrospectiveInput = z.infer<
  typeof missionGetRetrospectiveInputSchema
>;

export const missionGetRetrospectiveResultSchema =
  missionRetrospectiveDtoSchema.nullable();
export type MissionGetRetrospectiveResult = z.infer<
  typeof missionGetRetrospectiveResultSchema
>;
