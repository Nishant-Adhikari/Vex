import type { BenchmarkPair } from "./types.js";

// ── Chinese (simplified) (6) ────────────────────────────────────────
export const zhPairs: readonly BenchmarkPair[] = [
  {
    id: "zh-balance",
    lang: "zh",
    topic: "balance",
    queryNative: "我在 Solana 上的 USDC 余额是多少",
    titleEn: "USDC balance check on Solana",
    titleNative: "Solana 上的 USDC 余额查询",
    summaryEn:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
    summaryNative:
      "用户请求查询 Solana 上的 USDC 余额。代理通过 balance_check 工具报告钱包 4QpN...xyz 中有 1250 USDC。",
  },
  {
    id: "zh-swap",
    lang: "zh",
    topic: "swap",
    queryNative: "我上次把 USDC 换成 SOL 是什么时候",
    titleEn: "USDC to SOL swap on Jupiter",
    titleNative: "在 Jupiter 上的 USDC 到 SOL 兑换",
    summaryEn:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
    summaryNative:
      "代理在 Jupiter 上以 0.005 SOL/USDC 的汇率将 100 USDC 兑换为 SOL。交易哈希 4aB...Qz，在 3 个 slot 内确认。",
  },
  {
    id: "zh-slippage",
    lang: "zh",
    topic: "slippage_pref",
    queryNative: "我的滑点设置是什么",
    titleEn: "User slippage preference: max 0.5%",
    titleNative: "用户滑点偏好：最多 0.5%",
    summaryEn:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
    summaryNative:
      "用户表示偏好低滑点兑换，在所有 DEX 路由上最多容忍 0.5%。",
  },
  {
    id: "zh-hold-eth",
    lang: "zh",
    topic: "hold_decision",
    queryNative: "我为什么在下跌时持有 ETH",
    titleEn: "Decision to hold ETH long through 12% drawdown",
    titleNative: "12% 回撤期间继续持有 ETH 多头的决定",
    summaryEn:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
    summaryNative:
      "用户决定在 12% 回撤期间继续持有 ETH 多头仓位。理由：对即将到来的升级的论点保持不变。",
  },
  {
    id: "zh-pnl",
    lang: "zh",
    topic: "pnl_report",
    queryNative: "显示我上周的投资组合表现",
    titleEn: "7-day portfolio PnL report",
    titleNative: "7 天投资组合 PnL 报告",
    summaryEn:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
    summaryNative:
      "过去 7 天投资组合 PnL：未实现 +4.2%，在已平仓的 BTC 空头仓位上已实现 -0.8%。",
  },
  {
    id: "zh-gas",
    lang: "zh",
    topic: "gas_cost",
    queryNative: "L2 交易的 gas 费用是多少",
    titleEn: "Gas cost comparison: Base vs Ethereum mainnet",
    titleNative: "Gas 费用对比：Base 与 Ethereum 主网",
    summaryEn:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
    summaryNative:
      "会话期间 Base 网络每笔兑换的 gas 平均约 0.003 美元，而以太坊主网同一操作约为 12 美元。",
  },
];
