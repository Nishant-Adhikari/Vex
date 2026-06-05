/**
 * Shared Solana transaction primitives for Jupiter shelves.
 */

import { createHash } from "node:crypto";
import { Connection, type Commitment, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { loadConfig } from "../../../config/store.js";
import { VexError, ErrorCodes } from "../../../errors.js";
import { solanaExplorerUrl } from "./solana-validation.js";

const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;
const CONFIRM_POLL_INTERVAL_MS = 2_000;
const DEFAULT_SEND_RETRIES = 2;
const DEFAULT_NETWORK_RETRIES = 3;

export function deserializeVersionedTx(input: Uint8Array | string): VersionedTransaction {
  try {
    const bytes = typeof input === "string" ? Buffer.from(input, "base64") : input;
    return VersionedTransaction.deserialize(bytes);
  } catch (err) {
    throw new VexError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Failed to deserialize transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function getConfiguredSolanaConnection(): Connection {
  const cfg = loadConfig();
  return new Connection(
    cfg.solana.rpcUrl,
    { commitment: cfg.solana.commitment as Commitment },
  );
}

export async function sendSignedVersionedTx(
  connection: Connection,
  tx: VersionedTransaction,
  options: {
    skipPreflight?: boolean;
    sendMaxRetries?: number;
    confirmTimeoutMs?: number;
  } = {},
): Promise<string> {
  const {
    skipPreflight = false,
    sendMaxRetries = DEFAULT_SEND_RETRIES,
    confirmTimeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
  } = options;

  let signature: string;

  try {
    signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight,
      maxRetries: sendMaxRetries,
    });
  } catch (err) {
    const error = new VexError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Failed to send transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
    error.retryable = true;
    throw error;
  }

  await confirmVersionedTx(connection, signature, confirmTimeoutMs);
  return signature;
}

export async function confirmVersionedTx(
  connection: Connection,
  signature: string,
  timeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];

    if (status) {
      if (status.err) {
        throw new VexError(
          ErrorCodes.SOLANA_TX_FAILED,
          `Transaction failed: ${JSON.stringify(status.err)}`,
          `Explorer: ${solanaExplorerUrl(signature)}`,
        );
      }

      if (
        status.confirmationStatus === "confirmed"
        || status.confirmationStatus === "finalized"
      ) {
        return;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_INTERVAL_MS));
  }

  const error = new VexError(
    ErrorCodes.SOLANA_TX_TIMEOUT,
    `Transaction confirmation timed out after ${timeoutMs}ms`,
    `Signature: ${signature}\nExplorer: ${solanaExplorerUrl(signature)}`,
  );
  error.retryable = true;
  throw error;
}

/**
 * Idempotency-safe broadcast of a signed versioned transaction.
 *
 * Splits the operation into two distinct phases so a retryable error after
 * broadcast can NEVER trigger a second `sendRawTransaction` (= duplicate
 * spend):
 *
 *   1. Pre-broadcast: `sendRawTransaction` is retried up to `networkRetries`
 *      times. This is safe because no transaction has hit the chain yet — a
 *      retryable send failure means the broadcast did not happen.
 *   2. Post-broadcast: once a signature is returned, the function switches to
 *      CONFIRM-ONLY. A confirmation timeout / unrecognised confirm error is
 *      surfaced as `confirmation_unknown` with the signature attached; it is
 *      NEVER re-broadcast.
 *
 * Returns a `StagedSubmissionResult` whose `signature` is always present.
 * Confirmation classification matches `signAndSubmitLegacyTxStaged`.
 */
