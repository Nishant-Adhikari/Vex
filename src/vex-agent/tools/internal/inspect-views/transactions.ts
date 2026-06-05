/**
 * Portfolio inspect — transactions view: the unified tx feed.
 *
 * FUSES successful activity (proj_activity) with FAILED trade-impacting mutation
 * attempts (protocol_executions WHERE success = false, this session only),
 * filtered by productType (NOT trade_side), keyset-paginated, with a txHash
 * anchor. The repo (`db/repos/transactions.ts`) owns the SQL + the cursor
 * semantics; this handler decodes the opaque cursor (bounded-fail on garbage),
 * calls the repo, and shapes the bounded result.
 */

import type { ToolResult } from "../../types.js";
import { ok, fail } from "../types.js";

export interface InspectTransactionsParams {
  productType?: string;
  namespace?: string;
  txHash?: string;
  cursor?: string;
  limit?: number;
}

export async function inspectTransactions(
  addresses: string[],
  sessionId: string | null,
  params: InspectTransactionsParams,
): Promise<ToolResult> {
  const { getTransactions } = await import("@vex-agent/db/repos/transactions.js");
  const { decodeCursor, CursorError } = await import("@vex-agent/db/repos/transactions-cursor.js");

  // Decode the opaque cursor at the boundary. Malformed input is rejected with a
  // bounded failure — never crashes the tool, never echoes the raw cursor.
  let cursor = null;
  if (params.cursor !== undefined && params.cursor !== "") {
    try {
      cursor = decodeCursor(params.cursor);
    } catch (err) {
      if (err instanceof CursorError) return fail("Invalid cursor");
      throw err;
    }
  }

  const limit = params.limit ?? 20;

  const { items, nextCursor, hasMore, failuresScope } = await getTransactions({
    addresses,
    sessionId,
    productType: params.productType,
    namespace: params.namespace,
    txHash: params.txHash,
    cursor,
    limit,
  });

  return ok({
    view: "transactions",
    count: items.length,
    failuresScope,
    transactions: items,
    nextCursor,
    hasMore,
  });
}
