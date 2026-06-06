import type { BenchmarkPair } from "./types.js";

// ── Vietnamese (6) ──────────────────────────────────────────────────
export const viPairs: readonly BenchmarkPair[] = [
  {
    id: "vi-balance",
    lang: "vi",
    topic: "balance",
    queryNative: "số dư USDC của tôi trên Solana là bao nhiêu",
    titleEn: "USDC balance check on Solana",
    titleNative: "Kiểm tra số dư USDC trên Solana",
    summaryEn:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
    summaryNative:
      "Người dùng yêu cầu kiểm tra số dư USDC trên Solana. Agent báo cáo 1250 USDC trong ví 4QpN...xyz thông qua công cụ balance_check.",
  },
  {
    id: "vi-swap",
    lang: "vi",
    topic: "swap",
    queryNative: "lần cuối tôi đổi USDC sang SOL là khi nào",
    titleEn: "USDC to SOL swap on Jupiter",
    titleNative: "Swap USDC sang SOL trên Jupiter",
    summaryEn:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
    summaryNative:
      "Agent đã thực hiện swap 100 USDC sang SOL với tỷ giá 0,005 SOL mỗi USDC trên Jupiter. Hash giao dịch 4aB...Qz, được xác nhận trong 3 slot.",
  },
  {
    id: "vi-slippage",
    lang: "vi",
    topic: "slippage_pref",
    queryNative: "cài đặt slippage của tôi là gì",
    titleEn: "User slippage preference: max 0.5%",
    titleNative: "Ưu tiên slippage của người dùng: tối đa 0,5%",
    summaryEn:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
    summaryNative:
      "Người dùng bày tỏ ưu tiên các swap có slippage thấp, chấp nhận tối đa 0,5 phần trăm trên tất cả các tuyến DEX.",
  },
  {
    id: "vi-hold-eth",
    lang: "vi",
    topic: "hold_decision",
    queryNative: "tại sao tôi giữ ETH khi giá giảm",
    titleEn: "Decision to hold ETH long through 12% drawdown",
    titleNative: "Quyết định giữ vị thế long ETH qua drawdown 12%",
    summaryEn:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
    summaryNative:
      "Người dùng quyết định giữ vị thế long ETH bất chấp drawdown 12 phần trăm. Lý do: luận điểm về lần nâng cấp sắp tới không thay đổi.",
  },
  {
    id: "vi-pnl",
    lang: "vi",
    topic: "pnl_report",
    queryNative: "xem hiệu suất danh mục tuần trước",
    titleEn: "7-day portfolio PnL report",
    titleNative: "Báo cáo PnL danh mục 7 ngày",
    summaryEn:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
    summaryNative:
      "PnL danh mục trong 7 ngày qua: +4,2 phần trăm chưa thực hiện và -0,8 phần trăm đã thực hiện trên vị thế short BTC đã đóng.",
  },
  {
    id: "vi-gas",
    lang: "vi",
    topic: "gas_cost",
    queryNative: "chi phí gas cho trading trên L2",
    titleEn: "Gas cost comparison: Base vs Ethereum mainnet",
    titleNative: "So sánh chi phí gas: Base và Ethereum mainnet",
    summaryEn:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
    summaryNative:
      "Gas trên Base trung bình khoảng 0,003 USD mỗi swap trong phiên, trong khi Ethereum mainnet ở mức gần 12 USD cho cùng một thao tác.",
  },
];
