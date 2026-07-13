/**
 * Portfolio DB helper — read-only dual-scope POSITION portfolio (stage 3).
 *
 * Mirrors `usage-db.ts` / `sessions-db.ts` decoupling: own `pg.Client` per
 * call, no `@vex-agent/db/repos/*` import. Reads the same local `vex`
 * Postgres the engine writes to, against:
 *
 *   proj_balances(wallet_address TEXT, chain_id BIGINT, token_symbol TEXT,
 *                 balance_raw TEXT, decimals INTEGER, balance_usd NUMERIC)
 *   proj_portfolio_snapshots(wallet_family eip155|solana, wallet_address TEXT,
 *                 snapshot_group_id UUID, total_usd NUMERIC,
 *                 pnl_vs_prev NUMERIC, created_at)
 *
 * SECURITY (non-negotiable):
 *  - GLOBAL is an EXPLICIT address allow-list. EVERY SELECT carries
 *    `WHERE wallet_address = ANY($1::text[])` with a bound, finite array.
 *    The filter is never omitted.
 *  - addresses.length === 0 → return the EMPTY DTO BEFORE issuing any SQL
 *    (no wallets configured, or empty session scope). Fail closed.
 *  - addresses are resolved SERVER-SIDE (config inventory / session scope);
 *    a renderer-supplied address is never accepted.
 *  - join key between inventory and balances is the raw ADDRESS string —
 *    DO NOT lowercase (the engine stores raw checksum/base58 addresses).
 *  - logging records sessionId (if any) + wallet COUNT + token COUNT only;
 *    NEVER raw addresses, balances, or USD figures.
 */

import { Client, type ClientConfig } from "pg";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import type {
  PortfolioDto,
  PortfolioReadInput,
  PortfolioSeriesDto,
  PortfolioSeriesInput,
  PositionChainDto,
  PositionTokenDto,
} from "@shared/schemas/portfolio.js";
import { familyForChainId } from "@shared/chains/display.js";
import { listWallets } from "@vex-lib/wallet.js";
import { listLocalChains } from "@tools/evm-chains/registry.js";
import { getNativeCashFlows } from "@vex-agent/analytics/native-cash-flows.js";
import {
  timeWeightedReturn,
  netFlowAdjustedPnlUsd,
  type Point,
  type Flow,
} from "@vex-agent/analytics/twr.js";
import { getSessionWalletScope } from "./sessions-db.js";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

// `correlationId` intentionally omitted; `registerHandler` stamps
// `ctx.requestId` downstream. Mirrors `usage-db.ts`.
function dbUnavailable(): Result<never, VexError> {
  return err({
    code: "internal.unexpected",
    domain: "portfolio",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
  });
}

function dbError(reason: string, cause?: unknown): Result<never, VexError> {
  log.warn(`[portfolio-db] ${reason}`, cause);
  return err({
    code: "internal.unexpected",
    domain: "portfolio",
    message: "Unable to load portfolio.",
    retryable: true,
    userActionable: false,
    redacted: true,
  });
}

async function withClient<T>(
  fn: (client: Client) => Promise<Result<T, VexError>>,
): Promise<Result<T, VexError>> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[portfolio-db] buildPoolConfig threw", cause);
    return dbUnavailable();
  }
  if (cfg === null) return dbUnavailable();

  const clientConfig: ClientConfig = {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  };
  const client = new Client(clientConfig);
  try {
    await client.connect();
  } catch (cause) {
    log.warn("[portfolio-db] client.connect failed", cause);
    return dbUnavailable();
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[portfolio-db] client.end failed (non-fatal)", cause);
    }
  }
}

interface LiveTotalRow {
  readonly live: number | string | null;
}

interface TokenRow {
  readonly chain_id: number | string | null;
  readonly token_symbol: string | null;
  readonly usd: number | string | null;
  readonly amount: number | string | null;
}

interface SnapshotRow {
  readonly total: number | string | null;
  readonly at: string | Date | null;
}

interface SeriesPointRow {
  readonly total: number | string | null;
  readonly at: string | Date | null;
}

