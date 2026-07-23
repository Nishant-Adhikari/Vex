/**
 * MISSION PRESETS — pre-written mission templates the operator can launch in
 * one click. A preset is purely a client-side seed for the EXISTING new-mission
 * draft flow: clicking a preset card creates a mission session, hands its
 * `goal` to the composer as the pending first message (the same hand-off
 * `SessionCreator` uses), and opens the mission contract modal so the operator
 * lands one tap from Accept + Run. Presets NEVER auto-accept or auto-run — the
 * host still reviews and signs the contract.
 *
 * Constraints (duration, spend cap, wallet) are carried by the GOAL TEXT
 * itself, not by structured session fields — session creation has no such
 * inputs, and mission constraints are parsed from the goal by the agent. The
 * typed `constraints` block is retained as metadata for the card copy and to
 * keep a future structured-draft path trivial; it is not sent over IPC.
 *
 * Adding a second preset later is a one-line append to `MISSION_PRESETS`.
 */

import type { SessionPermission } from "@shared/schemas/sessions.js";

export interface MissionPresetConstraints {
  /** Hard time box in minutes — baked into the goal text. */
  readonly durationMinutes: number;
  /** Hard total spend cap in USD — baked into the goal text. */
  readonly spendCapUsd: number;
  /** Which wallet the mission may touch. Missions use the primary wallet only. */
  readonly wallet: "primary";
}

export interface MissionPreset {
  /** Stable id (used as React key + test selector). */
  readonly id: string;
  /** Card title + the created session's name. */
  readonly title: string;
  /** One-line card description. */
  readonly description: string;
  /**
   * Permission axis the created session is locked to. PONS Scalper runs with
   * full autonomy ("execute yourself, don't wait for approval").
   */
  readonly permission: SessionPermission;
  /** The mission goal text seeded into the composer (carries all constraints). */
  readonly goal: string;
  /** Metadata mirror of the constraints the goal text encodes. */
  readonly constraints: MissionPresetConstraints;
}

const PONS_SCALPER_GOAL = `Run for 60 minutes, then stop. Cap TOTAL spend at $20 — never risk more than that.
Trade only the primary wallet on the Robinhood chain (PONS). Full autonomy: execute
yourself, don't wait for approval.

GOAL: catch one fast-moving PONS runner and manage it with a moonbag.

SELLABILITY GATE — CHECK FIRST, BEFORE ANY BUY: a token that pumps but can't be sold
is a LOSS. Before buying confirm: sell tax near 0% (reject extreme/unknown); a real
sell/exit quote exists (a tiny test route is ideal); liquidity deep enough for a clean
$20 in AND out; DexScreener pair, trading route, and token CA all point to the SAME
active pool. If it pumps but you can't confirm a clean exit → AVOID, regardless of
market cap. Priority: sellability > liquidity > contract identity > flow > market cap
> narrative.

FIND: check the Signal Radar feed first; else DexScreener PONS movers. Require MC
ideally under $100K (accept under $300K), 5m & 1h buys beating sells, 1h volume
meaningful vs liquidity, simple narrative. Verify official CA; on a duplicate symbol
don't buy until confirmed.

EXECUTE: one position, tiny for sub-$50K degen plays. Set stop-loss -8% and a
take-profit before entering; write invalidation + trim zones. At 2x with flow still
expanding, sell only enough to recover initials, keep 60-80% moonbag. Trim/cut on a
25-35% drawdown from the local high or a support break. Never average down.
Force-close before the 60-minute deadline — never leave an unmanaged bag.`;

export const MISSION_PRESETS: readonly MissionPreset[] = [
  {
    id: "pons-scalper",
    title: "PONS Scalper",
    description: "Sellability-gated PONS runner scalp — $20, 1h.",
    permission: "full",
    goal: PONS_SCALPER_GOAL,
    constraints: {
      durationMinutes: 60,
      spendCapUsd: 20,
      wallet: "primary",
    },
  },
];
