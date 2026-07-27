/**
 * MISSION PRESETS — pre-written mission templates the operator can launch in
 * one click. A preset is purely a client-side seed for the EXISTING new-mission
 * draft flow: clicking a preset card creates a mission session, hands its
 * `goal` to the composer as the pending first message (the same hand-off
 * `SessionCreator` uses), and opens the mission contract modal so the operator
 * lands one tap from Accept + Run. Presets NEVER auto-accept or auto-run — the
 * host still reviews and signs the contract.
 *
 * A preset also carries an authoritative structured `draft` seed. On launch the
 * main process seeds the companion mission draft row from it through the
 * engine's validated `mission_draft_update` pipeline, so the mission contract
 * renders every field FILLED instead of "Still Missing" — the model no longer
 * has to parse title/capital/chains/protocols/risk/criteria/stops out of the
 * goal prose (which often left them blank). The `goal` prose is still sent (it
 * guides the agent's EXECUTION); the structured fields are the contract of
 * record. `allowedWallets` is intentionally omitted from the seed — the primary
 * trading wallet is bound at session creation and must never be surfaced here.
 *
 * The typed `constraints` block is retained as metadata for the card copy and
 * mirrors the seed's duration/spend/wallet.
 *
 * Adding a second preset later is a one-line append to `MISSION_PRESETS`.
 */

import type {
  MissionDraftSeed,
  SessionPermission,
} from "@shared/schemas/sessions.js";

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
  /** The mission goal text seeded into the composer (guides execution). */
  readonly goal: string;
  /**
   * Authoritative structured contract seed. Applied to the mission draft on
   * launch through the engine's validated pipeline so the contract renders
   * complete. Never includes `allowedWallets` (primary wallet is bound at
   * session creation).
   */
  readonly draft: MissionDraftSeed;
  /** Metadata mirror of the constraints the seed + goal text encode. */
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

/**
 * PONS Scalper structured contract seed. Values are authoritative and applied
 * verbatim (via the engine's validated sanitizer) so no field is left blank.
 *
 * `allowedChains` uses "Robinhood Chain" (NOT "Robinhood Chain (4663)"): the
 * engine's local chain resolver (`resolveLocalChainId`, used by mission
 * results capture on `allowedChains[0]`) matches the chain NAME/alias — the
 * parenthetical form is unresolvable. "Robinhood Chain" normalizes to the
 * registered alias and resolves to chain id 4663.
 */
const PONS_SCALPER_DRAFT: MissionDraftSeed = {
  title: "PONS Scalper",
  goal: PONS_SCALPER_GOAL,
  capitalSource: "primary wallet balance",
  startingCapital: "$20 (USD)",
  riskProfile: "aggressive",
  allowedChains: ["Robinhood Chain"],
  allowedProtocols: [
    "DexScreener (research)",
    "on-chain swap route (execution)",
  ],
  successCriteria: [
    "Sellability-gated single scalp: confirm a clean $20 in-and-out exit before any buy",
    "Set an 8% stop-loss AND a take-profit before entering the position",
    "At 2x with flow still expanding, sell only enough to recover initials and keep a 60-80% moonbag",
    "Trim or cut on a 25-35% drawdown from the local high or a support break",
    "Force-close all positions before the 60-minute deadline",
  ],
  stopConditions: [
    "deadline_reached: the 60-minute hard time-box has elapsed",
    "capital_depleted: the full $20 budget is spent",
    "max_loss_hit: the 8% stop-loss triggers",
    "no_viable_opportunity: nothing clears the sellability gate",
  ],
  durationMinutes: 60,
};

export const MISSION_PRESETS: readonly MissionPreset[] = [
  {
    id: "pons-scalper",
    title: "PONS Scalper",
    description: "Sellability-gated PONS runner scalp — $20, 1h.",
    permission: "full",
    goal: PONS_SCALPER_GOAL,
    draft: PONS_SCALPER_DRAFT,
    constraints: {
      durationMinutes: 60,
      spendCapUsd: 20,
      wallet: "primary",
    },
  },
];
