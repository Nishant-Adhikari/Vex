# Wallet — Multi-chain Keystore & Signing

> Encrypted keystore management for EVM (0G, Polygon, 18+ chains) and Solana wallets. AES-256-GCM encryption with scrypt KDF, atomic file writes, viem clients for on-chain reads/writes, multi-chain auth dispatch, and native balance fetching across 40+ chains.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update descriptions, fix stale references.

---

## Directory Structure

```
src/tools/wallet/
  keystore.ts         — AES-256-GCM encrypt/decrypt, scrypt KDF, atomic save, shape validation
  solana-keystore.ts  — Solana-specific: base58/JSON secret key normalization, 64-byte keystore
  auth.ts             — requireWalletAndKeystore() — single entry point for EVM wallet+key
  multi-auth.ts       — Multi-chain dispatch: requireEvmWallet(), requireSolanaWallet(), requireWalletForChain()
  family.ts           — Chain family normalization (eip155/solana) + display formatting
  client.ts           — viem PublicClient for 0G (cached singleton, read-only)
  signingClient.ts    — viem WalletClient for 0G (signing, per-call)
  create.ts           — EVM wallet creation (generate key → encrypt → save config)
  import.ts           — EVM wallet import (validate key → encrypt → save config)
  solana-create.ts    — Solana wallet creation (Keypair.generate → encrypt → save config)
  solana-import.ts    — Solana wallet import (base58/JSON → encrypt → save config)
  native-balances.ts  — Native balance fetching across EVM + Solana chains via Khalani metadata
```

---

## Encryption (`keystore.ts`)

### KeystoreV1 format

```typescript
{
  version: 1,
  ciphertext: string,  // base64
  iv: string,          // base64, 12 bytes (GCM nonce)
  salt: string,        // base64, 32 bytes
  tag: string,         // base64, 16 bytes (GCM auth tag)
  kdf: { name: "scrypt", N: 16384, r: 8, p: 1, dkLen: 32 }
}
```

### Crypto pipeline

```
Password → scrypt(N=16384, r=8, p=1) → 256-bit key
Key + random IV (96-bit) → AES-256-GCM encrypt → ciphertext + auth tag
```

All using `node:crypto` — zero external dependencies.

### File safety

- Atomic write: tmp file → `rename()` (crash-safe)
- Permissions: `chmod 0o600` on Unix (owner-only)
- Shape validation on load: required fields checked before decrypt attempt

### API

| Function | Purpose |
|----------|---------|
| `encryptPrivateKey(pk, password)` | Encrypt 32-byte EVM private key → KeystoreV1 |
| `decryptPrivateKey(keystore, password)` | Decrypt → `0x`-prefixed Hex |
| `encryptSecretBytes(bytes, password)` | Generic byte encryption (used by Solana) |
| `decryptSecretBytes(keystore, password)` | Generic byte decryption |
| `saveKeystore(keystore)` | Save to `~/.echoclaw/keystore.json` |
| `loadKeystore()` | Load + validate shape |
| `keystoreExists()` | Check existence |
| `normalizePrivateKey(pk)` | Validate + normalize hex key |

---

## Solana Keystore (`solana-keystore.ts`)

Same encryption as EVM, but for 64-byte Solana secret keys.

### Key formats accepted

| Format | Example |
|--------|---------|
| Base58 | `5Kd3...` (standard Solana CLI export) |
| JSON byte array | `[123, 45, ...]` (64 integers, Solana Keypair format) |

### API

| Function | Purpose |
|----------|---------|
| `normalizeSolanaSecretKey(input)` | Parse base58 or JSON → 64-byte Uint8Array |
| `encryptSolanaSecretKey(key, password)` | Encrypt → KeystoreV1 |
| `decryptSolanaSecretKey(keystore, password)` | Decrypt → 64-byte Uint8Array |
| `deriveSolanaAddress(secretKey)` | Keypair → base58 public key |
| `saveSolanaKeystore(keystore)` | Save to `~/.echoclaw/solana-keystore.json` |

---

## Auth (`auth.ts` + `multi-auth.ts`)

### Single-chain (EVM)

`requireWalletAndKeystore()` — the most-used function in the codebase:
1. Check `config.wallet.address` exists
2. Get password via `requireKeystorePassword()`
3. Load + decrypt keystore
4. Return `{ address, privateKey }`

