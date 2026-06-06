import type { BenchmarkPair } from "./types.js";

// ── French (6) ──────────────────────────────────────────────────────
export const frPairs: readonly BenchmarkPair[] = [
  {
    id: "fr-balance",
    lang: "fr",
    topic: "balance",
    queryNative: "quel est mon solde USDC sur Solana",
    titleEn: "USDC balance check on Solana",
    titleNative: "Vérification du solde USDC sur Solana",
    summaryEn:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
    summaryNative:
      "L'utilisateur a demandé de vérifier le solde USDC sur Solana. L'agent a rapporté 1250 USDC dans le portefeuille 4QpN...xyz via l'outil balance_check.",
  },
  {
    id: "fr-swap",
    lang: "fr",
    topic: "swap",
    queryNative: "quand ai-je échangé USDC contre SOL pour la dernière fois",
    titleEn: "USDC to SOL swap on Jupiter",
    titleNative: "Swap USDC vers SOL sur Jupiter",
    summaryEn:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
    summaryNative:
      "L'agent a exécuté un swap de 100 USDC vers SOL au taux de 0,005 SOL par USDC sur Jupiter. Hash de transaction 4aB...Qz, confirmé en 3 slots.",
  },
  {
    id: "fr-slippage",
    lang: "fr",
    topic: "slippage_pref",
    queryNative: "quels sont mes réglages de slippage",
    titleEn: "User slippage preference: max 0.5%",
    titleNative: "Préférence de slippage de l'utilisateur: max 0,5%",
    summaryEn:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
    summaryNative:
      "L'utilisateur a déclaré préférer les swaps à faible slippage, tolérant au maximum 0,5 pour cent sur toutes les routes DEX.",
  },
  {
    id: "fr-hold-eth",
    lang: "fr",
    topic: "hold_decision",
    queryNative: "pourquoi ai-je gardé ETH pendant la baisse",
    titleEn: "Decision to hold ETH long through 12% drawdown",
    titleNative: "Décision de conserver la position longue ETH malgré 12% de baisse",
    summaryEn:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
    summaryNative:
      "L'utilisateur a décidé de conserver la position longue sur ETH malgré un drawdown de 12 pour cent. Motif: la thèse sur la mise à niveau à venir reste inchangée.",
  },
  {
    id: "fr-pnl",
    lang: "fr",
    topic: "pnl_report",
    queryNative: "montre les performances de mon portefeuille la semaine dernière",
    titleEn: "7-day portfolio PnL report",
    titleNative: "Rapport PnL du portefeuille sur 7 jours",
    summaryEn:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
    summaryNative:
      "PnL du portefeuille sur les 7 derniers jours: +4,2 pour cent non réalisé et -0,8 pour cent réalisé sur la position short BTC clôturée.",
  },
  {
    id: "fr-gas",
    lang: "fr",
    topic: "gas_cost",
    queryNative: "coûts de gas pour le trading sur L2",
    titleEn: "Gas cost comparison: Base vs Ethereum mainnet",
    titleNative: "Comparaison des coûts de gas: Base vs Ethereum mainnet",
    summaryEn:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
    summaryNative:
      "Le gas sur Base s'est établi en moyenne autour de 0,003 USD par swap pendant la session, tandis qu'Ethereum mainnet tournait près de 12 USD pour la même opération.",
  },
];
