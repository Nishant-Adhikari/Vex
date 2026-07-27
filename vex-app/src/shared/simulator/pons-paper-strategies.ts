export interface PonsPaperStrategyProfile {
  readonly id: string;
  readonly name: string;
  readonly shortRule: string;
  readonly promptDelta: string;
}

export const BASELINE_PROMPT_VERSION = "v1.0";
export const BASELINE_STRATEGY_ID = "baseline";
export const BASELINE_STRATEGY_NAME = "Current baseline";

export const PONS_PAPER_STRATEGIES: readonly PonsPaperStrategyProfile[] = [
  {
    id: "ironclad",
    name: "Ironclad",
    shortRule: "Strict sellability and liquidity-first gate.",
    promptDelta:
      "Strategy profile: IRONCLAD. Be the strictest on sellability and exit proof. Reject if the sell route is unclear, liquidity is shallow, or the active pool identity is ambiguous. Prefer fewer trades over sketchy trades.",
  },
  {
    id: "falcon",
    name: "Falcon",
    shortRule: "Faster entry once exit proof is already clear.",
    promptDelta:
      "Strategy profile: FALCON. Keep all safety gates, but once clean sellability and same-pool identity are confirmed, bias toward earlier entry on strengthening flow instead of waiting for extra narrative confirmation.",
  },
  {
    id: "widow",
    name: "Widow",
    shortRule: "Mandatory initial-out at 2x and tighter trims.",
    promptDelta:
      "Strategy profile: WIDOW. Trade management is the edge. Mandatory rule: if price reaches 2x and flow has not collapsed, immediately sell enough to recover initials. Then protect the remaining moonbag aggressively on drawdown.",
  },
  {
    id: "strange",
    name: "Strange",
    shortRule: "Maximum duplicate-symbol and CA identity discipline.",
    promptDelta:
      "Strategy profile: STRANGE. Contract identity discipline comes before momentum. On any duplicate symbol or conflicting CA / pair / route evidence, do not enter until the exact active pool is confirmed beyond doubt.",
  },
  {
    id: "ghost",
    name: "Ghost",
    shortRule: "Rug-defense bias with harsher low-cap rejection.",
    promptDelta:
      "Strategy profile: GHOST. Favor rug defense over upside. Avoid sub-$50K market cap unless exit proof, liquidity depth, and same-pool identity are all unusually strong. Cut faster when liquidity or route quality deteriorates.",
  },
] as const;

export const DEFAULT_SIMULATOR_DURATION_MINUTES = 120;
export const DEFAULT_SIMULATOR_WALLET_ADDRESS =
  "0x5100000000000000000000000000000000000051";
export const STRATEGY_TAG_PREFIX = "STRATEGY TAG:";

export function strategyForOrdinal(
  ordinal: number,
): PonsPaperStrategyProfile | null {
  return PONS_PAPER_STRATEGIES[ordinal - 1] ?? null;
}

export function buildPonsPaperStrategySeed(
  strategy: PonsPaperStrategyProfile,
  durationMinutes = DEFAULT_SIMULATOR_DURATION_MINUTES,
): Record<string, unknown> {
  const hours = Math.max(1, Math.round(durationMinutes / 60));
  return {
    title: `PONS paper scalp — ${strategy.name}`,
    goal: `SIMULATOR run — paper trade only, no real funds. Run for ${durationMinutes} minutes then stop; cap notional at $20. Trade on the Robinhood chain (PONS). Full autonomy.
${STRATEGY_TAG_PREFIX} paper ${strategy.id}

GOAL: find at most one PONS runner with confirmed sellability, enter one controlled paper position, protect downside immediately, and recover initials at 2x before riding any moonbag.

NON-NEGOTIABLE RULE: if clean exit cannot be confirmed before entry, do not buy. No exceptions.

SELLABILITY GATE FIRST: before any buy confirm all of the following: sell tax near 0% and not extreme/blocked/unknown; a real sell quote exists now; liquidity is deep enough for a clean $20 entry and full exit with acceptable slippage; DexScreener pair, route, and token CA all point to the same active pool; no duplicate-symbol confusion remains. If any item fails or is ambiguous, avoid it.

PONS RUNNER FILTER: market cap ideally under $100K; acceptable up to $300K only if liquidity and exit quality are clearly stronger. Avoid sub-$50K market cap unless liquidity quality is unusually strong and exit remains clean. Require 5m buys > sells, 1h buys > sells, 1h volume meaningful versus liquidity, and a simple narrative.

ENTRY REQUIREMENTS: before entering, write exact invalidation, stop-loss, take-profit plan, 2x initials-out plan, and force-close deadline.

RISK AND EXIT PLAN: one position only. Use a small fixed risk unit; for sub-$50K plays use minimum size. Never deploy the full paper bankroll into one token. Never average down. Set stop-loss before or immediately upon entry. At 2x, recover 100% of initials immediately. After initials are recovered, keep only a 60-80% moonbag if flow is still expanding. Trim or cut on a 25-35% drawdown from local high. Cut sooner on support break, flow deterioration, or liquidity deterioration. Force-close before the ${durationMinutes}-minute deadline regardless of PnL.

NO-TRADE RULE: if no token passes the sellability gate and runner filter, do not force a trade. Finish flat.

${strategy.promptDelta}`,
    capitalSource: "simulator (paper) balance",
    startingCapital: "$20 (paper)",
    riskProfile: "aggressive",
    allowedWallets: [DEFAULT_SIMULATOR_WALLET_ADDRESS],
    allowedChains: ["Robinhood Chain"],
    allowedProtocols: ["Signal Radar", "DexScreener", "on-chain swap route"],
    successCriteria: [
      "Choose exactly one PONS runner only after clean exit proof exists",
      "Apply the strategy profile without weakening sellability or identity guardrails",
      "Recover initials at 2x when flow is still expanding",
      `Force-close every paper position before ${hours}h expires`,
    ],
    stopConditions: [
      `deadline_reached: the ${durationMinutes}-minute hard time-box has elapsed`,
      "capital_depleted: the full $20 paper budget is spent",
      "no_viable_opportunity: nothing clears the sellability gate",
    ],
    durationMinutes,
  };
}