### Multi-chain dispatch (`multi-auth.ts`)

| Function | Returns |
|----------|---------|
| `requireEvmWallet()` | `{ family: "eip155", address, privateKey }` |
| `requireSolanaWallet()` | `{ family: "solana", address, secretKey }` |
| `requireWalletForChain(family)` | Dispatches to EVM or Solana based on `ChainFamily` |

Solana auth includes address mismatch detection (derived vs configured).

---

## Viem Clients

### `client.ts` — Read-only (cached)

`getPublicClient()` — singleton viem `PublicClient` for 0G Network. 10s timeout, 2 retries. Cache invalidated if RPC URL changes.

### `signingClient.ts` — Write (per-call)

`getSigningClient(privateKey)` — creates viem `WalletClient` for 0G. 30s timeout. Not cached (different keys).

---

## Wallet Creation & Import

| Function | File | Chain |
|----------|------|-------|
| `createWallet(opts?)` | `create.ts` | EVM — `generatePrivateKey()` → encrypt → save config |
| `importWallet(rawKey, opts?)` | `import.ts` | EVM — validate hex → encrypt → save config |
| `createSolanaWallet(opts?)` | `solana-create.ts` | Solana — `Keypair.generate()` → encrypt → save config |
| `importSolanaWallet(rawKey, opts?)` | `solana-import.ts` | Solana — normalize (base58/JSON) → encrypt → save config |

All support `--force` (auto-backup existing keystore before overwrite).

---

## Native Balances (`native-balances.ts`)

Fetches native currency balance across multiple chains:

- **EVM**: viem `getBalance()` via dynamic RPC from Khalani chain metadata
- **Solana**: `@solana/web3.js` `Connection.getBalance()`

`collectNativeBalances(address, family, chains, opts)` — parallel fetch, returns `NativeBalanceResult[]` with error tolerance (individual chain failures don't fail the batch).

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `node:crypto` | scrypt, AES-256-GCM (zero external crypto deps) |
| `viem` | PublicClient, WalletClient, privateKeyToAddress/Account |
| `@solana/web3.js` | Keypair, Connection, PublicKey |
| `bs58` | Solana key encoding/decoding |
| `config/store.ts` | `loadConfig()`, `saveConfig()` — wallet address persistence |
| `config/paths.ts` | `KEYSTORE_FILE`, `SOLANA_KEYSTORE_FILE` |
| `utils/env.ts` | `requireKeystorePassword()` |
| `tools/khalani/evm-client.ts` | Dynamic EVM clients for balance fetching |
| `tools/khalani/types.ts` | `ChainFamily`, `KhalaniChain` |

---

## Consumed by

Nearly every module that touches on-chain:
- `bot/executor.ts` — trade execution
- `tools/0g-compute/` — broker authentication
- `tools/jaine/` — swap routing, allowance management
- `tools/khalani/` — cross-chain bridge execution
- `tools/polymarket/` — EIP-712 order signing
- `tools/echobook/` — auth (nonce signing)
- `tools/slop/` — auth (nonce signing)
- `commands/wallet/` — CLI wallet operations
- `commands/send.ts` — native transfers
- `password/` — health checks, decrypt validation

---

## Tests

```bash
npx vitest run src/__tests__/wallet/
npx vitest run src/__tests__/keystore/
npx vitest run src/__tests__/solana/
```

| File | Coverage |
|------|----------|
| `keystore.test.ts` | Encrypt/decrypt, normalize, shape validation, atomic write |
| `multi-auth.test.ts` | EVM + Solana dispatch, address mismatch |
| `wallet-backup.test.ts` | Backup/restore |
| `wallet-balances.test.ts` | Balance fetching |
| `wallet-detect.test.ts` | Wallet detection |
| `wallet-ensure.test.ts` | Wallet ensure flow |
| `wallet-export-key.test.ts` | Key export |
| `wallet-import.test.ts` | Import (EVM + Solana) |
| `wallet-mutation-guard.test.ts` | Mutation guardrail |
| `wallet-solana-ops.test.ts` | Solana keystore ops |
| `solana-keystore.test.ts` | Base58/JSON normalization, encrypt/decrypt |
| `native-balances-solana-rpc.test.ts` | Solana balance fetching |
