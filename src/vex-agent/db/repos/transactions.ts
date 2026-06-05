/**
 * Transactions repo (Stage 9) — the unified, keyset-paginated tx feed behind the
 * `portfolio` tool's `transactions` view.
 *
 * It FUSES two halves into ONE bounded row shape, then keyset-paginates the
 * union:
 *   - SUCCESS half — proj_activity rows for the session's selected wallet set
 *     (source='success', sourceRank=0). Carries the trade economics.
 *   - FAILURE half — protocol_executions WHERE success = false for the CURRENT
 *     session, restricted to the trade-impacting failure-tool allowlist
 *     (source='failure', sourceRank=1). Carries NO economics — failures never
 *     produced a fill — and is selected with ONLY bounded columns:
 *     `params`, `result`, and `trade_capture` are NEVER selected (they may hold
 *     raw provider/error payloads — data-exposure invariant).
 *
 * Filters: productType filters proj_activity.product_type on the success half
 * and the DERIVED PRODUCT (via the failure-tool allowlist) on the failure half —
 * NEVER trade_side. namespace + txHash filter BOTH halves. A null/empty
 * sessionId OMITS the failure half entirely (successes only) — a failure feed
 * is meaningless without a session to scope it to, and must never leak another
 * session's failures.
 *
 * Pagination: keyset over the tuple (created_at, sourceRank, id), DESC. The
 * cursor timestamp is the DB-side microsecond rendering of created_at (see
 * `transactions-cursor.ts`) so sub-millisecond ties paginate correctly. Fetches
 * limit+1 to detect `hasMore`; `nextCursor` is minted from the last KEPT row.
 *
 * Migration: `src/vex-agent/db/migrations/030_transactions_indexes.sql`.
 */

import { query } from "../client.js";
import {
  encodeCursor,
  type DecodedCursor,
} from "./transactions-cursor.js";
import {
  FAILURE_TOOL_PRODUCTS,
  failureToolsForProduct,
} from "./transactions-failure-tools.js";

export type TransactionSource = "success" | "failure";

/** One bounded, camelCase row in the unified feed. Failure rows carry no economics. */
export interface TransactionRow {
  source: TransactionSource;
  id: number;
  namespace: string;
  productType: string;
  tradeSide?: string | null;
  chain?: string | null;
  inputToken?: string | null;
  inputAmount?: string | null;
  outputToken?: string | null;
  outputAmount?: string | null;
  valueUsd?: number | null;
  captureStatus?: string | null;
  status?: string | null;
  toolId?: string | null;
  durationMs?: number | null;
  txHash: string | null;
  createdAt: string;
}

export interface GetTransactionsOptions {
  addresses: string[];
  sessionId: string | null;
  productType?: string;
  namespace?: string;
  txHash?: string;
  cursor?: DecodedCursor | null;
  limit: number;
}

