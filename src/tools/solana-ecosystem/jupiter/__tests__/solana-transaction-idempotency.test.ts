/**
 * B-007 idempotency-safety guard for the SHARED Solana transaction helpers.
 *
 * These tests exercise `signAndSendVersionedTx` and
 * `signAndSubmitVersionedTxStaged` DIRECTLY (not via mocked Jupiter services),
 * driving a fake `Connection` whose `sendRawTransaction` returns a signature
 * and whose `getSignatureStatuses` then simulates a confirmation timeout or a
 * chain failure. The core invariant under guard:
 *
 *   once `sendRawTransaction` returns a signature, a confirmation
 *   timeout / retryable confirm error must NEVER trigger a second
 *   `sendRawTransaction` (no duplicate spend).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@config/store.js", () => ({
  loadConfig: () => ({
    solana: {
      rpcUrl: "http://localhost:8899",
      commitment: "confirmed",
      explorerUrl: "https://explorer.solana.com",
      cluster: "mainnet-beta",
    },
  }),
}));

const {
  signAndSendVersionedTx,
  signAndSubmitVersionedTxStaged,
} = await import("@tools/solana-ecosystem/shared/solana-transaction.js");

const { VexError, ErrorCodes } = await import("../../../../errors.js");

const {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} = await import("@solana/web3.js");
type Connection = import("@solana/web3.js").Connection;

const SIGNER = Keypair.generate();

/** A real, deserializable, signable v0 transaction blob (base64). */
function buildVersionedTxBase64(): string {
  const ix = SystemProgram.transfer({
    fromPubkey: SIGNER.publicKey,
    toPubkey: new PublicKey("11111111111111111111111111111112"),
    lamports: 1,
  });
  const message = new TransactionMessage({
    payerKey: SIGNER.publicKey,
    // 32-byte all-ones is a valid base58 blockhash placeholder for serialize.
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  return Buffer.from(tx.serialize()).toString("base64");
}

interface FakeConnectionOptions {
  /** Statuses returned in sequence by getSignatureStatuses. */
  statusSequence?: Array<{ err: unknown; confirmationStatus?: string } | null>;
  /** If set, sendRawTransaction rejects this many times before succeeding. */
  sendFailures?: number;
  /** Error thrown by sendRawTransaction failures. */
  sendError?: unknown;
}

function makeFakeConnection(opts: FakeConnectionOptions = {}) {
  const {
    statusSequence = [],
    sendFailures = 0,
    // Real `connection.sendRawTransaction` throws raw web3.js/RPC errors (not
    // VexError) on transient network failure; the pre-broadcast retry path
    // treats those as retryable because no broadcast happened yet.
    sendError = new Error("rpc send blip"),
  } = opts;

  let sendCount = 0;
  let statusIndex = 0;

  const sendRawTransaction = vi.fn(async () => {
    sendCount += 1;
    if (sendCount <= sendFailures) {
      throw sendError;
    }
    return `sig-broadcast-${sendCount}`;
  });

  const getSignatureStatuses = vi.fn(async () => {
    const value =
      statusIndex < statusSequence.length
        ? statusSequence[statusIndex]
        : null;
    statusIndex += 1;
    return { value: [value] };
  });

  // The helper only ever calls `sendRawTransaction` and
  // `getSignatureStatuses`. Single, contained assertion to satisfy the
  // `Connection` parameter without re-stubbing the entire web3.js surface.
  const connection = { sendRawTransaction, getSignatureStatuses } as unknown as Connection;

  return { connection, sendRawTransaction, getSignatureStatuses };
}

describe("solana-transaction idempotency (B-007)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("signAndSubmitVersionedTxStaged", () => {
    it("returns confirmed and sends exactly once on a successful confirmation", async () => {
      const { connection, sendRawTransaction } = makeFakeConnection({
        statusSequence: [{ err: null, confirmationStatus: "confirmed" }],
      });

      const result = await signAndSubmitVersionedTxStaged(
        buildVersionedTxBase64(),
        [SIGNER],
        { connection, confirmTimeoutMs: 5_000 },
      );

      expect(result.phase).toBe("confirmed");
      expect(result.signature).toBe("sig-broadcast-1");
      expect(sendRawTransaction).toHaveBeenCalledTimes(1);
    });

    it("INVARIANT: a post-broadcast confirmation timeout NEVER triggers a second send", async () => {
      // getSignatureStatuses always returns null => never confirms => timeout.
      const { connection, sendRawTransaction, getSignatureStatuses } =
        makeFakeConnection({ statusSequence: [] });

      const result = await signAndSubmitVersionedTxStaged(
        buildVersionedTxBase64(),
        [SIGNER],
        {
          connection,
          // Short timeout so the confirm poll loop exits quickly.
          confirmTimeoutMs: 1,
          networkRetries: 3,
        },
      );

      expect(result.phase).toBe("confirmation_unknown");
      expect(result.signature).toBe("sig-broadcast-1");
      expect(result.errorKind).toBe(ErrorCodes.SOLANA_TX_TIMEOUT);
      // The whole point: broadcast happened once, confirm-only afterwards.
      expect(sendRawTransaction).toHaveBeenCalledTimes(1);
      expect(getSignatureStatuses).toHaveBeenCalled();
    });

    it("classifies a chain revert as chain_failed and still sends exactly once", async () => {
      const { connection, sendRawTransaction } = makeFakeConnection({
        statusSequence: [{ err: { InstructionError: [0, "Custom"] } }],
      });

      const result = await signAndSubmitVersionedTxStaged(
        buildVersionedTxBase64(),
        [SIGNER],
        { connection, confirmTimeoutMs: 5_000 },
      );

      expect(result.phase).toBe("chain_failed");
      expect(result.signature).toBe("sig-broadcast-1");
      expect(sendRawTransaction).toHaveBeenCalledTimes(1);
    });

    it("retries ONLY pre-broadcast send failures (no signature yet)", async () => {
      const { connection, sendRawTransaction } = makeFakeConnection({
        sendFailures: 1,
        statusSequence: [{ err: null, confirmationStatus: "finalized" }],
      });

      const result = await signAndSubmitVersionedTxStaged(
        buildVersionedTxBase64(),
        [SIGNER],
        { connection, confirmTimeoutMs: 5_000, networkRetries: 3 },
      );

      expect(result.phase).toBe("confirmed");
      // First send threw (pre-broadcast, safe to retry); second send succeeded.
      expect(sendRawTransaction).toHaveBeenCalledTimes(2);
      expect(result.signature).toBe("sig-broadcast-2");
    });

    it("throws after exhausting pre-broadcast retries without ever confirming", async () => {
      const { connection, sendRawTransaction, getSignatureStatuses } =
        makeFakeConnection({
          sendFailures: 5,
          statusSequence: [],
        });

      await expect(
        signAndSubmitVersionedTxStaged(
          buildVersionedTxBase64(),
          [SIGNER],
          { connection, networkRetries: 2 },
        ),
      ).rejects.toBeInstanceOf(VexError);

      // Retried up to networkRetries; confirmation never attempted.
      expect(sendRawTransaction).toHaveBeenCalledTimes(2);
      expect(getSignatureStatuses).not.toHaveBeenCalled();
    });
  });

  describe("signAndSendVersionedTx (legacy Promise<string> contract)", () => {
    it("returns the signature on confirmation and sends exactly once", async () => {
      const { connection, sendRawTransaction } = makeFakeConnection({
        statusSequence: [{ err: null, confirmationStatus: "confirmed" }],
      });

      const signature = await signAndSendVersionedTx(
        buildVersionedTxBase64(),
        [SIGNER],
        { connection, confirmTimeoutMs: 5_000 },
      );

      expect(signature).toBe("sig-broadcast-1");
      expect(sendRawTransaction).toHaveBeenCalledTimes(1);
    });

    it("INVARIANT: a post-broadcast confirmation timeout throws a non-retryable error WITHOUT re-broadcasting", async () => {
      const { connection, sendRawTransaction } = makeFakeConnection({
        statusSequence: [],
      });

      let caught: unknown;
      try {
        await signAndSendVersionedTx(
          buildVersionedTxBase64(),
          [SIGNER],
          { connection, confirmTimeoutMs: 1, networkRetries: 3 },
        );
      } catch (err) {
        caught = err;
      }

      // EXACTLY ONE send across the whole call, despite networkRetries: 3.
      expect(sendRawTransaction).toHaveBeenCalledTimes(1);
      expect(caught).toBeInstanceOf(VexError);
      if (caught instanceof VexError) {
        expect(caught.code).toBe(ErrorCodes.SOLANA_TX_TIMEOUT);
        // Non-retryable so no upstream loop can turn unknown into a resend.
        expect(caught.retryable).toBe(false);
        // Signature is surfaced for on-chain inspection.
        expect(caught.hint).toContain("sig-broadcast-1");
      }
    });

    it("INVARIANT: a chain revert throws non-retryable and sends exactly once", async () => {
      const { connection, sendRawTransaction } = makeFakeConnection({
        statusSequence: [{ err: { InstructionError: [0, "Custom"] } }],
      });

      let caught: unknown;
      try {
        await signAndSendVersionedTx(
          buildVersionedTxBase64(),
          [SIGNER],
          { connection, confirmTimeoutMs: 5_000, networkRetries: 3 },
        );
      } catch (err) {
        caught = err;
      }

      expect(sendRawTransaction).toHaveBeenCalledTimes(1);
      expect(caught).toBeInstanceOf(VexError);
      if (caught instanceof VexError) {
        expect(caught.code).toBe(ErrorCodes.SOLANA_TX_FAILED);
        expect(caught.retryable).toBe(false);
        expect(caught.hint).toContain("sig-broadcast-1");
      }
    });
  });
});
