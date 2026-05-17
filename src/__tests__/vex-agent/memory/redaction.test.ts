import { describe, it, expect } from "vitest";
import { redact, redactObject } from "../../../vex-agent/memory/redaction.js";

describe("redact — Tier 1 hard redact", () => {
  it("redacts labelled private key (0x prefix)", () => {
    const text = "private_key: 0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
    const r = redact(text);
    expect(r.text).toContain("[REDACTED:private_key]");
    expect(r.text).not.toContain("0x4c0883a6");
    expect(r.hardRedactCount).toBe(1);
  });

  it("redacts labelled private key (no 0x prefix, 64 hex)", () => {
    const text = "seed_key=4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
    const r = redact(text);
    expect(r.text).toContain("[REDACTED:private_key]");
    expect(r.hardRedactCount).toBe(1);
  });

  it("redacts OpenRouter API key", () => {
    const text = "Using API key sk-or-v1-abc123xyz789defGHI012JKL345MNO678PQR";
    const r = redact(text);
    expect(r.text).toContain("[REDACTED:api_key]");
    expect(r.hardRedactCount).toBe(1);
  });

  it("redacts Anthropic API key", () => {
    const text = "key=sk-ant-api03-abcdef12345678901234567890XYZ";
    const r = redact(text);
    expect(r.text).toContain("[REDACTED:api_key]");
    expect(r.hardRedactCount).toBe(1);
  });

  it("redacts JWT bearer token", () => {
    const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const r = redact(text);
    expect(r.text).toContain("[REDACTED:jwt]");
    expect(r.hardRedactCount).toBe(1);
  });

  it("redacts BIP39-like phrase (12 words)", () => {
    const text = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const r = redact(text);
    expect(r.text).toContain("[REDACTED:mnemonic]");
    expect(r.hardRedactCount).toBe(1);
  });

  it("does NOT redact 12 words separated by punctuation", () => {
    const text = "lorem ipsum dolor, sit amet, consectetur adipiscing elit, sed do eiusmod";
    const r = redact(text);
    expect(r.text).not.toContain("[REDACTED:mnemonic]");
    expect(r.hardRedactCount).toBe(0);
  });
});

describe("redact — Tier 2 mask", () => {
  it("masks Ethereum address", () => {
    const text = "Sending to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
    const r = redact(text);
    expect(r.text).toContain("0x742d…f44e");
    expect(r.maskCount).toBe(1);
  });

  it("masks transaction hash", () => {
    const text = "tx 0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const r = redact(text);
    expect(r.text).toContain("0xabcd…6789");
    expect(r.maskCount).toBe(1);
  });

  it("masks Solana address", () => {
    const text = "Wallet EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v balance check";
    const r = redact(text);
    expect(r.text).toContain("EPjF…Dt1v");
    expect(r.maskCount).toBeGreaterThanOrEqual(1);
  });

  it("preserves the surrounding sentence after masking", () => {
    const text = "Bridge from 0x742d35Cc6634C0532925a3b844Bc454e4438f44e to Polygon";
    const r = redact(text);
    expect(r.text).toMatch(/Bridge from 0x742d…f44e to Polygon/);
  });
});

describe("redact — empty / no-op cases", () => {
  it("returns input unchanged when no patterns match", () => {
    const text = "User decided to hold the position. WIF momentum reversed.";
    const r = redact(text);
    expect(r.text).toBe(text);
    expect(r.hardRedactCount).toBe(0);
    expect(r.maskCount).toBe(0);
  });

  it("handles empty string", () => {
    const r = redact("");
    expect(r.text).toBe("");
    expect(r.hardRedactCount).toBe(0);
    expect(r.maskCount).toBe(0);
  });
});

describe("redactObject", () => {
  it("redacts all string fields and counts globally", () => {
    const input = {
      summary: "Wallet 0x742d35Cc6634C0532925a3b844Bc454e4438f44e is active",
      details: "API key sk-or-v1-abcdefghijklmnop1234567 leaked",
      count: 42,
      flag: true,
    };
    const r = redactObject(input);
    expect(r.value.summary).toContain("0x742d…f44e");
    expect(r.value.details).toContain("[REDACTED:api_key]");
    expect(r.value.count).toBe(42);
    expect(r.value.flag).toBe(true);
    expect(r.hardRedactCount).toBe(1);
    expect(r.maskCount).toBe(1);
  });

  it("redacts string elements inside array fields", () => {
    const input = {
      entities: [
        "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        "BONK",
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ],
    };
    const r = redactObject(input);
    expect(r.value.entities[0]).toContain("…");
    expect(r.value.entities[1]).toBe("BONK");
    expect(r.value.entities[2]).toContain("…");
  });
});
