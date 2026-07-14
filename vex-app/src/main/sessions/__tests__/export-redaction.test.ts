/**
 * Tests for the session export's own conservative redaction policy
 * (../export-redaction.ts).
 *
 * Recall: secret shapes (labelled private keys, API keys, JWT, BIP39
 * mnemonic heuristic, open-ended base64 blobs across the 16-72 byte
 * matrix) must be hard-redacted. Precision: EVM/Solana addresses and tx
 * hashes must survive UNCHANGED (an export is for research/audit — the
 * whole point is that a swap's tx hash stays legible), and normal prose
 * / short benign base64-like payloads must not be touched.
 */

import { describe, it, expect } from "vitest";
import { redactForExport } from "../export-redaction.js";

function base64Secret(byteLength: number): string {
  return Buffer.alloc(byteLength, 0xff).toString("base64");
}

describe("redactForExport — recall", () => {
  it("redacts a labelled private key", () => {
    const out = redactForExport(
      "private_key: 0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318",
    );
    expect(out).toBe("[redacted]");
  });

  it("redacts an OpenRouter-shaped API key", () => {
    const out = redactForExport("Using key sk-or-v1-abc123xyz789defGHI012JKL345MNO678PQR");
    expect(out).toBe("Using key [redacted]");
  });

  it("redacts a JWT", () => {
    const out = redactForExport(
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    );
    expect(out).toBe("Bearer [redacted]");
  });

  it("redacts a 12-word BIP39-shaped phrase", () => {
    const out = redactForExport(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );
    expect(out).toBe("[redacted]");
  });

  for (const byteLength of [16, 24, 32, 40, 48, 56, 64, 72]) {
    it(`redacts a base64-encoded ${byteLength}-byte secret`, () => {
      const secret = base64Secret(byteLength);
      const out = redactForExport(`key: ${secret} end`);
      expect(out).not.toContain(secret);
      expect(out).toContain("[redacted]");
    });
  }
});

describe("redactForExport — precision", () => {
  it("leaves an EVM address untouched", () => {
    const address = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
    expect(redactForExport(`Send to ${address}`)).toBe(`Send to ${address}`);
  });

  it("leaves an EVM tx hash untouched", () => {
    const txHash =
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    expect(redactForExport(`tx ${txHash} confirmed`)).toBe(
      `tx ${txHash} confirmed`,
    );
  });

  it("leaves an ordinary Solana address untouched", () => {
    const solanaAddress = "3Nh6zJvJK6jY8t9LnGN9EmqCcTZbHVRRWkpBz1FEz1Zt";
    expect(redactForExport(`swap to ${solanaAddress} now`)).toBe(
      `swap to ${solanaAddress} now`,
    );
  });

  it("leaves a short benign base64-like payload untouched", () => {
    const benign = "aGVsbG8=";
    expect(redactForExport(`token=${benign}`)).toBe(`token=${benign}`);
  });

  it("leaves normal prose untouched", () => {
    const prose =
      "I want to buy some tokens on the exchange today for my portfolio, please help me decide.";
    expect(redactForExport(prose)).toBe(prose);
  });
});
