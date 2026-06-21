/**
 * KyberSwap limit-order concise projector (P1-13).
 *
 * The maker (`kyberswap.limitOrder.list`) and taker (`kyberswap.limitOrder.takerOrders`)
 * read tools return raw `LimitOrder[]` rows straight from the upstream KyberSwap
 * Limit Order API. Each row carries on-chain signing material — `salt`,
 * `signature` — plus the `maker` address that the agent never acts on from a read
 * result: `salt`/`signature` are EIP-712 internals reconstructed at create/cancel
 * time, and `maker` is the session wallet the read was already scoped by. Shipping
 * them dilutes the order-state signal (`status`, fill amounts, expiry) the model
 * actually reasons over, and `signature` in particular is a long opaque hex blob.
 *
 * This pure projector strips that material at the handler seam — BEFORE the result
 * is serialized — so the model sees a lean order row: identity (`id`/`chainId`/
 * asset pair), the amounts, fill progress, lifecycle (`status`/`expiredAt` plus a
 * derived `expiresAtIso`), timestamps, and the optional symbol/decimals metadata.
 * Both read tools are reads with no `_tradeCapture`, so trimming the output is safe.
 *
 * Default-concise with NO verbosity knob: there is no agent use case for the
 * dropped `salt`/`signature`/`maker` on a read path.
 *
 * Required fields (`id`/`chainId`/asset pair/amounts/fill/`status`/timestamps) are
 * read directly off the row — assumed present per the upstream KyberSwap Limit
 * Order API contract. Only the OPTIONAL fields are guarded: the symbol/decimals
 * metadata is set only when present and well-typed, and `expiredAt` is run through
 * a finite-number check before deriving `expiresAtIso`.
 */

import type { LimitOrder, LimitOrderStatus } from "@tools/kyberswap/limit-order/types.js";

// ── Concise output shape ─────────────────────────────────────────

/**
 * Concise limit-order row = `LimitOrder` minus the signing/identity material
 * (`salt`, `signature`, `maker`), plus a derived human-readable `expiresAtIso`.
 *
 * KEEP: id, chainId, makerAsset, takerAsset, makingAmount, takingAmount,
 * filledMakingAmount, filledTakingAmount, status, expiredAt, createdAt, updatedAt,
 * and the optional symbol/decimals metadata.
 * ADD: `expiresAtIso` — ISO-8601 derived from `expiredAt` (Unix seconds), `null`
 * when `expiredAt` is absent or non-finite.
 * DROP: `salt`, `signature`, `maker`.
 */
export interface AgentLimitOrder {
  id: number;
  chainId: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: string;
  takingAmount: string;
  filledMakingAmount: string;
  filledTakingAmount: string;
  status: LimitOrderStatus;
  expiredAt: number;
  /** ISO-8601 derived from `expiredAt` (Unix seconds); `null` when not derivable. */
  expiresAtIso: string | null;
  createdAt: string;
  updatedAt: string;
  makerAssetSymbol?: string;
  takerAssetSymbol?: string;
  makerAssetDecimals?: number;
  takerAssetDecimals?: number;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Derive an ISO-8601 timestamp from a Unix-seconds value. Returns `null` when the
 * input is not a finite number or produces an invalid date, so a missing/malformed
 * expiry stays explicit rather than throwing or emitting `"Invalid Date"`.
 */
function unixSecondsToIso(seconds: unknown): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ── Projectors ───────────────────────────────────────────────────

/**
 * Project a raw `LimitOrder` to a concise `AgentLimitOrder`.
 *
 * Drops `salt`/`signature`/`maker`, adds the derived `expiresAtIso`. Optional
 * symbol/decimals fields are only set when present and well-typed so a row with no
 * metadata stays a clean identity row rather than carrying explicit `undefined`s.
 */
export function toAgentOrder(order: LimitOrder): AgentLimitOrder {
  const out: AgentLimitOrder = {
    id: order.id,
    chainId: order.chainId,
    makerAsset: order.makerAsset,
    takerAsset: order.takerAsset,
    makingAmount: order.makingAmount,
    takingAmount: order.takingAmount,
    filledMakingAmount: order.filledMakingAmount,
    filledTakingAmount: order.filledTakingAmount,
    status: order.status,
    expiredAt: order.expiredAt,
    expiresAtIso: unixSecondsToIso(order.expiredAt),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };

  if (typeof order.makerAssetSymbol === "string") out.makerAssetSymbol = order.makerAssetSymbol;
  if (typeof order.takerAssetSymbol === "string") out.takerAssetSymbol = order.takerAssetSymbol;
  if (typeof order.makerAssetDecimals === "number") out.makerAssetDecimals = order.makerAssetDecimals;
  if (typeof order.takerAssetDecimals === "number") out.takerAssetDecimals = order.takerAssetDecimals;

  return out;
}

/** Project an array of raw orders defensively (tolerates a non-array input). */
export function projectOrders(
  orders: readonly LimitOrder[] | null | undefined,
): AgentLimitOrder[] {
  return (Array.isArray(orders) ? orders : []).map(toAgentOrder);
}