interface ChainBreakdownRow {
  readonly chain_id: number | string;
  readonly chain_total: number | string;
  readonly token_symbol: string | null;
  readonly token_usd: number | string | null;
  readonly token_amount: number | string | null;
}

/**
 * Human token QUANTITY for one balance row: `balance_raw / 10^decimals`,
 * computed PER ROW inside the aggregate (mixed-decimals buckets must divide
 * before summing). The CASE guard keeps a NULL-decimals or malformed
 * `balance_raw` row as a NULL contribution (SUM skips it) instead of failing
 * the whole query on a bad cast — SUM over only-NULL rows yields NULL, which
 * the DTO carries as `amount: null` (nothing fabricated).
 */
const AMOUNT_SUM_SQL = `SUM(
              CASE WHEN decimals IS NOT NULL AND balance_raw ~ '^[0-9]+$'
                   THEN balance_raw::numeric / power(10::numeric, decimals)
              END
            )::float8`;

/**
 * Cap on per-(chain, token) holding lines. Matches the `portfolioDtoSchema`
 * `tokens` `.max(500)` so the response can never overflow the output-schema
 * bound (a >cap wallet set would otherwise 500-error the whole panel via the
 * handler's output validation). Enforced in BOTH the SQL LIMIT and a TS slice.
 */
const MAX_TOKEN_LINES = 500;

/**
 * Caps for the per-chain breakdown — mirror `portfolioDtoSchema.chains`
 * (`.max(64)` chains, `.max(3)` tokens each). The SQL emits at most
 * 64 chains × ≤3 token rows; TS slices defensively to the same bounds.
 */
const MAX_BREAKDOWN_CHAINS = 64;
const MAX_CHAIN_TOKENS = 3;

/**
 * Assemble `PositionChainDto[]` from the breakdown query's flat rows
 * (one row per surviving (chain, top-token) pair, chain totals repeated,
 * ordered chain-total DESC then chain id ASC then token rank ASC — the
 * chain-id tie-breaker keeps equal-total chains CONTIGUOUS, which this
 * single-pass grouper depends on; codex final review). Rows arrive
 * pre-filtered: non-negative chain totals (0 = a chain holding ONLY unpriced
 * tokens — owner decision: still shown), token lines either positive-USD or
 * UNPRICED (NULL usd, amount carried when computable), NULL chain_id
 * excluded.
 */
function buildChainBreakdown(
  rows: readonly ChainBreakdownRow[],
): PositionChainDto[] {
  const chains: PositionChainDto[] = [];
  let current: {
    chainId: number;
    totalUsd: number;
    tokens: { symbol: string | null; balanceUsd: number | null; amount: number | null }[];
  } | null = null;
  for (const row of rows) {
    const chainId = toChainId(row.chain_id);
    const totalUsd = toNumber(row.chain_total);
    // Defensive: the SQL already excludes NULL chain ids and cannot emit a
    // negative total; a row that still fails coercion is dropped, not
    // fabricated. Zero totals are KEPT (unpriced-only chain).
    if (chainId === null || totalUsd < 0) continue;
    if (current === null || current.chainId !== chainId) {
      if (current !== null) {
        chains.push({
          chainId: current.chainId,
          family: familyForChainId(current.chainId),
          totalUsd: current.totalUsd,
          tokens: current.tokens,
        });
        if (chains.length >= MAX_BREAKDOWN_CHAINS) return chains;
      }
      current = { chainId, totalUsd, tokens: [] };
    }
    const tokenUsd = toNumberOrNull(row.token_usd);
    const tokenAmount = toNumberOrNull(row.token_amount);
    // A LEFT-JOIN miss (chain with no rankable lines) emits all-NULL token
    // columns — skip it. Real lines are either priced (> $0 by the ranked
    // filter; defensively re-checked) or UNPRICED (NULL usd) and kept so
    // held funds stay visible without a valuation.
    const hasTokenRow =
      row.token_symbol !== null || tokenUsd !== null || tokenAmount !== null;
    if (
      hasTokenRow &&
      (tokenUsd === null || tokenUsd > 0) &&
      current.tokens.length < MAX_CHAIN_TOKENS
    ) {
      current.tokens.push({
        symbol: row.token_symbol,
        balanceUsd: tokenUsd,
        amount: tokenAmount,
      });
    }
  }
  if (current !== null && chains.length < MAX_BREAKDOWN_CHAINS) {
    chains.push({
      chainId: current.chainId,
      family: familyForChainId(current.chainId),
      totalUsd: current.totalUsd,
      tokens: current.tokens,
    });
  }
  return chains;
}

