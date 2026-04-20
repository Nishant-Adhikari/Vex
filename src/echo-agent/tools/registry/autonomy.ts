/**
 * Autonomy tools — cross-cutting primitives for mission active runs and
 * standalone full-autonomous sessions. Neither "mission" nor "subagent"
 * fits: `loop_defer` lives here because it's the only tool that encodes
 * "sleep until" semantics for both runtime kinds.
 *
 * Visibility contract (enforced by `getOpenAITools` via `ToolVisibility`):
 *   - `requiresMissionActiveRun: true` is satisfied by EITHER an active
 *     mission run (`missionRunActive === true`) OR a standalone
 *     full-autonomous session (`sessionKind === "full_autonomous"`).
 *     That keeps the tool out of chat, mission setup, and subagent surfaces
 *     without needing a second flag.
 *   - `excludeRoles: ["subagent"]` is defense in depth — a child subagent
 *     that somehow ended up with the tool name should still be rejected at
 *     dispatch.
 *   - `excludeFromMcp: true` — MCP has no runtime / autonomy concept.
 *
 * Contract reminders for the model (PR-5 plan §7):
 *   - `reason` is an INTERNAL resume hint, not a user-facing message. It
 *     surfaces later as the wake banner + `effectiveRecallSeed` input
 *     (PR-10). Do NOT put the user-visible explanation here.
 *   - The user-facing explanation of why the agent is deferring MUST go in
 *     the normal `assistant.content`. A plain text reply WITHOUT a
 *     `loop_defer` call does NOT park the mission — engine continues the
 *     next iteration.
 *   - Exactly one of `after_ms` or `wake_at` — handler rejects both / neither.
 */

import type { ToolDef } from "../types.js";

export const AUTONOMY_TOOLS: readonly ToolDef[] = [
  {
    name: "loop_defer",
    kind: "internal",
    mutating: false,
    excludeRoles: ["subagent"],
    excludeFromMcp: true,
    visibility: { requiresMissionActiveRun: true },
    description:
      "Pause the current mission run or full-autonomous session until a wake time. " +
      "Use this when you have nothing productive to do right now but should resume later (waiting for a blockchain finality window, a price feed update, a scheduled check). " +
      "The user-facing explanation goes in the normal assistant message content; `reason` here is an internal resume hint for the wake banner. " +
      "Specify exactly one of `after_ms` (relative) or `wake_at` (absolute ISO8601). Only one pending wake per session — calling again before the first fires is a no-op.",
    parameters: {
      type: "object",
      properties: {
        after_ms: {
          type: "number",
          description:
            "Relative wake delay in milliseconds. Must be between 1000 (1s) and 86_400_000 (24h). Exactly one of after_ms / wake_at is required.",
        },
        wake_at: {
          type: "string",
          description:
            "Absolute wake time as an ISO8601 timestamp (e.g. 2026-04-20T10:00:00Z). Must be in the future. Exactly one of after_ms / wake_at is required.",
        },
        reason: {
          type: "string",
          description:
            "Internal resume hint (≤ 500 chars). NOT shown to the user. Surfaces later as the wake banner and feeds the recall seed.",
        },
      },
      required: ["reason"],
    },
  },
];
