/**
 * Shared Solana transaction primitives for Jupiter shelves.
 */

import { Connection, type Commitment, type Keypair, VersionedTransaction } from "@solana/web3.js";
import { loadConfig } from "../../../config/store.js";
import { EchoError, ErrorCodes } from "../../../errors.js";
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
    throw new EchoError(
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
    const error = new EchoError(
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
        throw new EchoError(
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

  const error = new EchoError(
    ErrorCodes.SOLANA_TX_TIMEOUT,
    `Transaction confirmation timed out after ${timeoutMs}ms`,
    `Signature: ${signature}\nExplorer: ${solanaExplorerUrl(signature)}`,
  );
  error.retryable = true;
  throw error;
}

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
  const {
    connection = getConfiguredSolanaConnection(),
    networkRetries = DEFAULT_NETWORK_RETRIES,
    ...sendOptions
  } = options;

  const tx = deserializeVersionedTx(txInput);
  signVersionedTx(tx, signers);

  let lastError: unknown;
  for (let attempt = 1; attempt <= networkRetries; attempt += 1) {
    try {
      return await sendSignedVersionedTx(connection, tx, sendOptions);
    } catch (err) {
      lastError = err;
      if (!(err instanceof EchoError) || !err.retryable || attempt >= networkRetries) {
        throw err;
      }
    }
  }

  throw lastError;
}

export function signVersionedTx(
  tx: VersionedTransaction,
  signers: Keypair[],
): VersionedTransaction {
  try {
    tx.sign(signers);
    return tx;
  } catch (err) {
    throw new EchoError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Failed to sign transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
