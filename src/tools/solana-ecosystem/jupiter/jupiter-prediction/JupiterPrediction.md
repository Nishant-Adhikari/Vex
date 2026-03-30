# Jupiter Prediction in `src/tools`

Local source-of-truth for the Jupiter Prediction shelf under `src/tools/solana-ecosystem/jupiter/jupiter-prediction`.

## Verified From
- `https://dev.jup.ag/docs/llms.txt`
- `https://dev.jup.ag/docs/prediction/index`
- `https://dev.jup.ag/docs/prediction/events-and-markets`
- `https://dev.jup.ag/docs/prediction/open-positions`
- `https://dev.jup.ag/docs/prediction/manage-positions`
- `https://dev.jup.ag/docs/prediction/claim-payouts`
- `https://dev.jup.ag/docs/prediction/position-data`
- `https://dev.jup.ag/docs/prediction/social-features`
- `https://dev.jup.ag/guides/how-to-build-a-prediction-market-app-on-solana`
- indexed Prediction OpenAPI entries in `llms.txt`
- Verified on `2026-03-30`

## Current Scope
- Implemented now:
  - indexed Prediction read endpoints for events, markets, orders, positions, history, profile data, leaderboards, trades, trading status, orderbook, and vault info
  - transaction request endpoints for create order, close position, close all positions, and claim position
  - local signing helpers for the transaction-returning endpoints
- Explicitly deferred in this pass:
  - legacy command and echo-agent rewiring
  - doc-only routes not backed by indexed OpenAPI, including follow/unfollow/followers/following
  - doc-only pending-order cancellation via `DELETE /orders`

## Design Notes
- This shelf is wire-first and does not flatten Prediction responses into the legacy `src/tools/chains/solana/prediction-service.ts` DTOs.
- The new Jupiter shelf must not import `src/tools/chains/solana/*`.
- Prediction remains beta; keep nullable and mixed response fields permissive where docs and examples diverge.
- All Prediction requests require `x-api-key`.
- Execution helpers use local Solana signing plus the shared RPC-based send helper, not the undocumented legacy `/prediction/v1/orders/execute` route.

## Known Contract Gaps
- Social docs mention follow/unfollow relationship routes, but the indexed OpenAPI pages available through `llms.txt` do not expose them.
- Manage Positions prose mentions `DELETE /orders` for pending-order cancellation, but the indexed OpenAPI pages do not expose it.
- Claim payout prose examples show top-level `blockhash` and `lastValidBlockHeight`, while the indexed OpenAPI uses `txMeta`. Local types keep both shapes without flattening.
