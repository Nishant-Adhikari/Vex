/**
 * Strategy Discipline prompt injection — pure, config-driven.
 *
 * Turns the optional `strategyDiscipline` config section into the mission-run
 * instruction lines for ONLY the rules that are enabled. Every rule is an
 * independent toggle, all default OFF, so an absent section (or an absent
 * field) emits nothing and mission behavior is unchanged.
 *
 * Pure by design: no I/O, no clock, no globals — it just maps a validated
 * config object to strings. The caller (`buildMissionRunPrompt`) is responsible
 * for reading the config fresh at prompt-build time.
 */

import type { StrategyDiscipline } from "@config/store.js";

/**
 * The enabled rules' instruction lines, in a stable order. Empty array when no
 * rule is enabled (or the section is absent). Each line is a self-contained
 * bullet the model can act on.
 */
export function buildStrategyDisciplineLines(
  config: StrategyDiscipline | undefined,
): string[] {
  if (!config) return [];

  const lines: string[] = [];

  if (config.requireThesis === true) {
    lines.push(
      "- THESIS (required): before ANY entry, state a one-line thesis — what you expect to happen and why, right now.",
    );
  }

  if (config.requireInvalidation === true) {
    lines.push(
      "- INVALIDATION (required): before ANY entry, state an explicit invalidation condition — the concrete, checkable trigger that means the thesis is wrong and you must exit. If you cannot state a real invalidation, DO NOT enter.",
    );
  }

  if (typeof config.minSignalsToAgree === "number" && config.minSignalsToAgree > 0) {
    const n = config.minSignalsToAgree;
    lines.push(
      `- SIGNAL AGREEMENT (required): require at least ${n} independent signal${n === 1 ? "" : "s"} to AGREE before entering (e.g. upward momentum, genuine 24h volume, liquidity depth, a Signal-Radar mention). If fewer than ${n} agree, skip and stay flat.`,
    );
  }

  if (config.requirePositionSizeRationale === true) {
    lines.push(
      "- POSITION SIZE (required): before entering, state the position size and WHY — the risk you are taking per trade.",
    );
  }

  if (typeof config.maxHoldMinutes === "number" && config.maxHoldMinutes > 0) {
    const m = config.maxHoldMinutes;
    lines.push(
      `- MAX HOLD (required): never hold a single position longer than ${m} minute${m === 1 ? "" : "s"} — exit by then regardless of level.`,
    );
  }

  return lines;
}

/**
 * The full `## Strategy Discipline` prompt block for the enabled rules, or ""
 * when nothing is enabled (so the caller can omit the section entirely).
 */
export function buildStrategyDisciplineSection(
  config: StrategyDiscipline | undefined,
): string {
  const lines = buildStrategyDisciplineLines(config);
  if (lines.length === 0) return "";

  return [
    "## Strategy Discipline",
    "These trade-discipline rules are active for this run. Follow every one before and during any entry.",
    ...lines,
  ].join("\n");
}
