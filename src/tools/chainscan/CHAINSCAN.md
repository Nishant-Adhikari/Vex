# ChainScan — 0G Block Explorer API Client

> Etherscan-compatible API client for the 0G ChainScan explorer (`chainscan.0g.ai`). Covers account queries, transaction verification, contract intel, calldata decoding, token stats, and meme coin analytics. Rate-limited with token bucket + concurrency limiter.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove endpoints, update types, fix stale references.

---

## Directory Structure

```
src/tools/chainscan/
  types.ts        — Response types: Tx, TokenTransfer, NftTransfer, ContractSource, DecodedMethod, stats
  constants.ts    — Defaults: base URL, timeouts, rate limits, batch sizes, pagination caps
  validation.ts   — Input validators: address, txHash, batch, pagination, stats pagination, tags
  client.ts       — API client singleton with rate limiting, retry, and two fetch strategies
```

---

## Client Architecture

Two fetch strategies for different endpoint styles:

| Strategy | Path pattern | Response envelope | Used by |
|----------|-------------|-------------------|---------|
| `fetchEtherscanApi` | `GET /api?module=...&action=...` | `{ status: "1", message: "OK", result: T }` | Account, Transaction, Contract, Token supply |
| `fetchCustomApi` | `GET /util/...`, `/statistics/...` | `{ status: 0, result: T }` or `{ code: 0, data: T }` | Decode, Token stats, Top addresses |

Both share:
- **TokenBucket** rate limiter (4 req/s)
- **ConcurrencyLimiter** (max 3 in-flight)
- **Retry** with exponential backoff (2 retries, retryable on 429 + 5xx)
- **Timeout** 10s per request

---

## API Methods

### Account

| Method | Endpoint | Returns |
|--------|----------|---------|
| `getBalance(address, tag?)` | `account/balance` | Wei string |
| `getBalanceMulti(addresses, tag?)` | `account/balancemulti` | `[{ account, balance }]` (max 20) |
| `getTransactions(address, opts?)` | `account/txlist` | `ChainScanTx[]` (paginated) |
| `getTokenTransfers(address, opts?)` | `account/tokentx` | `ChainScanTokenTransfer[]` |
| `getNftTransfers(address, opts?)` | `account/tokennfttx` | `ChainScanNftTransfer[]` |
| `getTokenBalance(address, contract)` | `account/tokenbalance` | Wei string |

### Transaction

| Method | Endpoint | Returns |
|--------|----------|---------|
| `getTxStatus(txHash)` | `transaction/getstatus` | `{ isError, errDescription }` |
| `getTxReceiptStatus(txHash)` | `transaction/gettxreceiptstatus` | `{ status }` |

### Contract

| Method | Endpoint | Returns |
|--------|----------|---------|
| `getContractAbi(address)` | `contract/getabi` | ABI JSON string |
| `getContractSource(address)` | `contract/getsourcecode` | `ChainScanContractSource[]` |
| `getContractCreation(addresses)` | `contract/getcontractcreation` | `[{ contractAddress, creator, txHash }]` (max 5) |

### Decode

| Method | Endpoint | Returns |
|--------|----------|---------|
| `decodeByHashes(hashes)` | `/util/decode/method` | `ChainScanDecodedMethod[]` (max 10) |
| `decodeRaw(contracts, inputs)` | `/util/decode/method/raw` | `ChainScanDecodedRaw[]` (max 10) |

### Token Stats (Meme Coin Intel)

| Method | Endpoint | Returns |
|--------|----------|---------|
| `getTokenSupply(contract)` | `stats/tokensupply` | Total supply string |
| `getTokenHolderStats(contract, opts?)` | `/statistics/token/holder` | `[{ statTime, holderCount }]` |
| `getTokenTransferStats(contract, opts?)` | `/statistics/token/transfer` | `[{ transferCount, userCount, statTime }]` |
| `getTokenUniqueParticipants(contract, opts?)` | `/statistics/token/unique/participant` | `[{ statTime, uniqueParticipant }]` |
| `getTopTokenSenders(span?)` | `/statistics/top/token/sender` | `[{ address, value }]` |
| `getTopTokenReceivers(span?)` | `/statistics/top/token/receiver` | `[{ address, value }]` |
| `getTopTokenParticipants(span?)` | `/statistics/top/token/participant` | `[{ address, value }]` |

Spans: `24h`, `3d`, `7d`.

---

## Validation (`validation.ts`)

| Validator | Rules |
|-----------|-------|
| `validateAddress(input)` | viem `isAddress` + `getAddress` checksum |
| `validateTxHash(input)` | `0x` + 64 hex chars |
| `validateAddressBatch(input, max)` | 1..max addresses |
| `validateHashBatch(input, max)` | 1..max hashes |
| `validatePagination(opts?)` | page ≥ 1, offset 1–100, sort asc/desc |
| `validateStatsPagination(opts?)` | skip 0–10000, limit 1–2000, sort asc/desc |
| `validateTag(tag?)` | One of: latest_state, latest_mined, latest_finalized, latest_confirmed, latest_checkpoint, earliest |

---

## Constants

| Constant | Value |
|----------|-------|
| Base URL | `https://chainscan.0g.ai/open` |
| Timeout | 10s |
| Rate limit | 4 req/s |
| Max concurrent | 3 |
| Max retries | 2 |
| Max batch decode | 10 |
| Max batch addresses | 5 |
| Max batch balance | 20 |
| Max page offset | 100 |

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `config/store.ts` | `loadConfig()` — ChainScan base URL |
| `utils/rateLimit.ts` | `TokenBucket`, `ConcurrencyLimiter` |
| `errors.ts` | `EchoError` with domain-specific codes |

---

## Tests

```bash
npx vitest run src/__tests__/chainscan/
```

| File | Coverage |
|------|----------|
| `chainscan-client.test.ts` | All API methods, retry, rate limiting, error mapping |
| `chainscan-validation.test.ts` | Address, txHash, batch, pagination, tag validation |
