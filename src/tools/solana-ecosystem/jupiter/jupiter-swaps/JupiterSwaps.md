# Jupiter Swap API V2

Local reference for `src/tools/solana-ecosystem/jupiter/jupiter-swaps`.

## Verified From
- `https://dev.jup.ag/docs/llms.txt`
- `https://dev.jup.ag/docs/swap/index.md`
- `https://dev.jup.ag/docs/swap/order-and-execute.md`
- `https://dev.jup.ag/docs/swap/build/index.md`
- `https://dev.jup.ag/docs/swap/build/other-instructions.md`
- `https://dev.jup.ag/docs/swap/fees.md`
- `https://dev.jup.ag/docs/swap/migration.md`
- `https://dev.jup.ag/docs/swap/routing/index.md`
- `https://dev.jup.ag/docs/swap/advanced/gasless.md`
- `https://dev.jup.ag/docs/swap/advanced/compute-units.md`
- `https://dev.jup.ag/docs/swap/advanced/reduce-transaction-size.md`
- `https://dev.jup.ag/docs/swap/advanced/reduce-latency.md`
- `https://dev.jup.ag/portal/migrate-from-lite-api`
- Verified on `2026-03-30`

## Overview
Jupiter Swap API V2 unifies two swap paths behind:

- Base URL: `https://api.jup.ag/swap/v2`
- Auth: `x-api-key` header on every request

The two main paths are:

- `/order` + `/execute`
  - Best default integration path
  - Returns an assembled transaction
  - Competes across Metis, JupiterZ, Dflow, OKX
  - Managed landing via `/execute`
- `/build`
  - Advanced path for custom transactions
  - Returns raw instructions
  - Metis only
  - You assemble, sign, and send yourself

## Local Module Map
- `types.ts`
  - Full wire contracts for `/order`, `/build`, `/execute`
  - Local summary result types for service helpers
- `validation.ts`
  - API key enforcement
  - param dependency and mutual-exclusion checks
  - query normalization
- `client.ts`
  - Low-level HTTP bindings
  - no UI amount conversion
  - no token symbol lookup
- `service.ts`
  - token resolution
  - UI amount conversion
  - transaction signing for `/execute`
  - derived summaries while preserving `raw`

## Endpoint Coverage

### `GET /order`
Purpose:
- quote-only when `taker` is omitted
- quote + assembled transaction when `taker` is present

Local low-level function:
- `jupiterSwapOrder(params)`

Covered request fields:
- `inputMint`
- `outputMint`
- `amount`
- `taker`
- `receiver`
- `swapMode`
- `slippageBps`
- `referralAccount`
- `referralFee`
- `payer`
- `priorityFeeLamports`
- `jitoTipLamports`
- `broadcastFeeType`
- `excludeRouters`
- `excludeDexes`

Covered response fields:
- `mode`
- `inputMint`
- `outputMint`
- `inAmount`
- `outAmount`
- `inUsdValue`
- `outUsdValue`
- `priceImpact`
- `swapUsdValue`
- `otherAmountThreshold`
- `swapMode`
- `slippageBps`
- `priceImpactPct`
- `routePlan`
- `referralAccount`
- `feeMint`
- `feeBps`
- `platformFee`
- `signatureFeeLamports`
- `signatureFeePayer`
- `prioritizationFeeLamports`
- `prioritizationFeePayer`
- `rentFeeLamports`
- `rentFeePayer`
- `swapType`
- `router`
- `transaction`
- `lastValidBlockHeight`
- `gasless`
- `requestId`
- `totalTime`
- `taker`
- `quoteId`
- `maker`
- `expireAt`
- `errorCode`
- `errorMessage`
- `error`

Local service helper:
- `getJupiterSwapQuote(inputToken, outputToken, amount, opts)`

Returns:
- `quote`
  - normalized UI amounts
  - route labels
  - provider string
  - full `raw`
- `raw`
  - untouched `/order` response

### `GET /build`
Purpose:
- fetch raw instructions for custom transaction assembly

Local low-level function:
- `jupiterSwapBuild(params)`

