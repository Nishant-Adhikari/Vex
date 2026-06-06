/**
 * Retrieval metadata for Polymarket CLOB tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/clob.ts` references entries by `toolId`.
 *
 * FAÇADE: the entries were split into per-resource chunk modules under
 * `./clob/` (markets / orders / account), mirroring the CLOB handler/manifest
 * grouping. The object is re-assembled here preserving the EXACT original key
 * order. That order interleaves resources in the tail — `trades` (account),
 * then `simplifiedMarkets` (markets), then `rebates`/`heartbeat` (account),
 * then `cancelOrders` (orders), then `orderScoring` (account) — so each chunk
 * exposes its head block and tail outliers as separately-spreadable segments
 * and they are spread below in the sequence that reproduces the original.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import {
  MARKETS_HEAD_DISCOVERY,
  MARKETS_SIMPLIFIED_DISCOVERY,
} from "./clob/markets.js";
import {
  ORDERS_HEAD_DISCOVERY,
  ORDERS_CANCEL_ORDERS_DISCOVERY,
} from "./clob/orders.js";
import {
  ACCOUNT_TRADES_DISCOVERY,
  ACCOUNT_REBATES_HEARTBEAT_DISCOVERY,
  ACCOUNT_ORDER_SCORING_DISCOVERY,
} from "./clob/account.js";

export const POLYMARKET_CLOB_DISCOVERY = {
  ...MARKETS_HEAD_DISCOVERY,
  ...ORDERS_HEAD_DISCOVERY,
  ...ACCOUNT_TRADES_DISCOVERY,
  ...MARKETS_SIMPLIFIED_DISCOVERY,
  ...ACCOUNT_REBATES_HEARTBEAT_DISCOVERY,
  ...ORDERS_CANCEL_ORDERS_DISCOVERY,
  ...ACCOUNT_ORDER_SCORING_DISCOVERY,
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 28;
if (Object.keys(POLYMARKET_CLOB_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `POLYMARKET_CLOB_DISCOVERY has ${Object.keys(POLYMARKET_CLOB_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
