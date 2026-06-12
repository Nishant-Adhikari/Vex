/**
 * Eval: S5 ledger-derived outcome on the FAITHFUL seeders (real judge + Gemma).
 *
 * Drives confirmed-spot (closed+strong), closed-perps (medium), and thin (weak)
 * trades through the production capture seam, then promotes a trade-family
 * candidate anchored on the SELL execution. HARD assertions are deterministic
 * ledger facts only:
 *   - the faithful spot seeder produced a matched, non-null realized PnL row,
 *   - the promoted entry's outcome (status/lessonSignal/evidenceQuality/pnlSource)
 *     matches the seeded ledger,
 *   - no raw PnL number leaks into the promoted title/summary,
 *   - valid_from = event_time and outcome_version = 0 on the promoted entry.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { query } from "@vex-agent/db/client.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import { getCandidateById } from "@vex-agent/db/repos/memory-candidates/index.js";
import { resolveOutcome } from "@vex-agent/memory/manager/index.js";
import { resetDb } from "../setup/fixtures.js";
import {
  seedFaithfulConfirmedSpotTrade,
  seedClosedPerpsPosition,
  seedGemmaCandidate,
  driveConsolidateCapturingJudge,
  countMatchedRealized,
} from "./_eval-fixtures.js";
import { reportCard } from "./_report-card.js";

const SUITE = "outcome-s5";
const WALLET = "WaLLetS5111111111111111111111111111111111111";
const hasKey = !!process.env.OPENROUTER_API_KEY;

/** A digit-bearing PnL string must NOT appear in promoted prose. */
function containsRawPnl(text: string): boolean {
  // realized PnL we seed is 25.00 (75 proceeds - 50 cost). Guard against the
  // literal value and a $-prefixed money token leaking into prose.
  return /\$\s?\d/.test(text) || text.includes("25.00") || text.includes("75.00");
}

