import type { BenchmarkPair } from "./types.js";

// ── English (6) ─────────────────────────────────────────────────────
export const enPairs: readonly BenchmarkPair[] = [
  {
    id: "en-balance",
    lang: "en",
    topic: "balance",
    queryNative: "what is my USDC balance on Solana",
    titleEn: "USDC balance check on Solana",
    titleNative: "USDC balance check on Solana",
    summaryEn:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
    summaryNative:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
  },
  {
    id: "en-swap",
    lang: "en",
    topic: "swap",
    queryNative: "when did I last swap USDC to SOL",
    titleEn: "USDC to SOL swap on Jupiter",
    titleNative: "USDC to SOL swap on Jupiter",
    summaryEn:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
    summaryNative:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
  },
  {
    id: "en-slippage",
    lang: "en",
    topic: "slippage_pref",
    queryNative: "what are my slippage settings",
    titleEn: "User slippage preference: max 0.5%",
    titleNative: "User slippage preference: max 0.5%",
    summaryEn:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
    summaryNative:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
  },
  {
    id: "en-hold-eth",
    lang: "en",
    topic: "hold_decision",
    queryNative: "why did I hold ETH during the drawdown",
    titleEn: "Decision to hold ETH long through 12% drawdown",
    titleNative: "Decision to hold ETH long through 12% drawdown",
    summaryEn:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
    summaryNative:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
  },
  {
    id: "en-pnl",
    lang: "en",
    topic: "pnl_report",
    queryNative: "show me portfolio performance last week",
    titleEn: "7-day portfolio PnL report",
    titleNative: "7-day portfolio PnL report",
    summaryEn:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
    summaryNative:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
  },
  {
    id: "en-gas",
    lang: "en",
    topic: "gas_cost",
    queryNative: "what are gas costs for trading on L2",
    titleEn: "Gas cost comparison: Base vs Ethereum mainnet",
    titleNative: "Gas cost comparison: Base vs Ethereum mainnet",
    summaryEn:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
    summaryNative:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
  },
];
