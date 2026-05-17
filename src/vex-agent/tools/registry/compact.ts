/**
 * Compact tools — PR2 cutover.
 *
 * `compact_now` is the agent-driven entry point for compaction. Hidden when
 * pressure band is below `barrier` (≥ 88% of context limit) via
 * `pressureSafety: "compact_only"` + `visibility.band: "critical"` (uses
 * existing band gate; critical here means "at-or-past barrier" because the
 * old visibility.band enum had only "warning" | "critical" and we map our
 * 4-band system onto the existing soft filter).
 *
 * Dispatcher hard-deny gives the strict semantics: at barrier/critical the
 * tool dispatches; below it the dispatcher returns an error. The visibility
 * band gate is the soft layer that keeps the LLM's catalog clean.
 */

import type { ToolDef } from "../types.js";

export const COMPACT_TOOLS: readonly ToolDef[] = [
  {
    name: "compact_now",
    kind: "internal",
    mutating: false,
    pressureSafety: "compact_only",
    surface: "agent",
    excludeRoles: ["subagent"],
    visibility: { band: "barrier" },
    description: [
      "Compact the conversation when the context-pressure banner says ACTION REQUIRED (≥ 88% of context limit).",
      "Three arguments:",
      " - conversation_summary (REQUIRED, ≤4000 chars): YOUR understanding of what happened. Goal, decisions, current state, recent outcomes. Replaces the rolling summary wholesale; write it for your post-compact self.",
      " - preserve_md (optional, ≤2000 chars): hard-priority facts that MUST survive — open loops, pending decisions, key entities. Surfaced in the resume packet immediately after compact.",
      " - thread_themes_hints (optional, 1-3 items, each ≤500 chars): suggested theme labels for chunking. The chunker may override generic hints; specific themes (e.g. 'kyber_quote_timeout_pattern', 'wif_position_unwind_signal') survive validation.",
      "Behavior: this call archives the conversation prefix to long-term storage, bumps the checkpoint generation, and enqueues an async Track 2 chunking job. The next turn after this tool runs will inject a deterministic resume packet (rolling summary + open loops + last decisions + last tool outcomes) for ~2 cycles.",
      "DO NOT include live snapshots (balances, prices, gas, intent IDs) — those are queryable via wallet_read / evm_read / quote tools and would just become stale in the rolling summary.",
      "DO include: mission state, decision rationale, observed patterns, lessons, open follow-ups, user signals.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        conversation_summary: {
          type: "string",
          description:
            "≤ 4000 chars. Your full-context understanding of the conversation: mission goal, decisions, current state, recent tool outcomes. Will become the new rolling summary verbatim.",
        },
        preserve_md: {
          type: "string",
          description:
            "≤ 2000 chars (optional). Hard-priority facts the next session MUST remember — open loops, pending decisions, key entities (wallet addresses, market ids).",
        },
        thread_themes_hints: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional 1-3 thematic labels. Specific is better than generic — 'kyber_quote_timeout_pattern' good, 'debug' rejected.",
        },
      },
      required: ["conversation_summary"],
      additionalProperties: false,
    },
  },
];