/**
 * `NUMERIC`/`float8` columns come back from `pg` as strings or numbers. We
 * coerce to a finite JS number, falling back to `0` for the never-null
 * SUM totals (the SQL `COALESCE(...,0)::float8` already guarantees a value).
 */
function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Like `toNumber` but preserves the "absent" distinction as `null`. */
function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `chain_id` is a `BIGINT` that may exceed the JS safe-integer range; `pg`
 * returns it as a string. We coerce via `Number()` and tolerate loss of
 * precision (the renderer uses it as an opaque grouping key, not for
 * arithmetic). `null` when absent or unparseable — no fabricated 0.
 */
function toChainId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function emptyPortfolio(scope: PortfolioReadInput["scope"]): PortfolioDto {
  return {
    scope,
    walletCount: 0,
    liveTotalUsd: 0,
    snapshotTotalUsd: null,
    pnlVsPrev: null,
    snapshotAt: null,
    tokens: [],
    chains: [],
  };
}

/**
 * Resolve the server-side wallet address allow-list for the requested scope.
 *
 *  - `global`  — the configured EVM + Solana inventory (≤6 addresses).
 *  - `session` — the session's selected EVM/Solana wallets (≤2 addresses).
 *    A failed scope read propagates as an error (fail closed); an empty
 *    scope resolves to `[]` (→ empty DTO before SQL).
 *
 * Addresses are returned as raw strings (NO lowercasing) so the
 * `proj_balances.wallet_address` join matches the engine's stored form.
 */
async function resolveAddresses(
  input: PortfolioReadInput,
): Promise<Result<readonly string[], VexError>> {
  if (input.scope === "global") {
    const entries = [...listWallets("evm"), ...listWallets("solana")];
    // Dedupe: the snapshot-completeness guard compares COUNT(DISTINCT
    // wallet_address) against addresses.length, so a repeated address in the
    // configured inventory would otherwise spuriously drop the snapshot total.
    return ok([...new Set(entries.map((e) => e.address))]);
  }
  if (input.scope === "wallet") {
    // Single-wallet scope (the per-wallet filter). The renderer-supplied
    // `walletAddress` is a HINT, never trusted directly: resolve it against
    // the SAME configured inventory `global` uses and return it ONLY IF it is
    // an exact member of that set — otherwise fail closed (`[]` → empty DTO).
    // Raw-string match, NO lowercasing (mirror global; the engine stores raw
    // checksum/base58 addresses). This keeps the "renderer can never widen
    // past its own wallets" invariant intact for the widened input schema.
    const entries = [...listWallets("evm"), ...listWallets("solana")];
    const inventory = new Set(entries.map((e) => e.address));
    return ok(inventory.has(input.walletAddress) ? [input.walletAddress] : []);
  }
  const scope = await getSessionWalletScope(input.sessionId);
  if (!scope.ok) return scope;
  const addrs = [scope.data.evm?.address, scope.data.solana?.address].filter(
    (a): a is string => typeof a === "string",
  );
  return ok([...new Set(addrs)]);
}

/**
 * Read the dual-scope POSITION portfolio for the requested scope.
 *
 * Returns the EMPTY DTO (no SQL issued) when the resolved allow-list is
 * empty. Otherwise aggregates `proj_balances` (live total + per-token lines)
 * and the most recent COMPLETE `proj_portfolio_snapshots` group covering
 * exactly the resolved address set.
 */