export function buildPonsLiveStrategySeed(
  strategy: PonsPaperStrategyProfile,
  durationMinutes = DEFAULT_SIMULATOR_DURATION_MINUTES,
  version = "v1.1",
): Record<string, unknown> {
  const hours = Math.max(1, Math.round(durationMinutes / 60));
  return {
    title: `PONS live scalp — ${strategy.name}`,
    goal: `LIVE mission. Trade real funds on the Robinhood chain (PONS). Full autonomy for ${durationMinutes} minutes with a hard stop at the deadline.
${STRATEGY_TAG_PREFIX} ${strategy.id} ${version}

GOAL: find at most one PONS runner with confirmed sellability, enter one controlled position, protect downside immediately, and recover initials at 2x before riding any moonbag.

NON-NEGOTIABLE RULE: if clean exit cannot be confirmed before entry, do not buy. No exceptions.

SELLABILITY GATE FIRST: before any buy confirm all of the following: sell tax near 0% and not extreme/blocked/unknown; a real sell quote exists now; liquidity is deep enough for a clean $20 entry and full exit with acceptable slippage; DexScreener pair, route, and token CA all point to the same active pool; no duplicate-symbol confusion remains. If any item fails or is ambiguous, avoid it.

PONS RUNNER FILTER: market cap ideally under $100K; acceptable up to $300K only if liquidity and exit quality are clearly stronger. Avoid sub-$50K market cap unless liquidity quality is unusually strong and exit remains clean. Require 5m buys > sells, 1h buys > sells, 1h volume meaningful versus liquidity, and a simple narrative.

ENTRY REQUIREMENTS: before entering, write exact invalidation, stop-loss, take-profit plan, 2x initials-out plan, and force-close deadline.

RISK AND EXIT PLAN: one position only. Use a small fixed risk unit; for sub-$50K plays use minimum size. Never deploy the full mission bankroll into one token. Never average down. Set stop-loss before or immediately upon entry. At 2x, recover 100% of initials immediately. After initials are recovered, keep only a 60-80% moonbag if flow is still expanding. Trim or cut on a 25-35% drawdown from local high. Cut sooner on support break, flow deterioration, or liquidity deterioration. If sell route weakens materially after entry, prioritize exit over thesis. Force-close before the ${durationMinutes}-minute deadline regardless of PnL.

NO-TRADE RULE: if no token passes the sellability gate and runner filter, do not force a trade. Finish flat.

${strategy.promptDelta}`,
    capitalSource: "selected live wallet",
    startingCapital: "$20 live",
    riskProfile: "aggressive",
    allowedChains: ["Robinhood Chain"],
    allowedProtocols: ["Signal Radar", "DexScreener", "on-chain swap route"],
    successCriteria: [
      "Choose exactly one live PONS runner only after clean exit proof exists",
      "Apply the promoted strategy profile without weakening sellability or identity guardrails",
      "Recover initials at 2x when flow is still expanding",
      `Force-close every live position before ${hours}h expires`,
    ],
    stopConditions: [
      `deadline_reached: the ${durationMinutes}-minute hard time-box has elapsed`,
      "capital_depleted: the full live budget is spent",
      "no_viable_opportunity: nothing clears the sellability gate",
    ],
    durationMinutes,
  };
}

