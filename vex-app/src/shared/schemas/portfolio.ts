/**
 * Portfolio schemas — read-only dual-scope POSITION portfolio (stage 3).
 *
 * The renderer asks for either the GLOBAL inventory portfolio
 * (`{ scope: "global" }`) or a single session's wallet-scope portfolio
 * (`{ scope: "session", sessionId }`). It NEVER supplies a wallet address —
 * main resolves the concrete address allow-list server-side (config
 * inventory for global, the session's wallet scope for session) so the
 * renderer can never widen the read past its own wallets.
 *
 * The discriminated union is the security boundary: a `session` request
 * without a valid `sessionId` is rejected at the `.strict()` parse and
 * MUST NEVER silently fall back to the (broader) global scope.
 *
 * DTO maps `proj_balances` (live per-token USD) + `proj_portfolio_snapshots`
 * (most recent complete snapshot group for the exact address set). All USD
 * figures are JS numbers coerced from `NUMERIC` columns; `chainId` tolerates
 * a `BIGINT` chain id that overflows the JS safe-integer range via `Number()`
 * (no value is fabricated — `null` when absent/unparseable). Token lines keep
 * `balanceUsd: null` for UNPRICED holdings (no price source — owner decision:
 * show the funds instead of hiding them) and carry `amount`, the human token
 * quantity derived per row from `balance_raw / 10^decimals`.
 */

import { z } from "zod";

/**
 * IPC input for `vex.portfolio.read`. Discriminated on `scope`:
 *  - `global`  — no `sessionId`; aggregates the whole configured inventory.
 *  - `session` — requires a UUID `sessionId`; aggregates only that
 *    session's selected wallets.
 *  - `wallet`  — a single configured inventory wallet (the per-wallet
 *    filter). The `walletAddress` is a renderer-supplied HINT ONLY: main
 *    resolves it against the configured inventory server-side and fails
 *    closed (empty allow-list) if it is not a configured wallet, so the
 *    renderer still can never widen the read past its own wallets.
 *
 * `.strict()` on each member rejects a stray `sessionId` on a global
 * request and a missing/invalid `sessionId` on a session request, so a
 * malformed session input can never silently widen to global.
 */
export const portfolioReadInputSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("global") }).strict(),
  z.object({ scope: z.literal("session"), sessionId: z.string().uuid() }).strict(),
  z.object({ scope: z.literal("wallet"), walletAddress: z.string().min(1) }).strict(),
]);
export type PortfolioReadInput = z.infer<typeof portfolioReadInputSchema>;

/**
 * One aggregated position line — a single (chain, token) bucket summed
 * across every wallet in the resolved allow-list. `chainId` is `null` when
 * the DB chain id is absent or could not be coerced to a finite JS number;
 * `symbol` is `null` for rows without a token symbol. `balanceUsd` is `null`
 * for an UNPRICED holding (no price available); `amount` is the human token
 * quantity (per-row `balance_raw / 10^decimals`, summed AFTER the division so
 * mixed-decimals buckets stay correct), `null` when no row is computable.
 * `amount` defaults to `null` so pre-amount payloads still parse.
 */
export const positionTokenDtoSchema = z
  .object({
    chainId: z.number().nullable(),
    symbol: z.string().max(64).nullable(),
    balanceUsd: z.number().nullable(),
    amount: z.number().nullable().default(null),
  })
  .strict();
export type PositionTokenDto = z.infer<typeof positionTokenDtoSchema>;

/**
 * One token line inside a per-chain breakdown — like `positionTokenDtoSchema`
 * but WITHOUT `chainId` (the parent chain carries it). `balanceUsd` is
 * strictly positive when priced (the breakdown query drops priced-at-zero
 * lines) and `null` for an unpriced holding; `amount` mirrors the flat line.
 */
export const chainTokenDtoSchema = z
  .object({
    symbol: z.string().max(64).nullable(),
    balanceUsd: z.number().positive().nullable(),
    amount: z.number().nullable().default(null),
  })
  .strict();
export type ChainTokenDto = z.infer<typeof chainTokenDtoSchema>;