export async function getPortfolio(
  input: PortfolioReadInput,
): Promise<Result<PortfolioDto, VexError>> {
  const resolved = await resolveAddresses(input);
  if (!resolved.ok) return resolved;
  const addresses = resolved.data;

  // Fail closed: no wallets → empty portfolio BEFORE any SQL.
  if (addresses.length === 0) {
    return ok(emptyPortfolio(input.scope));
  }

  const addrParam = [...addresses];

  return withClient(async (client) => {
    try {
      // (a) Live total USD across all resolved addresses.
      const liveResult = await client.query<LiveTotalRow>(
        `SELECT COALESCE(SUM(balance_usd), 0)::float8 AS live
           FROM proj_balances
          WHERE wallet_address = ANY($1::text[])`,
        [addrParam],
      );
      const liveTotalUsd = toNumber(liveResult.rows[0]?.live);

      // (b) Per-(chain, token) live lines, biggest USD first, capped at
      // MAX_TOKEN_LINES so the response stays inside the output-schema bound.
      // `usd` stays NULL for an UNPRICED holding (no COALESCE — the renderer
      // shows the amount with an em dash instead of a fabricated $0.00);
      // `amount` is the human token quantity (see AMOUNT_SUM_SQL).
      const tokensResult = await client.query<TokenRow>(
        `SELECT chain_id,
                token_symbol,
                SUM(balance_usd)::float8 AS usd,
                ${AMOUNT_SUM_SQL} AS amount
           FROM proj_balances
          WHERE wallet_address = ANY($1::text[])
          GROUP BY chain_id, token_symbol
          ORDER BY usd DESC NULLS LAST
          LIMIT ${MAX_TOKEN_LINES}`,
        [addrParam],
      );
      const tokens: PositionTokenDto[] = tokensResult.rows
        .slice(0, MAX_TOKEN_LINES)
        .map((row) => ({
          chainId: toChainId(row.chain_id),
          symbol: row.token_symbol,
          balanceUsd: toNumberOrNull(row.usd),
          amount: toNumberOrNull(row.amount),
        }));

      // (b2) Per-chain breakdown for the POSITION chain switcher — a
      // PURPOSE-BUILT window query over the FULL balance set (Codex plan
      // review: post-processing the capped flat query above would silently
      // drop chains once the 500-row bound bites). Invariants pushed into
      // SQL: NULL chain ids excluded (legacy `tokens` still carries them),
      // EVERY funded chain survives — a chain holding only UNPRICED tokens
      // totals 0 instead of disappearing (owner decision: show funds without
      // a valuation) — and each chain contributes its top-${MAX_CHAIN_TOKENS}
      // lines ranked usd DESC NULLS LAST (positive-USD first, then unpriced;
      // priced-at-zero lines are dropped).
      const breakdownResult = await client.query<ChainBreakdownRow>(
        `WITH lines AS (
           SELECT chain_id,
                  token_symbol,
                  SUM(balance_usd)::float8 AS usd,
                  ${AMOUNT_SUM_SQL} AS amount
             FROM proj_balances
            WHERE wallet_address = ANY($1::text[])
              AND chain_id IS NOT NULL
            GROUP BY chain_id, token_symbol
         ),
         ranked AS (
           SELECT chain_id, token_symbol, usd, amount,
                  ROW_NUMBER() OVER (
                    PARTITION BY chain_id ORDER BY usd DESC NULLS LAST
                  ) AS rn
             FROM lines
            WHERE usd > 0 OR usd IS NULL
         ),
         totals AS (
           SELECT chain_id, COALESCE(SUM(usd), 0)::float8 AS chain_total
             FROM lines
            GROUP BY chain_id
            ORDER BY chain_total DESC
            LIMIT ${MAX_BREAKDOWN_CHAINS}
         )
         SELECT t.chain_id,
                t.chain_total,
                r.token_symbol,
                r.usd AS token_usd,
                r.amount AS token_amount
           FROM totals t
           LEFT JOIN ranked r
             ON r.chain_id = t.chain_id AND r.rn <= ${MAX_CHAIN_TOKENS}
          ORDER BY t.chain_total DESC, t.chain_id ASC, r.rn ASC NULLS LAST`,
        [addrParam],
      );
      const chains = buildChainBreakdown(breakdownResult.rows);

      // (c) PnL across COMPLETE snapshot cycles: the latest TWO groups that
      // cover EXACTLY the resolved address set (HAVING COUNT(DISTINCT)=N — a
      // partial group for a subset of the wallets is ignored). Aggregate PnL is
      // `latest.total − previous.total`, NOT SUM(pnl_vs_prev): per-wallet PnL
      // baselines don't compose into a correct set total (and miss wallets with
      // no prior row). snapshot/PnL are null when the cycle(s) are absent.
      const snapshotResult = await client.query<SnapshotRow>(
        `SELECT snapshot_group_id,
                SUM(total_usd)::float8 AS total,
                MAX(created_at)        AS at
           FROM proj_portfolio_snapshots
          WHERE wallet_address = ANY($1::text[])
          GROUP BY snapshot_group_id
         HAVING COUNT(DISTINCT wallet_address) = $2
          ORDER BY at DESC
          LIMIT 2`,
        [addrParam, addresses.length],
      );
      const latest = snapshotResult.rows[0];
      const previous = snapshotResult.rows[1];
      const snapshotTotalUsd = latest ? toNumberOrNull(latest.total) : null;
      const previousTotalUsd = previous ? toNumberOrNull(previous.total) : null;
      const pnlVsPrev =
        snapshotTotalUsd !== null && previousTotalUsd !== null
          ? snapshotTotalUsd - previousTotalUsd
          : null;
      const snapshotAt = latest && latest.at !== null ? toIso(latest.at) : null;

      log.info(
        `[portfolio-db] getPortfolio ok scope=${input.scope} ` +
          `wallets=${addresses.length} tokens=${tokens.length} ` +
          `chains=${chains.length} snapshot=${latest !== undefined}`,
      );

      return ok({
        scope: input.scope,
        walletCount: addresses.length,
        liveTotalUsd,
        snapshotTotalUsd,
        pnlVsPrev,
        snapshotAt,
        tokens,
        chains,
      });
    } catch (cause) {
      return dbError("getPortfolio query failed", cause);
    }
  });
}

