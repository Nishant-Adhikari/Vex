import type { BenchmarkPair } from "./types.js";

// ── Polish (6) ──────────────────────────────────────────────────────
export const plPairs: readonly BenchmarkPair[] = [
  {
    id: "pl-balance",
    lang: "pl",
    topic: "balance",
    queryNative: "jaki jest mój balans USDC na Solanie",
    titleEn: "USDC balance check on Solana",
    titleNative: "Sprawdzenie stanu USDC na Solanie",
    summaryEn:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
    summaryNative:
      "User zapytał o stan USDC na Solanie. Agent zgłosił 1250 USDC w portfelu 4QpN...xyz przez narzędzie balance_check.",
  },
  {
    id: "pl-swap",
    lang: "pl",
    topic: "swap",
    queryNative: "kiedy ostatnio zamieniałem USDC na SOL",
    titleEn: "USDC to SOL swap on Jupiter",
    titleNative: "Swap USDC na SOL na Jupiter",
    summaryEn:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
    summaryNative:
      "Agent wykonał swap 100 USDC na SOL po kursie 0.005 SOL za USDC na Jupiter. Hash transakcji 4aB...Qz, potwierdzony w 3 slotach.",
  },
  {
    id: "pl-slippage",
    lang: "pl",
    topic: "slippage_pref",
    queryNative: "jakie mam ustawienia slippage",
    titleEn: "User slippage preference: max 0.5%",
    titleNative: "Preferencja slippage użytkownika: maks. 0,5%",
    summaryEn:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
    summaryNative:
      "User zadeklarował preferencję dla swapów z niskim slippage, tolerując maksymalnie 0,5 procenta na wszystkich trasach DEX.",
  },
  {
    id: "pl-hold-eth",
    lang: "pl",
    topic: "hold_decision",
    queryNative: "dlaczego trzymałem ETH podczas spadku",
    titleEn: "Decision to hold ETH long through 12% drawdown",
    titleNative: "Decyzja o utrzymaniu longa ETH mimo 12% drawdownu",
    summaryEn:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
    summaryNative:
      "User zdecydował się trzymać long ETH mimo 12 procent drawdownu. Powód: teza o nadchodzącym upgradzie pozostała bez zmian.",
  },
  {
    id: "pl-pnl",
    lang: "pl",
    topic: "pnl_report",
    queryNative: "pokaż wyniki portfela z ostatniego tygodnia",
    titleEn: "7-day portfolio PnL report",
    titleNative: "Raport PnL portfela za 7 dni",
    summaryEn:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
    summaryNative:
      "PnL portfela za ostatnie 7 dni: +4,2 procent niezrealizowany i -0,8 procent zrealizowany na zamkniętej pozycji short BTC.",
  },
  {
    id: "pl-gas",
    lang: "pl",
    topic: "gas_cost",
    queryNative: "koszty gazu dla tradingu na L2",
    titleEn: "Gas cost comparison: Base vs Ethereum mainnet",
    titleNative: "Porównanie kosztów gazu: Base vs Ethereum mainnet",
    summaryEn:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
    summaryNative:
      "Gas na Base wynosił średnio około 0,003 USD za swap w czasie sesji, podczas gdy Ethereum mainnet utrzymywał się przy 12 USD za tę samą operację.",
  },
];