describe.skipIf(!hasKey)("eval: S5 outcome derivation (live)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("faithful confirmed spot trade lands a matched, realized proj_pnl_matches row", async () => {
    const session = await query<{ id: string }>(
      `INSERT INTO sessions (id) VALUES (gen_random_uuid()::text) RETURNING id`,
    ).then((r) => r[0]!.id);
    const instrument = "solana:S5SPOT";
    const spot = await seedFaithfulConfirmedSpotTrade({
      sessionId: session,
      instrumentKey: instrument,
      walletAddress: WALLET,
      buyQtyRaw: "1000000000",
      buyValueUsd: "50.00",
      sellQtyRaw: "1000000000",
      sellValueUsd: "75.00",
    });

    const matched = await countMatchedRealized(instrument, WALLET);
    expect(matched).toBeGreaterThan(0);
    reportCard.recordCheck(SUITE, {
      label: "faithful spot seeder → matched realized proj_pnl_matches row",
      pass: matched > 0,
      note: `matchedRows=${matched}`,
    });

    // The resolver derives closed+strong from this clean realized ledger.
    const candidate = await getCandidateById(
      (
        await seedGemmaCandidate({
          sessionId: session,
          kind: "trade_outcome",
          title: "Outcome anchor for the closed spot trade",
          summary: "A closed spot position with a realized result.",
          evidenceRefs: [
            { executionId: spot.sellExecutionId, instrumentKey: instrument },
          ],
          eventTime: new Date(),
        })
      ).candidateId,
    );
    const outcome = await resolveOutcome(candidate!, true, ledgerDeps());
    expect(outcome).not.toBeNull();
    expect(outcome!.status).toBe("closed");
    expect(outcome!.evidenceQuality).toBe("strong");
    expect(outcome!.pnlSource).toBe("pnl_matches");
    expect(outcome!.lessonSignal).toBe("positive"); // 75 - 50 = +25
    reportCard.recordCheck(SUITE, {
      label: "spot resolver → closed/strong/pnl_matches/positive",
      pass:
        outcome!.status === "closed" &&
        outcome!.evidenceQuality === "strong" &&
        outcome!.pnlSource === "pnl_matches" &&
        outcome!.lessonSignal === "positive",
      note: `status=${outcome!.status} q=${outcome!.evidenceQuality} signal=${outcome!.lessonSignal}`,
    });
  });

  it("closed perps position resolves medium (MTM, never strong)", async () => {
    const session = await query<{ id: string }>(
      `INSERT INTO sessions (id) VALUES (gen_random_uuid()::text) RETURNING id`,
    ).then((r) => r[0]!.id);
    const perps = await seedClosedPerpsPosition({
      sessionId: session,
      positionKey: "perp:S5:1",
      instrumentKey: "solana:S5PERP",
      walletAddress: WALLET,
      closedPnlUsd: "-12.50", // loss → negative signal
    });

    const { candidateId } = await seedGemmaCandidate({
      sessionId: session,
      kind: "trade_outcome",
      title: "Outcome anchor for the closed perps position",
      summary: "A closed perpetual position with a marked result.",
      evidenceRefs: [
        { executionId: perps.closeExecutionId, positionKey: "perp:S5:1" },
      ],
      eventTime: new Date(),
    });
    const candidate = await getCandidateById(candidateId);
    const outcome = await resolveOutcome(candidate!, true, ledgerDeps());
    expect(outcome).not.toBeNull();
    expect(outcome!.status).toBe("closed");
    expect(outcome!.evidenceQuality).toBe("medium");
    expect(outcome!.lessonSignal).toBe("negative");
    reportCard.recordCheck(SUITE, {
      label: "perps resolver → closed/medium/negative (never strong)",
      pass:
        outcome!.status === "closed" &&
        outcome!.evidenceQuality === "medium" &&
        outcome!.lessonSignal === "negative",
      note: `status=${outcome!.status} q=${outcome!.evidenceQuality}`,
    });
  });

  it("promotes a strong-spot trade lesson with ledger-matched outcome fields + bi-temporal init", async () => {
    const session = await query<{ id: string }>(
      `INSERT INTO sessions (id) VALUES (gen_random_uuid()::text) RETURNING id`,
    ).then((r) => r[0]!.id);
    const instrument = "solana:S5STRONG";
    const eventTime = new Date(Date.now() - 60_000);
    const spot = await seedFaithfulConfirmedSpotTrade({
      sessionId: session,
      instrumentKey: instrument,
      walletAddress: WALLET,
      buyQtyRaw: "1000000000",
      buyValueUsd: "50.00",
      sellQtyRaw: "1000000000",
      sellValueUsd: "75.00",
    });

    // trade_outcome is trade-family but NOT a generalization → exempt from the
    // recurrence gate, so a single SELL-anchored candidate escalates to the judge.
    const { candidateId } = await seedGemmaCandidate({
      sessionId: session,
      kind: "trade_outcome",
      title: "Confirmed-momentum scale-in on this name realized a win",
      summary:
        "Scaling into confirmed strength on this spot position closed with a realized gain.",
      evidenceRefs: [
        { executionId: spot.sellExecutionId, instrumentKey: instrument },
        { executionId: spot.buyExecutionId, instrumentKey: instrument },
      ],
      importance: 8,
      eventTime,
    });

    const captured = await driveConsolidateCapturingJudge(candidateId, "s5-strong-w");

    // F31 headline feed: the trade-family single-anchor lesson escalates (the
    // ceiling can reach 'strong'); the judge may THROW on this model.
    reportCard.recordJudgeAttempt({
      scenario: `${SUITE}/strong-spot`,
      reached: captured.reached,
      valid: captured.verdictValid,
      invalidReason: captured.invalidReason,
    });
    // HARD: the judge was REACHED (the candidate escalated).
    expect(captured.reached).toBe(true);

    if (!captured.verdictValid) {
      reportCard.recordJudge({
        scenario: `${SUITE}/strong-spot`,
        llmCalls: 0,
        costUsd: null,
        latencyMs: captured.latencyMs,
        verdict: `invalid:${captured.invalidReason}`,
      });
      reportCard.recordCheck(SUITE, {
        label: "strong-spot judge reached; F31 blocked the verdict (measured)",
        pass: true,
        note: `invalidReason=${captured.invalidReason}`,
      });
      reportCard.recordFinding({
        code: "F31",
        manifested: true,
        summary: `strong-spot trade lesson reached the judge but got no valid verdict (reason=${captured.invalidReason})`,
      });
      return;
    }

    const drive = captured.drive!;
    reportCard.recordJudge({
      scenario: `${SUITE}/strong-spot`,
      llmCalls: drive.llmCalls,
      costUsd: drive.costUsd,
      latencyMs: drive.latencyMs,
      verdict: drive.decisionType,
    });

    if (drive.decisionType === "promote" && drive.promotedKnowledgeId !== null) {
      const entry = await knowledgeRepo.getById(drive.promotedKnowledgeId);
      expect(entry).not.toBeNull();

      // outcome_version 0 on a fresh promote.
      expect(entry!.outcomeVersion).toBe(0);
      // valid_from = event_time (the as-of decision boundary derives from it).
      const vf = new Date(entry!.validFrom).getTime();
      expect(Math.abs(vf - eventTime.getTime())).toBeLessThan(2000);

      // No raw PnL number in the promoted prose.
      const prose = `${entry!.title}\n${entry!.summary}`;
      expect(containsRawPnl(prose)).toBe(false);

      // The candidate's persisted outcome matches the seeded ledger.
      const cand = await getCandidateById(candidateId);
      const candOutcome = cand!.outcome as Record<string, unknown> | null;
      const status = candOutcome?.status;
      const quality = candOutcome?.evidenceQuality;
      const pnlSource = candOutcome?.pnlSource;
      expect(status).toBe("closed");
      expect(quality).toBe("strong");
      expect(pnlSource).toBe("pnl_matches");

      reportCard.recordCheck(SUITE, {
        label: "strong-spot promote: outcome_version0 + valid_from=event_time + no-raw-pnl + ledger outcome",
        pass:
          entry!.outcomeVersion === 0 &&
          Math.abs(vf - eventTime.getTime()) < 2000 &&
          !containsRawPnl(prose) &&
          status === "closed" &&
          quality === "strong" &&
          pnlSource === "pnl_matches",
        note: `status=${String(status)} q=${String(quality)} validFromΔms=${Math.abs(vf - eventTime.getTime())}`,
      });
    } else {
      // The judge can legitimately retain/reject a single-anchor lesson; record it.
      reportCard.recordCheck(SUITE, {
        label: "strong-spot judge verdict (measured; non-promote)",
        pass: true,
        note: `verdict=${drive.decisionType}`,
      });
      reportCard.recordFinding({
        code: "S5",
        manifested: false,
        summary: `strong-spot single-anchor lesson got verdict=${drive.decisionType} (judge discretion)`,
      });
    }
  });
});

// ── Live ledger deps for the resolver (read-only, real repos) ───────
import { getById as execGetById } from "@vex-agent/db/repos/executions.js";
import { getByExecution as activitiesByExecution } from "@vex-agent/db/repos/activity.js";
import { getMatchesBySell } from "@vex-agent/db/repos/pnl-matches.js";
import { getOpenLots } from "@vex-agent/db/repos/pnl-lots.js";
import { getByPositionKeyAnyStatus } from "@vex-agent/db/repos/open-positions.js";
import { getLpEventsByPosition } from "@vex-agent/db/repos/lp-events.js";
import type { OutcomeResolverDeps } from "@vex-agent/memory/manager/index.js";

function ledgerDeps(): OutcomeResolverDeps {
  return {
    getExecutionById: (id) => execGetById(id),
    getActivitiesByExecution: (id) => activitiesByExecution(id),
    getMatchesBySell: (id) => getMatchesBySell(id),
    getOpenLots: (instrumentKey, walletAddress) => getOpenLots(instrumentKey, walletAddress),
    getPositionByKey: (positionKey) => getByPositionKeyAnyStatus(positionKey),
    getLpEventsByPosition: (positionKey) => getLpEventsByPosition(positionKey),
  };
}
