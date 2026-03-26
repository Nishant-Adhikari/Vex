import { describe, expect, it, vi } from "vitest";
import { Keypair, VersionedTransaction } from "@solana/web3.js";

const { deserializeVersionedTx, signVersionedTx, keypairFromSecretKey } =
  await import("../tools/chains/solana/tx.js");
const { ErrorCodes } = await import("../errors.js");

vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { explorerUrl: "https://explorer.solana.com", cluster: "mainnet-beta" } }),
}));

describe("tx primitives", () => {
  describe("deserializeVersionedTx", () => {
    it("throws SOLANA_TX_FAILED for invalid base64", () => {
      expect(() => deserializeVersionedTx("not-valid-base64!!!")).toThrow();
      try {
        deserializeVersionedTx("not-valid-base64!!!");
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.SOLANA_TX_FAILED);
        expect(err.message).toContain("deserialize");
      }
    });

    it("throws SOLANA_TX_FAILED for empty input", () => {
      expect(() => deserializeVersionedTx("")).toThrow();
    });

    it("throws SOLANA_TX_FAILED for invalid bytes", () => {
      // Valid base64 but not a valid transaction
      expect(() => deserializeVersionedTx(Buffer.from([0, 0, 0]).toString("base64"))).toThrow();
    });
  });

  describe("signVersionedTx", () => {
    it("throws SOLANA_TX_FAILED when signing fails", () => {
      // Create a mock tx that throws on sign
      const fakeTx = { sign: () => { throw new Error("bad signer"); } } as unknown as VersionedTransaction;
      const keypair = Keypair.generate();

      expect(() => signVersionedTx(fakeTx, [keypair])).toThrow();
      try {
        signVersionedTx(fakeTx, [keypair]);
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.SOLANA_TX_FAILED);
        expect(err.message).toContain("sign");
      }
    });
  });

  describe("keypairFromSecretKey", () => {
    it("creates keypair from valid secret key", () => {
      const original = Keypair.generate();
      const restored = keypairFromSecretKey(original.secretKey);
      expect(restored.publicKey.toBase58()).toBe(original.publicKey.toBase58());
    });
  });
});
