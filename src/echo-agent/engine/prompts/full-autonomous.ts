/**
 * Full autonomous prompt — variable layer, for sessionKind="full_autonomous".
 *
 * Fills the gap in buildPromptStack (no previous layer explained this mode).
 * Narrates the plan/execute/defer rhythm, clarifies the tool contract (no
 * `mission_stop` because there is no mission; `loop_defer` is the primary
 * "rest" signal), and injects any runtime context the runner has gathered —
 * reused from `resolveRecallSeed` data so we don't double-fetch.
 */

import type { EngineContext } from "../types.js";

export interface FullAutonomousContext {
  /** Open workstream snippets pulled from the last N session episodes. */
  openLoops: string[];
  /** Recent episode titles — short headline for what you were last doing. */
  recentEpisodeTitles: string[];
  /** Count of iterations accumulated across this session (not per-turn-loop). */
  iterationCountInSession?: number;
  /** If resumed by wake, the reason recorded on the wake row. */
  wakeReason?: string;
}

export function buildFullAutonomousPrompt(
  _engineContext: EngineContext,
  faContext?: FullAutonomousContext,
): string {
  const lines: string[] = [];

  lines.push("# Full Autonomous Rhythm");
  lines.push("");
  lines.push("You operate without a bounded mission. Your cadence is plan → execute →");
  lines.push("rest → return. Work in cycles, not straight lines. Two rules:");
  lines.push("");
  lines.push("- When a phase completes (or you hit a natural pause), call");
  lines.push("  `loop_defer(dueAt, reason)`. The wake executor resumes you at the");
  lines.push("  scheduled time. Between defers, be decisive — don't iterate idly.");
  lines.push("- If context pressure is high (warning / critical band), call");
  lines.push("  `checkpoint_handoff_prepare` before defer to compact what you know.");
  lines.push("");

  lines.push("## Tool contract");
  lines.push("");
  lines.push("- `mission_stop` is NOT available — there is no mission to stop.");
  lines.push("- `loop_defer` is your \"park until later\" signal. Use natural completion");
  lines.push("  points, not fixed intervals — defer when the current phase is resolved.");
  lines.push("- If you reach `iteration_limit` without deferring, the session fails open");
  lines.push("  and stays stuck until a user message arrives. Prefer explicit `loop_defer`.");
  lines.push("");

  if (faContext) {
    const hasRecent = faContext.recentEpisodeTitles.length > 0;
    const hasLoops = faContext.openLoops.length > 0;
    const hasWake = faContext.wakeReason && faContext.wakeReason.length > 0;
    const hasIter = typeof faContext.iterationCountInSession === "number";

    if (hasRecent || hasLoops || hasWake || hasIter) {
      lines.push("## Where you left off");
      lines.push("");

      if (hasWake) {
        lines.push(`Resumed by wake. Reason: ${faContext.wakeReason}`);
        lines.push("");
      }

      if (hasRecent) {
        lines.push("Recent episodes:");
        for (const title of faContext.recentEpisodeTitles) {
          lines.push(`- ${title}`);
        }
        lines.push("");
      }

      if (hasLoops) {
        lines.push("Open loops (unfinished threads from recent episodes):");
        for (const loop of faContext.openLoops) {
          lines.push(`- ${loop}`);
        }
        lines.push("");
      }

      if (hasIter) {
        lines.push(`Iterations accumulated in this session: ${faContext.iterationCountInSession}`);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}