/**
 * Range → Postgres INTERVAL literal. A FIXED map keyed by the
 * `portfolioRangeSchema` enum — the interval string is interpolated into the
 * query from THIS table ONLY, never from user input, so no free-form text can
 * reach the SQL. `ALL` uses a 100-year window as a practical "no lower bound".
 */
const SERIES_RANGE_INTERVAL: Record<PortfolioSeriesInput["range"], string> = {
  "1D": "24 hours",
  "1W": "7 days",
  "1M": "30 days",
  ALL: "100 years",
};

/**
 * Read the portfolio VALUE time-series (the dashboard equity curve) for the
 * requested scope + range.
 *
 * Each point is one COMPLETE snapshot group — a group covering EXACTLY the
 * resolved address set (`HAVING COUNT(DISTINCT wallet_address) = N`, the same
 * invariant `getPortfolio` uses for its snapshot total). A partial group for a
 * subset of the wallets is ignored, so the curve never mixes in an
 * incomplete-cycle total. Points are ordered oldest → newest.
 *
 * Returns `{ points: [] }` (no SQL issued) when the resolved allow-list is
 * empty. Fails closed.
 */
export async function getPortfolioSeries(
  input: PortfolioSeriesInput,
): Promise<Result<PortfolioSeriesDto, VexError>> {
  const readInput: PortfolioReadInput =
    input.scope === "global"
      ? { scope: "global" }
      : input.scope === "wallet"
        ? { scope: "wallet", walletAddress: input.walletAddress }
        : { scope: "session", sessionId: input.sessionId };
  const resolved = await resolveAddresses(readInput);
  if (!resolved.ok) return resolved;
  const addresses = resolved.data;

  // Fail closed: no wallets → empty series BEFORE any SQL.
  if (addresses.length === 0) {
    return ok({ points: [], changePctTwr: null, netFlowUsd: 0, flowAdjustedChangeUsd: null });
  }

  const addrParam = [...addresses];
  const interval = SERIES_RANGE_INTERVAL[input.range];

  return withClient(async (client) => {
    try {
      // One row per COMPLETE snapshot group inside the window: total USD across
      // the resolved set, at the group's capture time. HAVING COUNT(DISTINCT)=N
      // drops partial cycles (mirrors getPortfolio's snapshot invariant). The
      // INTERVAL is a fixed literal from SERIES_RANGE_INTERVAL — never user text.
      const seriesResult = await client.query<SeriesPointRow>(
        `SELECT SUM(total_usd)::float8 AS total, MIN(created_at) AS at
           FROM proj_portfolio_snapshots
          WHERE wallet_address = ANY($1::text[])
            AND created_at > NOW() - INTERVAL '${interval}'
          GROUP BY snapshot_group_id
         HAVING COUNT(DISTINCT wallet_address) = $2
          ORDER BY at ASC`,
        [addrParam, addresses.length],
      );
      const points = seriesResult.rows
        .filter((row): row is SeriesPointRow & { at: string | Date } =>
          row.at !== null,
        )
        .map((row) => ({
          t: toIso(row.at),
          totalUsd: toNumber(row.total),
        }));

      // Flow-adjusted return: the raw curve counts deposits/withdrawals as
      // PnL, so the HEADLINE % must neutralise external cash flows (see the DTO
      // doc). Fail-soft — a flow-detection failure degrades to the naive number.
      const returns = await computeFlowAdjustedReturn(addresses, points);

      log.info(
        `[portfolio-db] getPortfolioSeries ok scope=${input.scope} ` +
          `range=${input.range} wallets=${addresses.length} ` +
          `points=${points.length} netFlow=${returns.netFlowUsd !== 0}`,
      );

      return ok({ points, ...returns });
    } catch (cause) {
      return dbError("getPortfolioSeries query failed", cause);
    }
  });
}

