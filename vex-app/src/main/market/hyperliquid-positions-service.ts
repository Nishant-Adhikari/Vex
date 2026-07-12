/**
 * Main-owned Hyperliquid positions push service.
 *
 * The reconciler remains the projection authority. This service only reads its
 * typed projection, overlays a current public allMids mark for display, and
 * broadcasts renderer-safe DTOs. It never signs, writes the DB, or runs when
 * there is no position/resting-order exposure.
 */

import { HyperliquidInfoClient } from "@tools/hyperliquid/info.js";
import { z } from "zod";
import { normalizeProviderDecimal } from "@tools/hyperliquid/validation.js";
import { resolveHyperliquidNetwork } from "@tools/hyperliquid/constants.js";
import { EV } from "@shared/ipc/channels.js";
import type {
  HyperliquidPositionsDto,
  HyperliquidWatchlistItemDto,
} from "@shared/schemas/hyperliquid.js";
import {
  getHyperliquidPositions,
  hasHyperliquidExposure,
  listHyperliquidPositionSessionIds,
} from "../database/hyperliquid-db.js";
import { broadcastToAllWindows } from "../lifecycle/broadcast.js";
import { log } from "../logger/index.js";

const DEFAULT_INTERVAL_MS = 15_000;
const allMidsSchema = z.record(z.string(), z.unknown());

export interface HyperliquidPositionsServiceDeps {
  readonly hasExposure: typeof hasHyperliquidExposure;
  readonly listSessionIds: typeof listHyperliquidPositionSessionIds;
  readonly getPositions: typeof getHyperliquidPositions;
  readonly allMids: () => Promise<unknown>;
  readonly publish: (snapshot: HyperliquidPositionsDto) => void;
  readonly now: () => Date;
  readonly intervalMs: number;
}

function productionDeps(): HyperliquidPositionsServiceDeps {
  return {
    hasExposure: hasHyperliquidExposure,
    listSessionIds: listHyperliquidPositionSessionIds,
    getPositions: getHyperliquidPositions,
    allMids: () => new HyperliquidInfoClient({ network: resolveHyperliquidNetwork() }).allMids(),
    publish: (snapshot) => broadcastToAllWindows(EV.hyperliquid.positionsUpdate, snapshot),
    now: () => new Date(),
    intervalMs: DEFAULT_INTERVAL_MS,
  };
}

function marksFrom(response: unknown): ReadonlyMap<string, string> {
  const parsed = allMidsSchema.safeParse(response);
  if (!parsed.success) return new Map();
  const marks = new Map<string, string>();
  for (const [coin, raw] of Object.entries(parsed.data)) {
    try {
      marks.set(coin, normalizeProviderDecimal(raw, `Hyperliquid mark for ${coin}`));
    } catch {
      // A malformed single market does not poison other position updates.
    }
  }
  return marks;
}

async function tick(deps: HyperliquidPositionsServiceDeps): Promise<void> {
  if (!await deps.hasExposure()) return;
  const marks = marksFrom(await deps.allMids());
  const sessionIds = await deps.listSessionIds();
  const updatedAt = deps.now().toISOString();
  for (const sessionId of sessionIds) {
    const result = await deps.getPositions(sessionId);
    if (!result.ok) continue;
    const persistedWatchlist = result.data.watchlist ?? [];
    const watchlist = persistedWatchlist.length > 0
      ? overlayWatchlistMids(persistedWatchlist, marks)
      : fallbackWatchlist(marks);
    deps.publish({
      ...result.data,
      updatedAt,
      // The DTO type is a mutable array (zod output); the builders return readonly.
      watchlist: [...watchlist],
      positions: result.data.positions.map((position) => ({
        ...position,
        markPx: marks.get(position.coin) ?? position.markPx,
        updatedAt,
      })),
    });
  }
}

/** Preserve reconciler-provided OI/ranking while the weight-2 poll refreshes prices. */
function overlayWatchlistMids(
  watchlist: readonly HyperliquidWatchlistItemDto[],
  marks: ReadonlyMap<string, string>,
): readonly HyperliquidWatchlistItemDto[] {
  return watchlist.map((item) => ({ ...item, midPx: marks.get(item.coin) ?? item.midPx }));
}

/**
 * Before a reconciler snapshot contains ranked OI, expose a bounded read-only
 * fallback from the already-fetched allMids payload. It intentionally omits
 * OI and 24h change rather than creating an extra market endpoint.
 */
function fallbackWatchlist(marks: ReadonlyMap<string, string>): readonly HyperliquidWatchlistItemDto[] {
  const required = ["BTC", "ETH", "SOL", "HYPE"];
  const names = [...marks.keys()].filter((coin) => !coin.startsWith("@"));
  const selected = new Set(required.filter((coin) => marks.has(coin)));
  for (const coin of names.sort()) {
    if (selected.size === 16) break;
    selected.add(coin);
  }
  return [...selected].flatMap((coin) => {
    const midPx = marks.get(coin);
    return midPx === undefined
      ? []
      : [{ coin, midPx, change24hPct: null, openInterestUsd: null }];
  });
}

/** Idempotent self-scheduling lifecycle with no orphan timer or in-flight publish. */
export function setupHyperliquidPositionsService(
  supplied: Partial<HyperliquidPositionsServiceDeps> = {},
): () => Promise<void> {
  const deps = { ...productionDeps(), ...supplied };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      inFlight = tick(deps)
        .catch((cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause);
          log.warn("[hyperliquid-positions] tick failed", { message });
        })
        .finally(() => {
          inFlight = null;
          schedule(deps.intervalMs);
        });
    }, delayMs);
  };

  schedule(0);
  return async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    await inFlight;
  };
}
