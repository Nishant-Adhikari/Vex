/**
 * Exit-watch wiring — SHADOW / ALERT-ONLY.
 *
 * Phase C's exit engine (`@vex-agent/engine/exit/*`) is pure and dependency-
 * injected: it computes exit *decisions* but touches nothing. This module
 * supplies the REAL side-effecting providers for the live desktop app and
 * supervises the poll loop, but stays strictly non-executing.
 *
 * SPOT SOURCING (verified live): spot memecoin swaps do NOT create
 * `proj_open_positions` rows (that table is perps/predictions only, and is
 * empty). Spot holdings are re-derived from two live-synced projections:
 *
 *   - `proj_balances`  — current holdings + live `price_usd` per token.
 *   - `proj_activity`  — swap ledger (`trade_side`, output_token, amounts,
 *                        value_usd) used for cost basis + open time. It has NO
 *                        session_id, so mission scoping is by wallet + created_at.
 *
 * A held token is a mission position only if it has ≥1 BUY in `proj_activity`
 * for a mission wallet with `created_at >= run.startedAt` (bought DURING the
 * mission). Held tokens with no in-window buy are legacy bags and are dropped.
 *
 *   - `priceOf`   — live USD spot from `proj_balances.price_usd`, snapshotted
 *                   per read so it is consistent with that tick's positions.
 *   - `emitAlert` — LOGS a structured line per actionable alert. It NEVER
 *                   sells, swaps, or mutates a wallet. Execution is Phase
 *                   D-exec, not this.
 *   - `savePeak`  — in-memory token→peak high-water map for the worker's life.
 *
 * A mode flag (`VEX_EXIT_ENGINE_MODE`, default `"alert"`) selects alert vs
 * execute. Only the alert branch is implemented; the execute branch is a
 * `// TODO Phase D-exec` stub that currently also only alerts. When no mission
 * run is ACTIVE, `getOpenPositions` returns `[]`, so the loop is a pure no-op.
 */

import { randomUUID } from "node:crypto";
import {
  setupExitWatchWorker as setupEngineExitWatchWorker,
  EXIT_WATCH_POLL_MS,
  type ExitWatchWorkerDeps,
  type ExitWatchTeardown,
} from "@vex-agent/engine/exit/watch-worker.js";
import type { WatchAlert, WatchInputPosition } from "@vex-agent/engine/exit/watch-cycle.js";
import type { ExitConfig } from "@vex-agent/engine/exit/exit-rules.js";
import { query } from "@vex-agent/db/client.js";
import { log } from "../logger/index.js";
import { ensureEngineDbUrl } from "../ipc/runtime/_ensure-engine-db-url.js";

const SUPERVISOR_INTERVAL_MS = 30_000;

// ── Mode flag ───────────────────────────────────────────────────

export type ExitEngineMode = "alert" | "execute";

/**
 * Resolve the exit-engine mode from `VEX_EXIT_ENGINE_MODE`. DEFAULTS TO
 * `"alert"` — anything other than an explicit `"execute"` (case-insensitive)
 * is alert. In this phase both branches only LOG; `"execute"` is a stub.
 */
export function resolveExitEngineMode(): ExitEngineMode {
  return (process.env.VEX_EXIT_ENGINE_MODE ?? "").trim().toLowerCase() === "execute"
    ? "execute"
    : "alert";
}

// ── Default exit config ─────────────────────────────────────────

/**
 * Default exit configuration. Named export so it is easy to tune/override.
 * TP ladder sells half at 2x then half of the remainder at 3x; a 35% stop from
 * entry, a 25% trailing stop once the ladder is in profit, and a 90-minute
 * time-stop when price is flat within ±15% of entry.
 */
export const DEFAULT_EXIT_CONFIG: ExitConfig = {
  takeProfitLadder: [
    { multiple: 2, sellFraction: 0.5 },
    { multiple: 3, sellFraction: 0.5 },
  ],
  stopLossPct: 0.35,
  trailingStopPct: 0.25,
  timeStopMinutes: 90,
  timeStopFlatBandPct: 0.15,
};

// ── Source row shapes (mapped from snake_case in the loaders) ────

