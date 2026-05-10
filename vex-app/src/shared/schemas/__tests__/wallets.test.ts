/**
 * Tests for shared/schemas/wallets.ts — IPC boundary contracts for the
 * 6 wallet channels (M8). Schema drift between renderer / preload /
 * main is caught here.
 */

import { describe, expect, it } from "vitest";
import {
  chainSchema,
  walletGenerateInputSchema,
  walletGenerateEvmResultSchema,
  walletGenerateSolanaResultSchema,
  walletImportEvmInputSchema,
  walletImportSolanaInputSchema,
  walletOpenBackupFolderInputSchema,
  walletOpenBackupFolderResultSchema,
  walletRestoreInputSchema,
  walletRestoreResultSchema,
} from "../wallets.js";

describe("chainSchema", () => {
  it("accepts evm and solana", () => {
    expect(chainSchema.safeParse("evm").success).toBe(true);
    expect(chainSchema.safeParse("solana").success).toBe(true);
  });

  it("rejects unknown chains", () => {
    expect(chainSchema.safeParse("bitcoin").success).toBe(false);
    expect(chainSchema.safeParse("EVM").success).toBe(false);
    expect(chainSchema.safeParse("").success).toBe(false);
  });
});

describe("walletGenerate input/result schemas", () => {
  it("generate input rejects extra fields (strict)", () => {
    expect(walletGenerateInputSchema.safeParse({}).success).toBe(true);
    expect(
      walletGenerateInputSchema.safeParse({ chain: "evm" }).success
    ).toBe(false);
  });

  it("EVM result accepts a checksum-cased 0x-prefixed 40-hex address", () => {
    const r = walletGenerateEvmResultSchema.safeParse({
      address: "0xAbCdEf0123456789abcdef0123456789ABCDEF01",
    });
    expect(r.success).toBe(true);
  });

  it("EVM result rejects malformed addresses", () => {
    expect(
      walletGenerateEvmResultSchema.safeParse({ address: "0xshort" }).success
    ).toBe(false);
    expect(
      walletGenerateEvmResultSchema.safeParse({
        address: "1234567890123456789012345678901234567890",
      }).success
    ).toBe(false);
    expect(
      walletGenerateEvmResultSchema.safeParse({
        address: "0xZZZZ567890123456789012345678901234567890",
      }).success
    ).toBe(false);
  });

  it("Solana result accepts a typical base58 address (32 bytes -> ~43-44 chars)", () => {
    expect(
      walletGenerateSolanaResultSchema.safeParse({
        address: "11111111111111111111111111111111",
      }).success
    ).toBe(true);
    expect(
      walletGenerateSolanaResultSchema.safeParse({
        address: "DRpbCBMxVnDK7maPM5tGv6MvCsx1WTokJBKVz5Pk5Hxe",
      }).success
    ).toBe(true);
  });

  it("Solana result rejects non-base58 chars and out-of-range lengths", () => {
    expect(
      walletGenerateSolanaResultSchema.safeParse({
        address: "tooShort",
      }).success
    ).toBe(false);
    expect(
      walletGenerateSolanaResultSchema.safeParse({
        address: "0lI0lI0lI0lI0lI0lI0lI0lI0lI0lI0lI",
      }).success
    ).toBe(false);
  });
});

describe("walletImport input schemas", () => {
  it("EVM import requires a non-empty rawKey, strict against extras", () => {
    expect(
      walletImportEvmInputSchema.safeParse({ rawKey: "0xabc" }).success
    ).toBe(true);
    expect(
      walletImportEvmInputSchema.safeParse({ rawKey: "" }).success
    ).toBe(false);
    expect(
      walletImportEvmInputSchema.safeParse({
        rawKey: "0xabc",
        chain: "evm",
      }).success
    ).toBe(false);
  });

  it("Solana import requires a non-empty rawKey, strict against extras", () => {
    expect(
      walletImportSolanaInputSchema.safeParse({ rawKey: "anything" }).success
    ).toBe(true);
    expect(
      walletImportSolanaInputSchema.safeParse({ rawKey: "" }).success
    ).toBe(false);
  });
});

describe("walletRestore input/result schemas", () => {
  it("input requires only chain (single roundtrip — no path)", () => {
    expect(
      walletRestoreInputSchema.safeParse({ chain: "evm" }).success
    ).toBe(true);
    expect(
      walletRestoreInputSchema.safeParse({}).success
    ).toBe(false);
    expect(
      walletRestoreInputSchema.safeParse({
        chain: "evm",
        sourcePath: "/tmp/keystore.json",
      }).success
    ).toBe(false);
  });

  it("result accepts nullable replacedAddress + backupDir", () => {
    expect(
      walletRestoreResultSchema.safeParse({
        chain: "evm",
        address: "0xabcdef0123456789abcdef0123456789abcdef01",
        replacedAddress: null,
        backupDir: null,
      }).success
    ).toBe(true);
    expect(
      walletRestoreResultSchema.safeParse({
        chain: "solana",
        address: "DRpbCBMxVnDK7maPM5tGv6MvCsx1WTokJBKVz5Pk5Hxe",
        replacedAddress: "DSomethingElseDifferentAddressForTesting1234",
        backupDir: "/home/user/.config/vex/backups/20260510T120000Z",
      }).success
    ).toBe(true);
  });

  it("result rejects missing required fields", () => {
    expect(
      walletRestoreResultSchema.safeParse({
        chain: "evm",
        address: "0xabcdef0123456789abcdef0123456789abcdef01",
      }).success
    ).toBe(false);
  });
});

describe("walletOpenBackupFolder schemas", () => {
  it("input requires a non-empty backupDir", () => {
    expect(
      walletOpenBackupFolderInputSchema.safeParse({
        backupDir: "/some/path",
      }).success
    ).toBe(true);
    expect(
      walletOpenBackupFolderInputSchema.safeParse({ backupDir: "" }).success
    ).toBe(false);
  });

  it("result is a strict {ok:boolean}", () => {
    expect(
      walletOpenBackupFolderResultSchema.safeParse({ ok: true }).success
    ).toBe(true);
    expect(
      walletOpenBackupFolderResultSchema.safeParse({}).success
    ).toBe(false);
    expect(
      walletOpenBackupFolderResultSchema.safeParse({
        ok: true,
        path: "/foo",
      }).success
    ).toBe(false);
  });
});
