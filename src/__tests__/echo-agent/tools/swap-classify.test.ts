import { describe, it, expect } from "vitest";
import { classifySolanaSwap } from "@tools/solana-ecosystem/shared/swap-classify.js";
import { SOL_MINT } from "@tools/solana-ecosystem/shared/solana-constants.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const MEME = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK
const MEME2 = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"; // JUP

describe("classifySolanaSwap", () => {
  // ── Standard: quote→non-quote / non-quote→quote ──────────

  it("SOL → meme = buy, instrumentMint = meme", () => {
    const cls = classifySolanaSwap(SOL_MINT, MEME);
    expect(cls.tradeSide).toBe("buy");
    expect(cls.instrumentMint).toBe(MEME);
    expect(cls.meta).toEqual({});
  });

  it("meme → SOL = sell, instrumentMint = meme", () => {
    const cls = classifySolanaSwap(MEME, SOL_MINT);
    expect(cls.tradeSide).toBe("sell");
    expect(cls.instrumentMint).toBe(MEME);
    expect(cls.meta).toEqual({});
  });

  it("USDC → meme = buy, instrumentMint = meme", () => {
    const cls = classifySolanaSwap(USDC, MEME);
    expect(cls.tradeSide).toBe("buy");
    expect(cls.instrumentMint).toBe(MEME);
  });

  it("meme → USDC = sell, instrumentMint = meme", () => {
    const cls = classifySolanaSwap(MEME, USDC);
    expect(cls.tradeSide).toBe("sell");
    expect(cls.instrumentMint).toBe(MEME);
  });

  it("meme → USDT = sell, instrumentMint = meme", () => {
    const cls = classifySolanaSwap(MEME, USDT);
    expect(cls.tradeSide).toBe("sell");
    expect(cls.instrumentMint).toBe(MEME);
  });

  // ── Explicit stable↔SOL (both are quote) ──────────────────

  it("USDC → SOL = buy SOL", () => {
    const cls = classifySolanaSwap(USDC, SOL_MINT);
    expect(cls.tradeSide).toBe("buy");
    expect(cls.instrumentMint).toBe(SOL_MINT);
  });

  it("SOL → USDT = sell SOL", () => {
    const cls = classifySolanaSwap(SOL_MINT, USDT);
    expect(cls.tradeSide).toBe("sell");
    expect(cls.instrumentMint).toBe(SOL_MINT);
  });

  it("USDT → SOL = buy SOL", () => {
    const cls = classifySolanaSwap(USDT, SOL_MINT);
    expect(cls.tradeSide).toBe("buy");
    expect(cls.instrumentMint).toBe(SOL_MINT);
  });

  // ── stable↔stable: currency conversion ────────────────────

  it("USDC → USDT = null tradeSide, stableSwap", () => {
    const cls = classifySolanaSwap(USDC, USDT);
    expect(cls.tradeSide).toBeNull();
    expect(cls.meta.stableSwap).toBe(true);
  });

  it("USDT → USDC = null tradeSide, stableSwap", () => {
    const cls = classifySolanaSwap(USDT, USDC);
    expect(cls.tradeSide).toBeNull();
    expect(cls.meta.stableSwap).toBe(true);
  });

  // ── Both non-quote: ambiguous ─────────────────────────────

  it("meme → meme = null tradeSide, ambiguousSwap", () => {
    const cls = classifySolanaSwap(MEME, MEME2);
    expect(cls.tradeSide).toBeNull();
    expect(cls.instrumentMint).toBe(MEME2);
    expect(cls.meta.ambiguousSwap).toBe(true);
  });
});
