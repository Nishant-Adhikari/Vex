import type { MissionResultRow } from "../../db/repos/mission-results.js";

export interface SimulatorTournamentScore {
  readonly score: number;
  readonly terminal: boolean;
}

function outcomeBonus(outcome: MissionResultRow["outcome"]): number {
  switch (outcome) {
    case "completed":
      return 6;
    case "timed_out":
      return 3;
    case "stopped":
      return -2;
    case "cancelled":
      return -4;
    case "failed":
      return -8;
    case "running":
    default:
      return 0;
  }
}

function stopReasonBonus(stopReason: string | null): number {
  switch (stopReason) {
    case "goal_reached":
      return 5;
    case "deadline_reached":
      return 2;
    case "max_loss_hit":
      return -6;
    case "capital_depleted":
      return -4;
    case "no_viable_opportunity":
      return -1;
    default:
      return 0;
  }
}

export function scoreSimulatorResult(
  row: MissionResultRow | null,
): SimulatorTournamentScore {
  if (row === null) return { score: Number.NEGATIVE_INFINITY, terminal: false };
  const terminal = row.outcome !== "running";
  if (!terminal) return { score: Number.NEGATIVE_INFINITY, terminal: false };

  const pnlPct = row.pnlPct ?? 0;
  const pnlEth = row.pnlEth ?? 0;
  const tradeShape = row.wins * 2 - row.losses * 2 - row.rotations * 0.5 - row.vetoes * 0.25;
  const score =
    pnlPct +
    pnlEth * 100 +
    tradeShape +
    outcomeBonus(row.outcome) +
    stopReasonBonus(row.stopReason);
  return { score, terminal: true };
}