/**
 * Flow-adjusted return over the equity-curve `points` for the resolved wallet
 * set. Detects each EVM wallet's native deposits/withdrawals on the local
 * chains, keeps only the flows inside the curve's window, and computes the
 * Time-Weighted Return + net-flow-adjusted PnL (the pure math in
 * `@vex-agent/analytics/twr`).
 *
 * FAIL-SOFT: any detection error (or a chain with no explorer) yields no flows,
 * so TWR collapses to the naive `last/first − 1` and the headline just matches
 * the old behaviour instead of crashing. Solana wallets have no native-flow
 * detection (documented follow-on) and are skipped.
 */
async function computeFlowAdjustedReturn(
  addresses: readonly string[],
  points: readonly { t: string; totalUsd: number }[],
): Promise<{
  changePctTwr: number | null;
  netFlowUsd: number;
  flowAdjustedChangeUsd: number | null;
}> {
  const NEUTRAL = { changePctTwr: null, netFlowUsd: 0, flowAdjustedChangeUsd: null };
  if (points.length < 2) return NEUTRAL;

  const curve: Point[] = points.map((pt) => ({
    t: Date.parse(pt.t),
    valueUsd: pt.totalUsd,
  }));
  const windowStart = curve[0]!.t;
  const windowEnd = curve[curve.length - 1]!.t;

  // Only EVM inventory wallets can carry native flows on a local chain.
  const evmSet = new Set(listWallets("evm").map((e) => e.address));
  const evmAddresses = addresses.filter((a) => evmSet.has(a));

  const flows: Flow[] = [];
  try {
    for (const chain of listLocalChains("eip155")) {
      for (const address of evmAddresses) {
        const detected = await getNativeCashFlows(chain.id, address);
        for (const flow of detected) {
          if (flow.t >= windowStart && flow.t <= windowEnd) flows.push(flow);
        }
      }
    }
  } catch (cause) {
    // Never let flow detection break the series read — degrade to naive.
    log.warn("[portfolio-db] native flow detection failed; using naive return", cause);
    return { changePctTwr: (curve[curve.length - 1]!.valueUsd / curve[0]!.valueUsd - 1) * 100, netFlowUsd: 0, flowAdjustedChangeUsd: curve[curve.length - 1]!.valueUsd - curve[0]!.valueUsd };
  }

  const twr = timeWeightedReturn(curve, flows);
  const netFlowUsd = flows.reduce((acc, f) => acc + f.usd, 0);
  const flowAdjustedChangeUsd = netFlowAdjustedPnlUsd(curve, flows);
  return { changePctTwr: twr * 100, netFlowUsd, flowAdjustedChangeUsd };
}