/**
 * Per-chain position breakdown (the POSITION chain switcher's data source).
 * Built by a PURPOSE-BUILT query (window function over the full balance set —
 * NOT a post-process of the capped flat `tokens` list, which is bounded at
 * 500 rows and could silently drop chains). Invariants by construction:
 *
 *  - `totalUsd` is non-negative: 0 means the chain holds ONLY unpriced
 *    tokens (owner decision — funds show without a USD valuation rather
 *    than the chain disappearing);
 *  - `tokens` holds that chain's top holdings ranked usd DESC NULLS LAST,
 *    max 3, each either > $0 or unpriced (`balanceUsd: null`);
 *  - rows with a NULL `chain_id` stay in the legacy flat `tokens` field
 *    only — they can't be attributed to a chain switcher entry;
 *  - `family` derives from the chain id (the Khalani synthetic Solana id
 *    vs everything-else-EVM, see `@shared/chains/display.js`).
 */
export const positionChainDtoSchema = z
  .object({
    chainId: z.number(),
    family: z.enum(["evm", "solana"]),
    totalUsd: z.number().nonnegative(),
    tokens: z.array(chainTokenDtoSchema).max(3),
  })
  .strict();
export type PositionChainDto = z.infer<typeof positionChainDtoSchema>;

/**
 * Portfolio read result for one scope.
 *
 *  - `walletCount`     — number of resolved addresses in the allow-list
 *                        (0 → empty portfolio returned BEFORE any SQL).
 *  - `liveTotalUsd`    — current summed USD across `proj_balances` for the
 *                        resolved addresses (0 when no balance rows).
 *  - `snapshotTotalUsd`/`pnlVsPrev`/`snapshotAt` — the most recent COMPLETE
 *                        snapshot group covering exactly the resolved address
 *                        set; all `null` when no such snapshot exists.
 *  - `tokens`          — per-(chain,token) live lines, biggest USD first,
 *                        capped at 500 (defensive bound, never expected to hit).
 *                        `balanceUsd: null` marks an unpriced holding.
 *  - `chains`          — per-chain breakdown for the chain switcher:
 *                        non-negative totals (0 = unpriced-only chain),
 *                        top-3 tokens each, bounded at 64 chains.
 */
export const portfolioDtoSchema = z
  .object({
    scope: z.enum(["global", "session", "wallet"]),
    walletCount: z.number().int().nonnegative(),
    liveTotalUsd: z.number(),
    snapshotTotalUsd: z.number().nullable(),
    pnlVsPrev: z.number().nullable(),
    snapshotAt: z.string().datetime({ offset: true }).nullable(),
    tokens: z.array(positionTokenDtoSchema).max(500),
    chains: z.array(positionChainDtoSchema).max(64),
  })
  .strict();
export type PortfolioDto = z.infer<typeof portfolioDtoSchema>;

/**
 * Time window for the portfolio value time-series (the dashboard equity
 * curve). A fixed enum — main maps each member to a bounded SQL interval
 * literal, so the range never reaches a query as free-form user text.
 */
export const portfolioRangeSchema = z.enum(["1D", "1W", "1M", "ALL"]);
export type PortfolioRange = z.infer<typeof portfolioRangeSchema>;

/**
 * IPC input for `vex.portfolio.series`. Mirrors `portfolioReadInputSchema`'s
 * scope discrimination (the same server-side allow-list security boundary),
 * but each member ALSO carries a `range`. `.strict()` on each member keeps a
 * malformed session input from silently widening to global (and rejects a
 * stray `sessionId` on a global request).
 */
export const portfolioSeriesInputSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("global"), range: portfolioRangeSchema }).strict(),
  z
    .object({
      scope: z.literal("session"),
      sessionId: z.string().uuid(),
      range: portfolioRangeSchema,
    })
    .strict(),
]);
export type PortfolioSeriesInput = z.infer<typeof portfolioSeriesInputSchema>;

/**
 * One point on the equity curve — a single COMPLETE snapshot group's total
 * USD across the resolved address set at its capture time. `t` is an ISO
 * timestamp (offset-bearing); `totalUsd` is the summed group total.
 */
export const portfolioSeriesPointDtoSchema = z
  .object({
    t: z.string().datetime({ offset: true }),
    totalUsd: z.number(),
  })
  .strict();
export type PortfolioSeriesPointDto = z.infer<
  typeof portfolioSeriesPointDtoSchema
>;

/**
 * Portfolio value time-series result — the ordered equity-curve points for
 * one scope + range. Bounded at 5000 points (defensive cap, never expected
 * to hit); an empty scope resolves to `{ points: [] }` before any SQL.
 */
export const portfolioSeriesDtoSchema = z
  .object({
    points: z.array(portfolioSeriesPointDtoSchema).max(5000),
  })
  .strict();
export type PortfolioSeriesDto = z.infer<typeof portfolioSeriesDtoSchema>;
