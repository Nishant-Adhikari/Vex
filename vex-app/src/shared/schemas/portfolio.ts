/**
 * Portfolio schemas — read-only dual-scope POSITION portfolio (stage 3).
 *
 * The renderer asks for either the GLOBAL inventory portfolio
 * (`{ scope: "global" }`), a single session's wallet-scope portfolio
 * (`{ scope: "session", sessionId }`), or the GLOBAL inventory NARROWED to
 * one of its own wallets (`{ scope: "global", walletAddress }` — the
 * welcome-screen per-wallet switcher, WP-L2). Main resolves the concrete
 * address allow-list server-side in every case: for a bare `global` request
 * that is the full config inventory; for a `global` request WITH
 * `walletAddress`, main validates the address against that SAME configured
 * inventory and rejects (`wallets.invalid_selection`) anything outside it —
 * a renderer-supplied address can only NARROW the read to one of the
 * caller's own already-configured wallets, never widen or redirect it.
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
 * quantity derived per row from `balance_raw / 10^decimals`. Token lines also
 * carry `tokenAddress` (nullable, optional/additive) — aggregation keys on
 * `(chain, normalized address)` server-side (symbol is display metadata,
 * never an aggregation key), so a spoofed token sharing a legitimate symbol
 * never coalesces into that token's line;
 * the renderer uses the address (never the self-declared symbol) to decide
 * whether a brand icon is authorized.
 */

import { z } from "zod";

/**
 * Token contract/mint address — the identity key that disambiguates two
 * DIFFERENT on-chain tokens sharing a self-declared symbol (the whole point
 * of this field: aggregation groups by address, never by symbol alone, so a
 * spoofed token cannot coalesce into a legitimate one's line). Bounded to
 * either shape addresses actually take in `proj_balances.token_address`: EVM
 * 0x-hex (40 hex chars) or Solana base58 (32-44 chars) — mirrors
 * `wallets/base-chain.ts`'s `evmAddressSchema`/`solanaAddressSchema` patterns
 * without importing them (this DTO field is chain-family-agnostic, unlike
 * those per-family wallet schemas). `null`/absent means the renderer could
 * not resolve an address for this line (older payload shape, or a
 * left-join miss in the per-chain breakdown) — it falls back to symbol-only
 * display with NO brand icon, never a fabricated address.
 */
const TOKEN_ADDRESS_MAX_LENGTH = 64;
const EVM_TOKEN_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_TOKEN_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const tokenAddressSchema = z
  .string()
  .max(TOKEN_ADDRESS_MAX_LENGTH)
  .refine(
    (value) =>
      EVM_TOKEN_ADDRESS_PATTERN.test(value) ||
      SOLANA_TOKEN_ADDRESS_PATTERN.test(value),
    { message: "Invalid token address." },
  );

/**
 * IPC input for `vex.portfolio.read`. Discriminated on `scope`:
 *  - `global`  — no `sessionId`; aggregates the whole configured inventory,
 *    OR (WP-L2) an OPTIONAL `walletAddress` narrows the read to that ONE
 *    inventory wallet — main validates it against the configured inventory
 *    before querying (see `portfolio-db.ts`); an address outside the
 *    inventory is rejected, never silently widened back to the aggregate.
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
 * malformed session input can never silently widen to global. `walletAddress`
 * is bounded only by length here — its real authorization is the server-side
 * inventory-membership check, not a format regex (addresses come in both EVM
 * hex and Solana base58 shapes).
 */
export const portfolioReadInputSchema = z.discriminatedUnion("scope", [
  z
    .object({
      scope: z.literal("global"),
      walletAddress: z.string().min(1).max(128).optional(),
    })
    .strict(),
  z.object({ scope: z.literal("session"), sessionId: z.string().uuid() }).strict(),
  z.object({ scope: z.literal("wallet"), walletAddress: z.string().min(1) }).strict(),
]);
export type PortfolioReadInput = z.infer<typeof portfolioReadInputSchema>;

/**
 * One aggregated position line — a single (chain, token, address) bucket
 * summed across every wallet in the resolved allow-list. `chainId` is `null`
 * when the DB chain id is absent or could not be coerced to a finite JS
 * number; `symbol` is `null` for rows without a token symbol. `balanceUsd` is
 * `null` for an UNPRICED holding (no price available); `amount` is the human
 * token quantity (per-row `balance_raw / 10^decimals`, summed AFTER the
 * division so mixed-decimals buckets stay correct), `null` when no row is
 * computable. `amount` defaults to `null` so pre-amount payloads still parse.
 * `tokenAddress` is additive and OPTIONAL (not defaulted): an older payload
 * missing the key entirely still parses, and the renderer treats a missing
 * key the same as an explicit `null` (no brand icon, symbol-only display).
 */
export const positionTokenDtoSchema = z
  .object({
    chainId: z.number().nullable(),
    symbol: z.string().max(64).nullable(),
    tokenAddress: tokenAddressSchema.nullable().optional(),
    balanceUsd: z.number().nullable(),
    amount: z.number().nullable().default(null),
  })
  .strict();
export type PositionTokenDto = z.infer<typeof positionTokenDtoSchema>;

/**
 * One token line inside a per-chain breakdown — like `positionTokenDtoSchema`
 * but WITHOUT `chainId` (the parent chain carries it). `balanceUsd` is
 * strictly positive when priced (the breakdown query drops priced-at-zero
 * lines) and `null` for an unpriced holding; `amount`/`tokenAddress` mirror
 * the flat line (see `positionTokenDtoSchema`).
 */
export const chainTokenDtoSchema = z
  .object({
    symbol: z.string().max(64).nullable(),
    tokenAddress: tokenAddressSchema.nullable().optional(),
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
  z
    .object({
      scope: z.literal("wallet"),
      walletAddress: z.string().min(1),
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
 *
 * FLOW-ADJUSTED RETURN (additive, back-compat defaults): the raw curve is real
 * balances, but the HEADLINE return must neutralise external cash flows —
 * naive `(last - first) / first` counts a withdrawal as a loss (the EVM-3 bug:
 * a wallet that pulled ~2 ETH out and traded up still showed -44%). These
 * fields carry the flow-aware figures the renderer displays:
 *  - `changePctTwr`         — Time-Weighted Return over the window, as a PERCENT
 *                             (e.g. 148.6 = +148.6%); `null` when < 2 points or
 *                             the flow data was unavailable (renderer falls back
 *                             to the naive percent it derives from `points`).
 *  - `netFlowUsd`           — Σ external native cash flows inside the window
 *                             (+deposit / −withdrawal), `0` when none/undetected.
 *  - `flowAdjustedChangeUsd`— `end − start − netFlowUsd`, the USD PnL with cash
 *                             flows removed; `null` when < 2 points.
 * All default so pre-flow-aware payloads still parse.
 */
export const portfolioSeriesDtoSchema = z
  .object({
    points: z.array(portfolioSeriesPointDtoSchema).max(5000),
    changePctTwr: z.number().nullable().default(null),
    netFlowUsd: z.number().default(0),
    flowAdjustedChangeUsd: z.number().nullable().default(null),
  })
  .strict();
export type PortfolioSeriesDto = z.infer<typeof portfolioSeriesDtoSchema>;