export function buildPonsLiveBaselineSeed(
  durationMinutes = DEFAULT_SIMULATOR_DURATION_MINUTES,
): Record<string, unknown> {
  const hours = Math.max(1, Math.round(durationMinutes / 60));
  return {
    title: "PONS live scalp — Baseline",
    goal: `LIVE mission. Trade real funds on the Robinhood chain (PONS). Full autonomy for ${durationMinutes} minutes with a hard stop at the deadline.
${STRATEGY_TAG_PREFIX} baseline ${BASELINE_PROMPT_VERSION}

GOAL: find at most one PONS runner with confirmed sellability, enter one controlled position, protect downside immediately, and recover initials at 2x before riding any moonbag.

NON-NEGOTIABLE RULE: if clean exit cannot be confirmed before entry, do not buy. No exceptions.

SELLABILITY GATE FIRST: before any buy confirm all of the following: sell tax near 0% and not extreme/blocked/unknown; a real sell quote exists now; liquidity is deep enough for a clean $20 entry and full exit with acceptable slippage; DexScreener pair, route, and token CA all point to the same active pool; no duplicate-symbol confusion remains. If any item fails or is ambiguous, avoid it.

PONS RUNNER FILTER: market cap ideally under $100K; acceptable up to $300K only if liquidity and exit quality are clearly stronger. Avoid sub-$50K market cap unless liquidity quality is unusually strong and exit remains clean. Require 5m buys > sells, 1h buys > sells, 1h volume meaningful versus liquidity, and a simple narrative.

ENTRY REQUIREMENTS: before entering, write exact invalidation, stop-loss, take-profit plan, 2x initials-out plan, and force-close deadline.

RISK AND EXIT PLAN: one position only. Use a small fixed risk unit; for sub-$50K plays use minimum size. Never deploy the full mission bankroll into one token. Never average down. Set stop-loss before or immediately upon entry. At 2x, recover 100% of initials immediately. After initials are recovered, keep only a 60-80% moonbag if flow is still expanding. Trim or cut on a 25-35% drawdown from local high. Cut sooner on support break, flow deterioration, or liquidity deterioration. If sell route weakens materially after entry, prioritize exit over thesis. Force-close before the ${durationMinutes}-minute deadline regardless of PnL.

NO-TRADE RULE: if no token passes the sellability gate and runner filter, do not force a trade. Finish flat.`,
    capitalSource: "selected live wallet",
    startingCapital: "$20 live",
    riskProfile: "aggressive",
    allowedChains: ["Robinhood Chain"],
    allowedProtocols: ["Signal Radar", "DexScreener", "on-chain swap route"],
    successCriteria: [
      "Choose exactly one live PONS runner only after clean exit proof exists",
      "Keep sellability, liquidity, and same-pool identity ahead of narrative",
      "Recover initials at 2x when flow is still expanding",
      `Force-close every live position before ${hours}h expires`,
    ],
    stopConditions: [
      `deadline_reached: the ${durationMinutes}-minute hard time-box has elapsed`,
      "capital_depleted: the full live budget is spent",
      "no_viable_opportunity: nothing clears the sellability gate",
    ],
    durationMinutes,
  };
}

export function buildPonsPaperBaselineSeed(
  durationMinutes = 60,
): Record<string, unknown> {
  return {
    ...buildPonsLiveBaselineSeed(durationMinutes),
    title: "PONS paper scalp — Baseline",
    capitalSource: "simulator (paper) balance",
    startingCapital: "$20 (paper)",
    allowedWallets: [DEFAULT_SIMULATOR_WALLET_ADDRESS],
    goal: `SIMULATOR run — paper trade only, no real funds. Run for ${durationMinutes} minutes then stop; cap notional at $20. Trade on the Robinhood chain (PONS). Full autonomy.
${STRATEGY_TAG_PREFIX} paper baseline

GOAL: find at most one PONS runner with confirmed sellability, enter one controlled paper position, protect downside immediately, and recover initials at 2x before riding any moonbag.

NON-NEGOTIABLE RULE: if clean exit cannot be confirmed before entry, do not buy. No exceptions.

SELLABILITY GATE FIRST: before any buy confirm all of the following: sell tax near 0% and not extreme/blocked/unknown; a real sell quote exists now; liquidity is deep enough for a clean $20 entry and full exit with acceptable slippage; DexScreener pair, route, and token CA all point to the same active pool; no duplicate-symbol confusion remains. If any item fails or is ambiguous, avoid it.

PONS RUNNER FILTER: market cap ideally under $100K; acceptable up to $300K only if liquidity and exit quality are clearly stronger. Avoid sub-$50K market cap unless liquidity quality is unusually strong and exit remains clean. Require 5m buys > sells, 1h buys > sells, 1h volume meaningful versus liquidity, and a simple narrative.

ENTRY REQUIREMENTS: before entering, write exact invalidation, stop-loss, take-profit plan, 2x initials-out plan, and force-close deadline.

RISK AND EXIT PLAN: one position only. Use a small fixed risk unit; for sub-$50K plays use minimum size. Never deploy the full paper bankroll into one token. Never average down. Set stop-loss before or immediately upon entry. At 2x, recover 100% of initials immediately. After initials are recovered, keep only a 60-80% moonbag if flow is still expanding. Trim or cut on a 25-35% drawdown from local high. Cut sooner on support break, flow deterioration, or liquidity deterioration. Force-close before the ${durationMinutes}-minute deadline regardless of PnL.

NO-TRADE RULE: if no token passes the sellability gate and runner filter, do not force a trade. Finish flat.`,
  };
}
