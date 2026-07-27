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

const PONS_SCALPER_GOAL = `Run for 60 minutes, then stop. Cap TOTAL spend at $20.
Trade only the primary wallet on the Robinhood chain (PONS). Full autonomy: execute
yourself, don't wait for approval.

STRATEGY TAG: baseline v1.0

GOAL: find at most one PONS runner with confirmed sellability, enter one controlled
position, protect downside immediately, and recover initials at 2x before riding any
moonbag.

NON-NEGOTIABLE RULE: if clean exit cannot be confirmed before entry, do not buy. No
exceptions.

SELLABILITY GATE FIRST:
Before any buy, confirm all of the following:
- sell tax is near 0% and not extreme, blocked, or unknown
- a real sell quote exists now; a tiny test exit route is preferred
- liquidity is deep enough for a clean $20 entry and clean full exit with acceptable slippage
- DexScreener pair, swap route, and token contract address all resolve to the same active pool
- no duplicate-symbol confusion; official CA must be confirmed before buy

If any item fails or is ambiguous, avoid the token.

PONS RUNNER FILTER:
- market cap ideally under $100K; acceptable up to $300K only if liquidity and exit quality are clearly stronger
- avoid sub-$50K market cap unless liquidity quality is unusually strong and exit remains clean
- 5m buys > sells and 1h buys > sells
- 1h volume is meaningful relative to liquidity
- simple, understandable narrative
- recent price expansion is active, not already fully exhausted

ENTRY REQUIREMENTS:
Before entering, write:
- exact invalidation
- stop-loss
- take-profit plan
- 2x initials-out plan
- force-close deadline

RISK AND EXIT PLAN:
- one position only
- use a small fixed risk unit; for sub-$50K plays use minimum size
- never deploy the full mission bankroll into one token
- never average down
- set stop-loss before or immediately upon entry
- mandatory rule: at 2x, sell enough to recover 100% of initials immediately
- after initials are recovered, keep only a 60-80% moonbag if flow is still expanding
- trim or cut on a 25-35% drawdown from local high
- cut sooner on support break, flow deterioration, or liquidity deterioration
- if sell route weakens materially after entry, prioritize exit over thesis
- force-close before the 60-minute deadline regardless of PnL

NO-TRADE RULE:
If no token passes the sellability gate and runner filter, do not force a trade. Finish flat.

PRIORITY ORDER:
sellability > exit quality > liquidity > contract identity > live flow > market cap > narrative`;

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
    "Before entry, define invalidation, stop-loss, take-profit plan, and force-close deadline",
    "At 2x, recover 100% of initials immediately before managing any remaining moonbag",
    "Trim or cut on a 25-35% drawdown from the local high or a support break",
    "Force-close all positions before the 60-minute deadline",
  ],
  stopConditions: [
    "deadline_reached: the 60-minute hard time-box has elapsed",
    "capital_depleted: the full $20 budget is spent",
    "thesis_invalidated: stop-loss, support break, or liquidity deterioration invalidates the trade",
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
