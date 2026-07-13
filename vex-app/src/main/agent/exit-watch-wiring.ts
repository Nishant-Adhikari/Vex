/**
 * Exit-watch wiring — SHADOW / ALERT-ONLY.
 *
 * Phase C's exit engine (`@vex-agent/engine/exit/*`) is pure and dependency-
 * injected: it computes exit *decisions* but touches nothing. This module
 * supplies the REAL side-effecting providers for the live desktop app and
 * supervises the poll loop, but stays strictly non-executing:
 *
 *   - `getOpenPositions` reads the engine DB (`proj_open_positions`), scoped to
 *     the ACTIVE mission run (its wallets + opened within the run window) so
 *     legacy bags from before the mission are excluded.
 *   - `priceOf` returns a live implied USD spot price per held token, derived
 *     from the same snapshot (`current_value_usd / contracts`).
 *   - `emitAlert` LOGS a structured line per actionable alert. It NEVER sells,
 *     swaps, or mutates a wallet. Execution is Phase D-exec, not this.
 *   - `savePeak` keeps an in-memory high-water map for the worker's lifetime.
 *
 * A mode flag (`VEX_EXIT_ENGINE_MODE`, default `"alert"`) selects alert vs
 * execute. Only the alert branch is implemented here; the execute branch is a
 * `// TODO Phase D-exec` stub that currently also only alerts.
 *
 * The worker is additive and safe: when no mission run is ACTIVE,
 * `getOpenPositions` returns `[]`, so the loop is a pure no-op (no alerts, no
 * side effects) — a stronger guarantee than start/stop toggling.
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
import { getOpen, type Position as OpenPosition } from "@vex-agent/db/repos/open-positions.js";
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

// ── Pure provider helpers (unit-tested) ─────────────────────────

/**
 * Stable per-position token identity, used both as the watch token and as the
 * peak-store / price-store key across cycles. Prefers the on-chain instrument
 * key, then the synthetic position/external ids, and finally the row id so the
 * result is always a non-empty string.
 */
export function positionToken(pos: OpenPosition): string {
  const candidates = [pos.instrumentKey, pos.positionKey, pos.externalId];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c;
  }
  return `pos:${pos.id}`;
}

/**
 * Implied live USD spot price per held token from the same synced snapshot the
 * portfolio reads: `current_value_usd / contracts` (MTM sets
 * `current_value_usd = contracts * markPrice`). Returns `null` on any missing /
 * non-finite / non-positive input, so the pure cycle degrades gracefully.
 */
export function impliedPriceUsd(pos: OpenPosition): number | null {
  const value = pos.currentValueUsd != null ? Number(pos.currentValueUsd) : NaN;
  const amount = pos.contracts != null ? Number(pos.contracts) : NaN;
  if (!Number.isFinite(value) || !Number.isFinite(amount) || amount <= 0) return null;
  const price = value / amount;
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * True when a position opened within the active run window (`opened_at >=
 * runStartedAtMs`). A position with no / unparseable `opened_at` is EXCLUDED
 * (conservative: it cannot be proven to belong to this mission run) — this is
 * the mission-scoping that keeps legacy bags out of the shadow watch.
 */
export function isWithinRunWindow(
  openedAt: string | null,
  runStartedAtMs: number,
): boolean {
  if (!openedAt || !Number.isFinite(runStartedAtMs)) return false;
  const t = Date.parse(openedAt);
  return Number.isFinite(t) && t >= runStartedAtMs;
}

/**
 * Map an open-positions row to the engine's `WatchInputPosition`, or `null`
 * when the entry price is non-finite / ≤ 0 (the caller SKIPS those). Alert mode
 * assumes no rungs consumed. `priorPeak` comes from the in-memory peak store;
 * it defaults to (and can never sit below) the entry price when unseen.
 */
export function toWatchInputPosition(
  pos: OpenPosition,
  priorPeak: number | undefined,
): WatchInputPosition | null {
  const entryPriceUsd = pos.entryPriceUsd != null ? Number(pos.entryPriceUsd) : NaN;
  if (!Number.isFinite(entryPriceUsd) || entryPriceUsd <= 0) return null;

  const amountRaw = pos.contracts != null ? Number(pos.contracts) : NaN;
  const openedRaw = pos.openedAt ? Date.parse(pos.openedAt) : NaN;

  const priorPeakPriceUsd =
    priorPeak !== undefined && Number.isFinite(priorPeak) && priorPeak >= entryPriceUsd
      ? priorPeak
      : entryPriceUsd;

  return {
    token: positionToken(pos),
    entryPriceUsd,
    amountTokens: Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 0,
    openedAtMs: Number.isFinite(openedRaw) ? openedRaw : 0,
    consumedRungs: [],
    priorPeakPriceUsd,
  };
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

// ── Deps construction ───────────────────────────────────────────

export interface ExitWatchWiringOptions {
  readonly mode?: ExitEngineMode;
  readonly config?: ExitConfig;
  /** Test seam: source of the active mission run. */
  readonly loadActiveRun?: () => Promise<ActiveMissionRun | null>;
  /** Test seam: wallet-scoped open-positions loader. */
  readonly loadOpenPositions?: (wallets: string[] | undefined) => Promise<OpenPosition[]>;
}

/**
 * Build the real `ExitWatchWorkerDeps`. Holds two in-memory maps for the
 * worker's lifetime: a token→peak high-water store and a token→implied-price
 * snapshot refreshed each `getOpenPositions` call so `priceOf` stays consistent
 * with the positions returned that tick.
 */
export function createExitWatchDeps(
  options: ExitWatchWiringOptions = {},
): ExitWatchWorkerDeps {
  const mode = options.mode ?? resolveExitEngineMode();
  const config = options.config ?? DEFAULT_EXIT_CONFIG;
  const loadActiveRun = options.loadActiveRun ?? getActiveMissionRun;
  const loadOpenPositions =
    options.loadOpenPositions ?? ((wallets) => getOpen(wallets));

  const peakStore = new Map<string, number>();
  const priceStore = new Map<string, number>();

  const getOpenPositions = async (): Promise<WatchInputPosition[]> => {
    try {
      const run = await loadActiveRun();
      if (!run) {
        // No active mission → nothing to watch; keep the price snapshot clean.
        priceStore.clear();
        return [];
      }

      // Wallet-scoped when the mission declares wallets; otherwise fall back to
      // a global read narrowed by the run-window filter below (still excludes
      // legacy bags via opened_at).
      const rows = await loadOpenPositions(run.wallets.length > 0 ? run.wallets : undefined);

      priceStore.clear();
      const inputs: WatchInputPosition[] = [];
      for (const pos of rows) {
        if (!isWithinRunWindow(pos.openedAt, run.startedAtMs)) continue;
        const input = toWatchInputPosition(pos, peakStore.get(positionToken(pos)));
        if (!input) continue; // skipped: bad entry price
        const price = impliedPriceUsd(pos);
        if (price !== null) priceStore.set(input.token, price);
        inputs.push(input);
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