Covered request fields:
- `inputMint`
- `outputMint`
- `amount`
- `taker`
- `slippageBps`
- `mode`
- `dexes`
- `excludeDexes`
- `platformFeeBps`
- `feeAccount`
- `maxAccounts`
- `payer`
- `wrapAndUnwrapSol`
- `destinationTokenAccount`
- `nativeDestinationAccount`
- `blockhashSlotsToExpiry`

Covered response fields:
- `inputMint`
- `outputMint`
- `inAmount`
- `outAmount`
- `otherAmountThreshold`
- `swapMode`
- `slippageBps`
- `routePlan`
- `computeBudgetInstructions`
- `setupInstructions`
- `swapInstruction`
- `cleanupInstruction`
- `otherInstructions`
- `addressesByLookupTableAddress`
- `blockhashWithMetadata`

Local service helper:
- `buildSwapTransaction(inputToken, outputToken, amount, opts)`

Returns:
- `build`
  - normalized UI amounts
  - route labels
  - instruction counts
  - lookup table count
  - full `raw`
- `raw`
  - untouched `/build` response

### `POST /execute`
Purpose:
- execute a signed transaction returned by `/order`

Local low-level function:
- `jupiterSwapExecute(request)`

Covered request fields:
- `signedTransaction`
- `requestId`
- `lastValidBlockHeight`

Covered response fields:
- `status`
- `signature`
- `code`
- `inputAmountResult`
- `outputAmountResult`
- `error`

Local service helper:
- `executeJupiterSwap(inputToken, outputToken, amount, secretKey, opts)`

Execution flow:
1. Resolve token metadata
2. Convert UI amount to atomic input
3. Request `/order` with `taker`
4. Sign the returned versioned transaction locally
5. Call `/execute`
6. Return combined `order + execute` result with normalized display fields

## Validation Rules Implemented
- `JUPITER_API_KEY` is mandatory
- `referralAccount` and `referralFee` must be provided together
- `dexes` and `excludeDexes` are mutually exclusive on `/build`
- `destinationTokenAccount` and `nativeDestinationAccount` are mutually exclusive on `/build`
- `feeAccount` is required when `platformFeeBps > 0`
- atomic `amount` must be a positive integer string
- supported `swapMode` is `ExactIn`
- supported build `mode` is `fast`
- Solana public keys are normalized and validated for wallet/account params

## Routing Notes
- `/order` without optional params can route across Metis, JupiterZ, Dflow, OKX
- `/order` with optional params may fall into `manual` mode and reduce router availability
- `/build` is Metis only
- `receiver`, `referralAccount`, `referralFee`, and `payer` can disable RFQ routing

## Fee Notes
- `/order`
  - Jupiter platform fee may apply
  - referral fee support exists through `referralAccount` + `referralFee`
- `/build`
  - no Jupiter swap fee
  - integrator fee support via `platformFeeBps` + `feeAccount`

Do not hardcode pricing tiers or portal commercial plans here.
Use:
- `https://portal.jup.ag/pricing`
- `https://dev.jup.ag/portal/rate-limit.md`

## Gasless Notes
- `/order` can be gasless in Jupiter-managed flows
- `gasless` is preserved from `/order` in the low-level response
- `payer` is supported on both `/order` and `/build`

## Build-Specific Notes
- `/build` returns instruction groups in this logical order:
  1. compute budget
  2. setup
  3. your pre-swap instructions
  4. swap
  5. your post-swap instructions
  6. cleanup
- `blockhashWithMetadata` is preserved
- `addressesByLookupTableAddress` is preserved
- compute unit limit is not returned by Jupiter and should be simulated separately

## Migration Notes
- Old Ultra `/order` + `/execute` logic should be treated as replaced by Swap V2 `/order` + `/execute`
- `lite-api.jup.ag` should not be used for this module
- future rewiring should migrate legacy consumers to `src/tools/solana-ecosystem/jupiter/jupiter-swaps`

## Local Usage Guidance
- Use `client.ts` when exact wire payloads matter
- Use `service.ts` when local tools need:
  - symbol-to-mint resolution
  - UI amount input
  - signed `/execute`
  - normalized summaries with `raw` preserved
