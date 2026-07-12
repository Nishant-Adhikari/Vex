import { z } from "zod";

/**
 * Mission results ledger — read DTO + `mission.listResults` contract.
 *
 * One row per finalized mission run (see engine migration 038). PNL is in ETH
 * (native + WETH bankroll delta, netting gas/fees); USD prices are display-only.
 * `openPositionsCount` is the number of non-ETH bags still held at close (kept
 * out of the PNL figure).
 */
export const missionResultDtoSchema = z
  .object({
    missionRunId: z.string(),
    seqNo: z.number().int(),
    goalSnippet: z.string().nullable(),
    walletAddress: z.string(),
    chainId: z.number().int(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    durationS: z.number().nullable(),
    bankrollStartEth: z.number().nullable(),
    bankrollEndEth: z.number().nullable(),
    pnlEth: z.number().nullable(),
    pnlPct: z.number().nullable(),
    ethPriceUsdStart: z.number().nullable(),
    ethPriceUsdEnd: z.number().nullable(),
    trades: z.number().int(),
    outcome: z.string(),
    openPositionsCount: z.number().int(),
  })
  .strict();

export type MissionResultDto = z.infer<typeof missionResultDtoSchema>;

export const missionListResultsInputSchema = z
  .object({ limit: z.number().int().min(1).max(200).optional() })
  .strict();

export type MissionListResultsInput = z.infer<typeof missionListResultsInputSchema>;

export const missionListResultsResultSchema = z.array(missionResultDtoSchema);

export type MissionListResultsResult = z.infer<typeof missionListResultsResultSchema>;
