/**
 * Shared Solana transaction primitives for Jupiter shelves.
 */

import { type Keypair, VersionedTransaction } from "@solana/web3.js";
import { EchoError, ErrorCodes } from "../../../errors.js";

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
