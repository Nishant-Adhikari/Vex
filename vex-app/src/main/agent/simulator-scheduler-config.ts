/**
 * Simulator scheduler configuration — resolves the hands-free paper-mission
 * scheduler's settings from the environment (the Settings UI can override the
 * same shape later; the resolver is the single source of truth).
 *
 * DISABLED BY DEFAULT. Nothing runs unless `VEX_SIM_SCHEDULER_ENABLED` is
 * truthy. This keeps the accumulate-lots-of-data loop strictly opt-in.
 *
 * Env vars:
 *   VEX_SIM_SCHEDULER_ENABLED           "1"/"true"/"yes"/"on" → on (default off)
 *   VEX_SIM_SCHEDULER_INTERVAL_MINUTES  launch cadence (default 30, min 1)
 *   VEX_SIM_SCHEDULER_MAX_CONCURRENT    concurrency cap (default 1, min 1)
 *   VEX_SIM_SCHEDULER_WALLET            placeholder sim wallet address (label
 *                                       only — a sim run never signs)
 *   VEX_SIM_SCHEDULER_GOAL              optional goal-text override
 */

/** Placeholder wallet used to label sim ledger rows. A sim run never signs. */
const DEFAULT_SIM_WALLET = "0x5100000000000000000000000000000000000051";

const DEFAULT_SIM_GOAL = `SIMULATOR run — paper trade only, no real funds. Run for 60 minutes then stop; cap
notional at $20. Trade on the Robinhood chain (PONS). Full autonomy.

GOAL: find one fast-moving PONS runner, enter a small paper position, and manage it.

SELLABILITY GATE FIRST: before any buy confirm a clean exit (sell tax near 0%, a real
sell/exit quote exists, liquidity deep enough for $20 in AND out). If you cannot
confirm a clean exit, AVOID.

EXECUTE: one position. Set a stop-loss and a take-profit before entering. At 2x with
flow still expanding, sell enough to recover initials and keep a moonbag. Trim or cut
on a 25-35% drawdown from the local high. Force-close before the 60-minute deadline.`;

export interface SimulatorSchedulerConfig {
  readonly enabled: boolean;
  readonly intervalMinutes: number;
  readonly maxConcurrent: number;
  readonly walletAddress: string;
  readonly goal: string;
}

function truthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function posInt(v: string | undefined, fallback: number, min: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

/** Resolve the scheduler config from the process environment. */
export function resolveSimulatorSchedulerConfig(
  env: NodeJS.ProcessEnv = process.env,
): SimulatorSchedulerConfig {
  return {
    enabled: truthy(env.VEX_SIM_SCHEDULER_ENABLED),
    intervalMinutes: posInt(env.VEX_SIM_SCHEDULER_INTERVAL_MINUTES, 30, 1),
    maxConcurrent: posInt(env.VEX_SIM_SCHEDULER_MAX_CONCURRENT, 1, 1),
    walletAddress: env.VEX_SIM_SCHEDULER_WALLET?.trim() || DEFAULT_SIM_WALLET,
    goal: env.VEX_SIM_SCHEDULER_GOAL?.trim() || DEFAULT_SIM_GOAL,
  };
}

/**
 * Build the mission-draft seed for a scheduled simulator mission. Mirrors the
 * `MissionDraftSeed` shape a preset uses, but ALWAYS carries a non-empty
 * `allowedWallets` (the placeholder sim address) so the draft reaches `ready`
 * without a real wallet selection.
 */
export function buildSimulatorMissionSeed(config: SimulatorSchedulerConfig): Record<string, unknown> {
  return {
    title: "Simulator — PONS paper scalp",
    goal: config.goal,
    capitalSource: "simulator (paper) balance",
    startingCapital: "$20 (paper)",
    riskProfile: "aggressive",
    allowedWallets: [config.walletAddress],
    allowedChains: ["Robinhood Chain"],
    allowedProtocols: [
      "DexScreener (research)",
      "on-chain swap route (execution)",
    ],
    successCriteria: [
      "Sellability-gated single paper scalp: confirm a clean $20 in-and-out exit before any buy",
      "Set a stop-loss AND a take-profit before entering the position",
      "At 2x with flow still expanding, recover initials and keep a moonbag",
      "Force-close all positions before the 60-minute deadline",
    ],
    stopConditions: [
      "deadline_reached: the 60-minute hard time-box has elapsed",
      "capital_depleted: the full $20 paper budget is spent",
      "no_viable_opportunity: nothing clears the sellability gate",
    ],
    durationMinutes: 60,
  };
}