export async function signAndSubmitVersionedTxStaged(
  txInput: Uint8Array | string,
  signers: Keypair[],
  options: {
    connection?: Connection;
    skipPreflight?: boolean;
    sendMaxRetries?: number;
    confirmTimeoutMs?: number;
    networkRetries?: number;
  } = {},
): Promise<StagedSubmissionResult> {
  const {
    connection = getConfiguredSolanaConnection(),
    networkRetries = DEFAULT_NETWORK_RETRIES,
    skipPreflight = false,
    sendMaxRetries = DEFAULT_SEND_RETRIES,
    confirmTimeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
  } = options;

  const tx = deserializeVersionedTx(txInput);
  signVersionedTx(tx, signers);
  const serialized = tx.serialize();

  // ── Phase 1: pre-broadcast send (retry-safe; no signature exists yet) ──
  let signature: string | undefined;
  let lastSendError: unknown;
  for (let attempt = 1; attempt <= networkRetries; attempt += 1) {
    try {
      signature = await connection.sendRawTransaction(serialized, {
        skipPreflight,
        maxRetries: sendMaxRetries,
      });
      break;
    } catch (err) {
      lastSendError = err;
      const retryable = err instanceof VexError ? err.retryable : true;
      if (!retryable || attempt >= networkRetries) {
        throw new VexError(
          ErrorCodes.SOLANA_TX_FAILED,
          `Failed to send transaction: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Unreachable in practice (loop either sets `signature` or throws), but the
  // narrowing keeps the post-broadcast section type-safe without a `!`.
  if (signature === undefined) {
    throw new VexError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Failed to send transaction: ${lastSendError instanceof Error ? lastSendError.message : String(lastSendError)}`,
    );
  }

  // ── Phase 2: post-broadcast confirm-only (NEVER re-broadcasts) ──
  try {
    await confirmVersionedTx(connection, signature, confirmTimeoutMs);
    return { signature, phase: "confirmed" };
  } catch (cause) {
    const phase = classifyConfirmFailure(cause);
    const errorKind =
      cause instanceof VexError
        ? cause.code
        : cause instanceof Error
          ? cause.constructor.name
          : typeof cause;
    return {
      signature,
      phase,
      errorKind,
      errorHash: structuralHash(cause),
    };
  }
}

/**
 * Idempotency-safe versioned send that preserves the original
 * `Promise<string>` contract for callers that expect a confirmed signature.
 *
 * Delegates to `signAndSubmitVersionedTxStaged`, so `sendRawTransaction` runs
 * AT MOST ONCE per call path that reaches broadcast. Post-broadcast outcomes
 * are mapped to the legacy throw contract WITHOUT resending:
 *
 *   - `confirmed`            -> returns the signature.
 *   - `chain_failed`         -> throws `SOLANA_TX_FAILED` (non-retryable;
 *                               the chain rejected it, a resend would not be
 *                               idempotent).
 *   - `confirmation_unknown` -> throws `SOLANA_TX_TIMEOUT` (non-retryable),
 *                               with the signature in the hint so callers can
 *                               inspect on-chain state instead of resending.
 *
 * The thrown errors carry `retryable = false` so no upstream retry loop can
 * turn an unknown post-broadcast state into a duplicate broadcast.
 */
export async function signAndSendVersionedTx(
  txInput: Uint8Array | string,
  signers: Keypair[],
  options: {
    connection?: Connection;
    skipPreflight?: boolean;
    sendMaxRetries?: number;
    confirmTimeoutMs?: number;
    networkRetries?: number;
  } = {},
): Promise<string> {
  const submission = await signAndSubmitVersionedTxStaged(txInput, signers, options);

  if (submission.phase === "confirmed") {
    return submission.signature;
  }

  if (submission.phase === "chain_failed") {
    const error = new VexError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Transaction failed after broadcast (${submission.errorKind ?? "unknown"})`,
      `Signature: ${submission.signature}\nExplorer: ${solanaExplorerUrl(submission.signature)}`,
    );
    error.retryable = false;
    throw error;
  }

  // confirmation_unknown: broadcast happened, confirmation did not resolve.
  // Surface the on-chain trace; do NOT resend.
  const error = new VexError(
    ErrorCodes.SOLANA_TX_TIMEOUT,
    `Transaction broadcast but confirmation is unknown (${submission.errorKind ?? "unknown"})`,
    `Signature: ${submission.signature}\nExplorer: ${solanaExplorerUrl(submission.signature)}`,
  );
  error.retryable = false;
  throw error;
}

export function signVersionedTx(
  tx: VersionedTransaction,
  signers: Keypair[],
): VersionedTransaction {
  try {
    tx.sign(signers);
    return tx;
  } catch (err) {
    throw new VexError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Failed to sign transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Connection singleton ────────────────────────────────────────

let connectionInstance: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (connectionInstance) return connectionInstance;

  const cfg = loadConfig();
  const rpcUrl = cfg.solana.rpcUrl;
  const commitment = (cfg.solana.commitment ?? "confirmed") as Commitment;

  connectionInstance = new Connection(rpcUrl, commitment);
  return connectionInstance;
}

export function resetSolanaConnection(): void {
  connectionInstance = null;
}

// ── Legacy transaction helper ───────────────────────────────────

export async function signAndSendLegacyTx(
  transaction: Transaction,
  keypair: Keypair,
  opts?: { connection?: Connection },
): Promise<string> {
  const connection = opts?.connection ?? getSolanaConnection();

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = keypair.publicKey;
  transaction.sign(keypair);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 2,
  });

  await confirmVersionedTx(connection, signature);
  return signature;
}

// ── Staged legacy transaction helper (puzzle 5 phase 4) ─────────
//
// Additive variant for wallet_send_confirm that structurally surfaces the
// post-broadcast signature even when confirmation fails. Caller can then
// route to `markFailed(tx_hash=signature)` instead of losing the on-chain
// trace inside an opaque throw.
//
// The existing `signAndSendLegacyTx` is preserved verbatim for Jupiter
// swap and other callers that prefer the throw-on-any-error contract.
// Codex puzzle-5 phase-4 review point 1 (v3 GREEN LIGHT condition).

export type StagedSubmissionPhase =
  | "confirmed"
  | "chain_failed"
  | "confirmation_unknown";

export interface StagedSubmissionResult {
  /**
   * On-chain signature. ALWAYS present — `signAndSubmitLegacyTxStaged`
   * only returns after `sendRawTransaction` succeeds. Pre-broadcast
   * failures (signing, blockhash fetch, send) throw out instead.
   */
  signature: string;
  phase: StagedSubmissionPhase;
  /** Structural error label only — never raw cause message. */
  errorKind?: string;
  errorHash?: string;
}

/**
 * Submit a legacy `Transaction` and report the post-broadcast outcome
 * as a discriminated `phase`. Pre-broadcast failures (signing, blockhash
 * fetch, `sendRawTransaction`) throw out — caller wraps to map them to
 * `pre_broadcast_failed` in the wallet runtime path.
 *
 * Confirmation outcome classification:
 *   - `confirmed`              — `confirmVersionedTx` returned normally.
 *   - `chain_failed`           — `VexError` with code `SOLANA_TX_FAILED`
 *                                (chain reverted; status.err present).
 *   - `confirmation_unknown`   — `VexError` with code `SOLANA_TX_TIMEOUT`
 *                                OR an unrecognised throw (fall-through
 *                                via regex on the message). Broadcast
 *                                already happened; operator needs the
 *                                signature to inspect on-chain.
 */
export async function signAndSubmitLegacyTxStaged(
  transaction: Transaction,
  keypair: Keypair,
  opts?: { connection?: Connection },
): Promise<StagedSubmissionResult> {
  const connection = opts?.connection ?? getSolanaConnection();

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = keypair.publicKey;
  transaction.sign(keypair);

  // Pre-broadcast: any throw from sendRawTransaction bubbles out.
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: false, maxRetries: 2 },
  );

  // Broadcast happened — anything below is post-broadcast.
  try {
    await confirmVersionedTx(connection, signature);
    return { signature, phase: "confirmed" };
  } catch (cause) {
    const phase = classifyConfirmFailure(cause);
    const errorKind =
      cause instanceof VexError
        ? cause.code
        : cause instanceof Error
          ? cause.constructor.name
          : typeof cause;
    return {
      signature,
      phase,
      errorKind,
      errorHash: structuralHash(cause),
    };
  }
}

function classifyConfirmFailure(cause: unknown): StagedSubmissionPhase {
  // Primary classifier — VexError code from the confirm helper.
  if (cause instanceof VexError) {
    if (cause.code === ErrorCodes.SOLANA_TX_FAILED) return "chain_failed";
    if (cause.code === ErrorCodes.SOLANA_TX_TIMEOUT) {
      return "confirmation_unknown";
    }
  }
  // Fallback regex (Codex puzzle-5 phase-4 review point 1 acceptance):
  // VexError code is authoritative; regex catches third-party errors that
  // bypass the typed wrapper.
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/reverted|simulation failed|transaction failed/i.test(message)) {
    return "chain_failed";
  }
  return "confirmation_unknown";
}

function structuralHash(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return createHash("sha256").update(message).digest("hex").slice(0, 16);
}