/** A current holding from `proj_balances` (already numeric-coerced). */
export interface BalanceRow {
  readonly tokenAddress: string;
  readonly tokenSymbol: string | null;
  /** Raw on-chain integer balance (base units), as a decimal string. */
  readonly balanceRaw: string;
  readonly priceUsd: number | null;
  readonly decimals: number | null;
}

/** A single BUY leg from `proj_activity` (already numeric-coerced). */
export interface BuyRow {
  readonly outputToken: string;
  /** Tokens received, decimal string. */
  readonly outputAmount: string | null;
  readonly outputValueUsd: number | null;
  readonly unitPriceUsd: number | null;
  readonly valueUsd: number | null;
  readonly createdAtMs: number;
}

// ── Pure provider helpers (unit-tested) ─────────────────────────

/**
 * Human token amount from a raw base-unit balance + decimals:
 * `balance_raw / 10^decimals`. Returns `null` when the raw balance is missing /
 * non-positive or decimals are absent / invalid (can't scale) — those rows are
 * dropped. (Number precision is fine for a shadow watch.)
 */
export function heldAmount(balanceRaw: string, decimals: number | null): number | null {
  const raw = Number(balanceRaw);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (decimals === null || !Number.isFinite(decimals) || decimals < 0) return null;
  const amount = raw / 10 ** decimals;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * USD value of one BUY leg, preferring `output_value_usd`, then
 * `unit_price_usd * amount`, then `value_usd`. `null` when none is usable.
 */
export function buyValueUsd(buy: BuyRow, amount: number): number | null {
  if (buy.outputValueUsd !== null && Number.isFinite(buy.outputValueUsd)) {
    return buy.outputValueUsd;
  }
  if (buy.unitPriceUsd !== null && Number.isFinite(buy.unitPriceUsd)) {
    return buy.unitPriceUsd * amount;
  }
  if (buy.valueUsd !== null && Number.isFinite(buy.valueUsd)) {
    return buy.valueUsd;
  }
  return null;
}

/**
 * Cost basis + open time for a held token from its in-window BUY legs:
 * `entryPriceUsd = Σ(buy value) / Σ(amount)`, `openedAtMs = min(created_at)`.
 * Only legs with a positive amount AND a usable USD value contribute. Returns
 * `null` when nothing usable remains or the derived basis is non-finite / ≤ 0
 * (the caller drops the position).
 */
export function costBasisFromBuys(
  buys: readonly BuyRow[],
): { entryPriceUsd: number; openedAtMs: number } | null {
  let sumValue = 0;
  let sumAmount = 0;
  let openedAtMs = Number.POSITIVE_INFINITY;
  let any = false;

  for (const buy of buys) {
    const amount = buy.outputAmount !== null ? Number(buy.outputAmount) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const value = buyValueUsd(buy, amount);
    if (value === null || !Number.isFinite(value)) continue;
    sumValue += value;
    sumAmount += amount;
    if (Number.isFinite(buy.createdAtMs) && buy.createdAtMs < openedAtMs) {
      openedAtMs = buy.createdAtMs;
    }
    any = true;
  }

  if (!any || sumAmount <= 0) return null;
  const entryPriceUsd = sumValue / sumAmount;
  if (!Number.isFinite(entryPriceUsd) || entryPriceUsd <= 0) return null;
  if (!Number.isFinite(openedAtMs)) return null;
  return { entryPriceUsd, openedAtMs };
}

/**
 * Render one alert as a single structured log line, e.g.
 *   [exit-watch] token=0xABC price=0.00042 peak=0.00061 decisions=[stop_loss sell 100% | take_profit rung1 sell 50%]
 * With no decisions the bracket carries the diagnostic note (or `none`).
 */
export function formatExitAlert(alert: WatchAlert): string {
  const price = alert.currentPriceUsd != null ? alert.currentPriceUsd.toPrecision(6) : "n/a";
  const peak = Number.isFinite(alert.updatedPeakPriceUsd)
    ? alert.updatedPeakPriceUsd.toPrecision(6)
    : "n/a";
  const decisions =
    alert.decisions.length > 0
      ? alert.decisions
          .map((d) => {
            const rung = d.rungIndex != null ? ` rung${d.rungIndex}` : "";
            return `${d.kind}${rung} sell ${(d.sellFraction * 100).toFixed(0)}%`;
          })
          .join(" | ")
      : (alert.note ?? "none");
  return `[exit-watch] token=${alert.token} price=${price} peak=${peak} decisions=[${decisions}]`;
}

// ── Active-mission scoping ──────────────────────────────────────

interface RunningRunRow {
  readonly id: string;
  readonly mission_id: string;
  readonly started_at: string | Date;
  readonly mission_wallets: string[] | null;
}

export interface ActiveMissionRun {
  readonly runId: string;
  readonly missionId: string;
  readonly startedAtMs: number;
  /** Mission-allowed wallet addresses; may be empty (see wiring notes). */
  readonly wallets: string[];
}

/**
 * The single ACTIVE (status = 'running') mission run, newest first, with its
 * mission's allowed wallets. `null` when no mission is running → the worker
 * becomes a no-op. Mirrors the engine's "at most one running mission"
 * invariant without trusting it (ORDER BY started_at DESC LIMIT 1).
 */
export async function getActiveMissionRun(): Promise<ActiveMissionRun | null> {
  const rows = await query<RunningRunRow>(
    `SELECT r.id, r.mission_id, r.started_at, m.allowed_wallets AS mission_wallets
       FROM mission_runs r
       LEFT JOIN missions m ON m.id = r.mission_id
      WHERE r.status = 'running'
      ORDER BY r.started_at DESC
      LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;

  const startedAtMs =
    row.started_at instanceof Date ? row.started_at.getTime() : Date.parse(row.started_at);
  const wallets = (row.mission_wallets ?? []).filter(
    (w): w is string => typeof w === "string" && w.trim().length > 0,
  );

  return { runId: row.id, missionId: row.mission_id, startedAtMs, wallets };
}

// ── Default DB loaders (engine repos pattern) ───────────────────

function toMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Current holdings (any balance) for the given wallets. */
async function loadHeldBalancesDb(wallets: string[]): Promise<BalanceRow[]> {
  if (wallets.length === 0) return [];
  const rows = await query<{
    token_address: string;
    token_symbol: string | null;
    balance_raw: string | null;
    price_usd: string | number | null;
    decimals: number | null;
  }>(
    `SELECT token_address, token_symbol, balance_raw, price_usd, decimals
       FROM proj_balances
      WHERE wallet_address = ANY($1::text[])`,
    [wallets],
  );
  return rows.map((r) => ({
    tokenAddress: r.token_address,
    tokenSymbol: r.token_symbol,
    balanceRaw: r.balance_raw ?? "0",
    priceUsd: numOrNull(r.price_usd),
    decimals: r.decimals,
  }));
}

/** BUY legs for the given wallets that opened at/after the run start. */
async function loadInWindowBuysDb(wallets: string[], sinceMs: number): Promise<BuyRow[]> {
  if (wallets.length === 0 || !Number.isFinite(sinceMs)) return [];
  const rows = await query<{
    output_token: string;
    output_amount: string | null;
    output_value_usd: string | number | null;
    unit_price_usd: string | number | null;
    value_usd: string | number | null;
    created_at: string | Date;
  }>(
    `SELECT output_token, output_amount, output_value_usd, unit_price_usd, value_usd, created_at
       FROM proj_activity
      WHERE trade_side = 'buy'
        AND wallet_address = ANY($1::text[])
        AND output_token IS NOT NULL
        AND created_at >= $2`,
    [wallets, new Date(sinceMs)],
  );
  return rows.map((r) => ({
    outputToken: r.output_token,
    outputAmount: r.output_amount,
    outputValueUsd: numOrNull(r.output_value_usd),
    unitPriceUsd: numOrNull(r.unit_price_usd),
    valueUsd: numOrNull(r.value_usd),
    createdAtMs: toMs(r.created_at),
  }));
}

// ── Deps construction ───────────────────────────────────────────

export interface ExitWatchWiringOptions {
  readonly mode?: ExitEngineMode;
  readonly config?: ExitConfig;
  /** Test seam: source of the active mission run. */
  readonly loadActiveRun?: () => Promise<ActiveMissionRun | null>;
  /** Test seam: current holdings loader (`proj_balances`). */
  readonly loadHeldBalances?: (wallets: string[]) => Promise<BalanceRow[]>;
  /** Test seam: in-window BUY loader (`proj_activity`, created_at >= start). */
  readonly loadInWindowBuys?: (wallets: string[], sinceMs: number) => Promise<BuyRow[]>;
}

/**
 * Build the real `ExitWatchWorkerDeps`. Holds two in-memory maps for the
 * worker's lifetime: a token→peak high-water store and a token→live-price
 * snapshot refreshed each `getOpenPositions` call so `priceOf` stays consistent
 * with the positions returned that tick.
 */
export function createExitWatchDeps(
  options: ExitWatchWiringOptions = {},
): ExitWatchWorkerDeps {
  const mode = options.mode ?? resolveExitEngineMode();
  const config = options.config ?? DEFAULT_EXIT_CONFIG;
  const loadActiveRun = options.loadActiveRun ?? getActiveMissionRun;
  const loadHeldBalances = options.loadHeldBalances ?? loadHeldBalancesDb;
  const loadInWindowBuys = options.loadInWindowBuys ?? loadInWindowBuysDb;

  const peakStore = new Map<string, number>();
  const priceStore = new Map<string, number>();

  const getOpenPositions = async (): Promise<WatchInputPosition[]> => {
    try {
      const run = await loadActiveRun();
      // No active mission (or no mission wallets to scope by) → nothing to
      // watch; keep the price snapshot clean.
      if (!run || run.wallets.length === 0) {
        priceStore.clear();
        return [];
      }

      const [balances, buys] = await Promise.all([
        loadHeldBalances(run.wallets),
        loadInWindowBuys(run.wallets, run.startedAtMs),
      ]);

      // Group in-window BUY legs by output token — a token here was bought
      // DURING this mission run, so it survives mission scoping.
      const buysByToken = new Map<string, BuyRow[]>();
      for (const buy of buys) {
        if (!buy.outputToken) continue;
        const list = buysByToken.get(buy.outputToken);
        if (list) list.push(buy);
        else buysByToken.set(buy.outputToken, [buy]);
      }

      // Aggregate current holdings by token (sum across wallets/chains; first
      // finite positive price wins).
      const heldByToken = new Map<string, { amount: number; price: number | null }>();
      for (const bal of balances) {
        const amount = heldAmount(bal.balanceRaw, bal.decimals);
        if (amount === null) continue;
        const entry = heldByToken.get(bal.tokenAddress) ?? { amount: 0, price: null };
        entry.amount += amount;
        if (
          entry.price === null &&
          bal.priceUsd !== null &&
          Number.isFinite(bal.priceUsd) &&
          bal.priceUsd > 0
        ) {
          entry.price = bal.priceUsd;
        }
        heldByToken.set(bal.tokenAddress, entry);
      }

      priceStore.clear();
      const inputs: WatchInputPosition[] = [];
      for (const [token, held] of heldByToken) {
        const tokenBuys = buysByToken.get(token);
        if (!tokenBuys || tokenBuys.length === 0) continue; // legacy bag → drop
        if (!(held.amount > 0)) continue;

        const basis = costBasisFromBuys(tokenBuys);
        if (basis === null) continue; // no usable cost basis → drop

        const prior = peakStore.get(token);
        const priorPeakPriceUsd =
          prior !== undefined && Number.isFinite(prior) && prior >= basis.entryPriceUsd
            ? prior
            : basis.entryPriceUsd;

        inputs.push({
          token,
          entryPriceUsd: basis.entryPriceUsd,
          amountTokens: held.amount,
          openedAtMs: basis.openedAtMs,
          consumedRungs: [],
          priorPeakPriceUsd,
        });
        if (held.price !== null) priceStore.set(token, held.price);
      }
      return inputs;
    } catch (err: unknown) {
      // Fail-soft: a bad DB read must never surface an exit alert or crash the
      // loop. An empty sweep self-heals next tick.
      log.warn("[exit-watch] getOpenPositions failed (fail-soft to [])", err);
      priceStore.clear();
      return [];
    }
  };

  const priceOf = (token: string): number | null => priceStore.get(token) ?? null;

  const emitAlert = (alert: WatchAlert): void => {
    const line = formatExitAlert(alert);
    if (alert.decisions.length > 0) {
      if (mode === "execute") {
        // TODO Phase D-exec: route these decisions to the swap execute path.
        // Until Phase D-exec lands, execute mode is SHADOW too — it only alerts,
        // never sells, so no real-money move can happen from this module.
        log.info(`${line} [mode=execute:shadow]`);
      } else {
        log.info(`${line} [mode=alert]`);
      }
    } else if (alert.note) {
      // Non-actionable diagnostics (e.g. price_unavailable) stay at debug.
      log.debug(line);
    }
  };

  const savePeak = (token: string, peakPriceUsd: number): void => {
    if (Number.isFinite(peakPriceUsd) && peakPriceUsd > 0) {
      peakStore.set(token, peakPriceUsd);
    }
  };

  return { getOpenPositions, priceOf, emitAlert, savePeak, config };
}

// ── Boot supervisor ─────────────────────────────────────────────

export interface ExitWatchSupervisorDeps {
  /** Point the engine pool at local Postgres; `{ ok }` gates start. */
  readonly ensureDbUrl: (correlationId: string) => Promise<{ readonly ok: boolean }>;
  /** Start the engine exit-watch worker; returns its teardown. */
  readonly startWorker: () => ExitWatchTeardown;
  /** Supervisor poll cadence (test override). */
  readonly intervalMs: number;
}

function defaultStartWorker(): ExitWatchTeardown {
  const mode = resolveExitEngineMode();
  log.info(
    `[exit-watch] starting exit-watch worker (mode=${mode}, poll=${EXIT_WATCH_POLL_MS}ms) — SHADOW/ALERT: no execution`,
  );
  const deps = createExitWatchDeps({ mode });
  return setupEngineExitWatchWorker({
    ...deps,
    onError: (err: unknown) => log.warn("[exit-watch] tick error", err),
  });
}

/**
 * Start the supervised exit-watch worker. Returns an idempotent async `stop`
 * for the ordered quit cleanup. Lifecycle mirrors `regime-worker.ts`: tick
 * immediately then every `intervalMs` until the DB url resolves, then start the
 * worker EXACTLY ONCE and clear the interval. `stop()` is non-reentrant and
 * idempotent: it clears the interval, awaits any in-flight startup tick, and
 * tears the worker down (even if `stop()` raced a still-pending start).
 */
export function setupExitWatchWorker(
  deps: Partial<ExitWatchSupervisorDeps> = {},
): () => Promise<void> {
  const intervalMs = deps.intervalMs ?? SUPERVISOR_INTERVAL_MS;
  const ensureDbUrl =
    deps.ensureDbUrl ??
    (async (correlationId: string) => {
      const r = await ensureEngineDbUrl(correlationId);
      return { ok: r.ok };
    });
  const startWorker = deps.startWorker ?? defaultStartWorker;

  let stopped = false;
  let started = false;
  let teardown: ExitWatchTeardown | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlightTick: Promise<void> | null = null;
  let warnedWaiting = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped || started) return;

    const dbUrl = await ensureDbUrl(`exit-watch-supervisor-${randomUUID()}`);
    if (stopped || started) return; // re-check after await (non-reentrant)
    if (!dbUrl.ok) {
      if (!warnedWaiting) {
        warnedWaiting = true;
        log.info("[exit-watch] waiting to start: database url unavailable");
      }
      return;
    }

    const live = startWorker();
    started = true;
    clearTimer();
    // stop() may have raced in during the awaits above — tear the worker back
    // down so quit never leaves a live loop.
    if (stopped) {
      await live();
      return;
    }
    teardown = live;
  };

  const scheduleTick = (): void => {
    if (stopped || started || inFlightTick !== null) return;
    inFlightTick = tick()
      .catch((err) => {
        log.warn("[exit-watch] supervisor tick failed", err);
      })
      .finally(() => {
        inFlightTick = null;
      });
  };

  scheduleTick();
  timer = setInterval(scheduleTick, intervalMs);

  return async function stop(): Promise<void> {
    stopped = true;
    clearTimer();
    if (inFlightTick !== null) {
      try {
        await inFlightTick;
      } catch {
        // already logged in scheduleTick
      }
    }
    if (teardown !== null) {
      const live = teardown;
      teardown = null;
      await live();
    }
  };
}