export interface GetTransactionsResult {
  items: TransactionRow[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Always 'session' — failures are scoped to the current session only. */
  failuresScope: "session";
}

// Microsecond-precision UTC render of created_at, used BOTH as the keyset
// boundary value (compared via ::timestamptz) and as the minted cursor's
// cursorTs. Round-trips losslessly through ::timestamptz.
const CURSOR_TS_EXPR = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Build the per-half keyset predicate for DESC ordering on
 * (created_at, sourceRank, id). `sourceRank` is a constant per half so the
 * comparison is specialised (index-friendly) rather than a row-value compare.
 * Returns "" when no cursor (first page).
 */
function keysetPredicate(
  sourceRank: 0 | 1,
  cursor: DecodedCursor | null | undefined,
  tsParam: number,
  rankParam: number,
  idParam: number,
): string {
  if (!cursor) return "";
  return (
    `AND (created_at < $${tsParam}::timestamptz` +
    ` OR (created_at = $${tsParam}::timestamptz AND ${sourceRank} < $${rankParam}::int)` +
    ` OR (created_at = $${tsParam}::timestamptz AND ${sourceRank} = $${rankParam}::int AND id < $${idParam}::int))`
  );
}

/**
 * Fetch the unified transaction feed for the session's wallet set. See module
 * doc for the half semantics, filters, and pagination contract.
 */
export async function getTransactions(opts: GetTransactionsOptions): Promise<GetTransactionsResult> {
  const { addresses, sessionId, productType, namespace, txHash, cursor, limit } = opts;
  const hasSession = typeof sessionId === "string" && sessionId.length > 0;

  // Empty wallet set → the success half matches nothing (ANY('{}')). The failure
  // half is session-scoped, not wallet-scoped, so it can still surface rows; but
  // with no wallets there is no portfolio context to report against, so we keep
  // the same fail-closed posture as the other wallet-scoped views and return [].
  if (addresses.length === 0) {
    return { items: [], nextCursor: null, hasMore: false, failuresScope: "session" };
  }

  const params: unknown[] = [];
  const push = (value: unknown): number => {
    params.push(value);
    return params.length;
  };

  // Cursor binds — shared across both halves so the keyset boundary is identical.
  const tsParam = cursor ? push(cursor.cursorTs) : 0;
  const rankParam = cursor ? push(cursor.sourceRank) : 0;
  const idParam = cursor ? push(cursor.id) : 0;

  // ── SUCCESS half (proj_activity) ──────────────────────────────────────
  const successConds: string[] = [`wallet_address = ANY($${push(addresses)}::text[])`];
  if (productType !== undefined) successConds.push(`product_type = $${push(productType)}`);
  if (namespace !== undefined) successConds.push(`namespace = $${push(namespace)}`);
  if (txHash !== undefined) successConds.push(`external_refs->>'txHash' = $${push(txHash)}`);
  const successKeyset = keysetPredicate(0, cursor, tsParam, rankParam, idParam);

  const successHalf = `
    SELECT
      'success'::text AS source,
      0 AS source_rank,
      id,
      namespace,
      product_type AS product_type,
      trade_side,
      chain,
      input_token,
      input_amount,
      output_token,
      output_amount,
      value_usd,
      capture_status,
      NULL::text AS status,
      NULL::text AS tool_id,
      NULL::int AS duration_ms,
      external_refs->>'txHash' AS tx_hash,
      created_at,
      ${CURSOR_TS_EXPR} AS cursor_ts
    FROM proj_activity
    WHERE ${successConds.join(" AND ")} ${successKeyset}`;

  const halves: string[] = [successHalf];

  // ── FAILURE half (protocol_executions WHERE success = false) ──────────
  // Omitted entirely without a session — never leak another session's failures.
  if (hasSession) {
    const failTools = failureToolsForProduct(productType);
    // An empty allowlist (unknown productType) means the failure half matches
    // nothing; ANY('{}') achieves that without a special case.
    const failConds: string[] = [
      "success = false",
      `session_id = $${push(sessionId)}`,
      `tool_id = ANY($${push(failTools)}::text[])`,
    ];
    if (namespace !== undefined) failConds.push(`namespace = $${push(namespace)}`);
    if (txHash !== undefined) failConds.push(`external_refs->>'txHash' = $${push(txHash)}`);
    const failureKeyset = keysetPredicate(1, cursor, tsParam, rankParam, idParam);

    // NOTE: select ONLY bounded columns — NEVER params, result, or trade_capture.
    halves.push(`
    SELECT
      'failure'::text AS source,
      1 AS source_rank,
      id,
      namespace,
      NULL::text AS product_type,
      NULL::text AS trade_side,
      NULL::text AS chain,
      NULL::text AS input_token,
      NULL::text AS input_amount,
      NULL::text AS output_token,
      NULL::text AS output_amount,
      NULL::numeric AS value_usd,
      NULL::text AS capture_status,
      'failed'::text AS status,
      tool_id,
      duration_ms,
      external_refs->>'txHash' AS tx_hash,
      created_at,
      ${CURSOR_TS_EXPR} AS cursor_ts
    FROM protocol_executions
    WHERE ${failConds.join(" AND ")} ${failureKeyset}`);
  }

  const limitParam = push(limit + 1);
  const sql = `${halves.join("\n    UNION ALL\n")}
    ORDER BY created_at DESC, source_rank DESC, id DESC
    LIMIT $${limitParam}`;

  const rows = await query<Record<string, unknown>>(sql, params);

  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const items = kept.map(mapRow);

  const lastKept = kept[kept.length - 1];
  const nextCursor = hasMore && lastKept !== undefined
    ? encodeCursor({
        cursorTs: lastKept.cursor_ts as string,
        sourceRank: Number(lastKept.source_rank) === 1 ? 1 : 0,
        id: Number(lastKept.id),
      })
    : null;

  return { items, nextCursor, hasMore, failuresScope: "session" };
}

function mapRow(r: Record<string, unknown>): TransactionRow {
  const source: TransactionSource = r.source === "failure" ? "failure" : "success";
  const toolId = r.tool_id as string | null;

  if (source === "failure") {
    // Failure rows carry no economics. Derive the product from the allowlist
    // (matches what the success half stores) so the model can group both halves
    // by the same productType. Unknown tools fall back to "unknown".
    const product = (toolId !== null && FAILURE_TOOL_PRODUCTS.get(toolId)) || "unknown";
    return {
      source,
      id: Number(r.id),
      namespace: r.namespace as string,
      productType: product,
      status: (r.status as string | null) ?? "failed",
      toolId,
      durationMs: r.duration_ms === null || r.duration_ms === undefined ? null : Number(r.duration_ms),
      txHash: (r.tx_hash as string | null) ?? null,
      createdAt: toIso(r.created_at),
    };
  }

  return {
    source,
    id: Number(r.id),
    namespace: r.namespace as string,
    productType: r.product_type as string,
    tradeSide: (r.trade_side as string | null) ?? null,
    chain: (r.chain as string | null) ?? null,
    inputToken: (r.input_token as string | null) ?? null,
    inputAmount: (r.input_amount as string | null) ?? null,
    outputToken: (r.output_token as string | null) ?? null,
    outputAmount: (r.output_amount as string | null) ?? null,
    valueUsd: r.value_usd === null || r.value_usd === undefined ? null : Number(r.value_usd),
    captureStatus: (r.capture_status as string | null) ?? null,
    txHash: (r.tx_hash as string | null) ?? null,
    createdAt: toIso(r.created_at),
  };
}

// TIMESTAMPTZ comes back as a Date (node-postgres) or a string; normalise to ISO.
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
