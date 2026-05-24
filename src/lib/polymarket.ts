/**
 * Cross-boundary re-export so vex-app (Electron main) can pull the
 * canonical Polymarket credential primitives via `@vex-lib/polymarket.js`
 * without reaching outside the alias scope (mirrors `src/lib/wallet.ts`).
 *
 * The implementations live under `src/tools/wallet/polymarket-credentials.ts`
 * and stay the single source of truth for the EIP-712 ClobAuth signing
 * flow + derive/create API key sequence. vex-shell (CLI) consumes
 * `deriveAndSavePolymarketCredentials` directly via the legacy import path;
 * vex-app uses the env-free `acquirePolymarketCredentialsWithPassword`
 * primitive exported here.
 */

export {
  acquirePolymarketCredentialsWithPassword,
  deriveAndSavePolymarketCredentials,
  type AcquireResult,
  type AcquiredPolymarketCredentials,
  type DeriveResult,
} from "../tools/wallet/polymarket-credentials.js";
