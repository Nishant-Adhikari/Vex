# Jupiter Lend Earn REST in `src/tools`

Local source-of-truth for `https://api.jup.ag/lend/v1/earn`.

## Implemented Endpoints
- `GET /earn/tokens`
- `GET /earn/positions`
- `GET /earn/earnings`
- `POST /earn/deposit`
- `POST /earn/withdraw`
- `POST /earn/mint`
- `POST /earn/redeem`
- `POST /earn/deposit-instructions`
- `POST /earn/withdraw-instructions`
- `POST /earn/mint-instructions`
- `POST /earn/redeem-instructions`

## Local Module Rules
- `client.ts` mirrors upstream HTTP endpoints and returns raw wire responses.
- `validation.ts` enforces API key presence, Solana address validation, and integer-string amount or share inputs.
- `service.ts` adds only light normalization for upstream doc inconsistencies and optional sign-and-send helpers for unsigned base64 transactions.
- No `lite-api.jup.ag` usage is allowed here.
- No `src/tools/chains/solana/*` imports are allowed here.

## Read Endpoints
- `tokens` returns the full Earn token list, including nested asset metadata and liquidity supply data.
- `positions` accepts one or more wallet addresses and returns full per-user Earn positions.
- `earnings` accepts one wallet address plus one or more position token addresses.

## Transaction Endpoints
- `deposit` and `withdraw` take `{ asset, signer, amount }`
- `mint` and `redeem` take `{ asset, signer, shares }`
- Each returns `{ transaction }` where `transaction` is an unsigned base64 Solana transaction.

## Instruction Endpoints
- All four instruction endpoints use the same request bodies as their transaction counterparts.
- Upstream docs are inconsistent:
  - OpenAPI examples show a single `{ programId, accounts, data }`
  - narrative examples reference an `instructions` array
- Local typing preserves both shapes:
  - single instruction object
  - `{ instructions: SolanaInstructionWire[] }`
- `service.ts` normalizes both to `{ instructions, raw }`.

## Deferred Areas
- Borrow REST and SDK
- Flashloan SDK
- Read SDK
- Liquidity analytics
- Oracle helpers
- Advanced recipes using Jupiter Lite API
