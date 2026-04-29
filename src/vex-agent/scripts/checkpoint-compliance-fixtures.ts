/**
 * Curated multilingual conversation prefixes for the checkpoint compliance
 * CLI. Each prefix represents a realistic Vex session snippet in a single
 * target language (or mixed). We run the extract / merge prompts against
 * each one and assert the returned JSON is compliant with the PR2 contract:
 *   - `title` per episode, ≤ 100 chars, same language as summary_text
 *   - `session_language_inferred` per batch, matches LANG_CODE_RE
 *   - `summary_text` non-empty, in the prefix's dominant language
 *
 * These fixtures are not tests — the compliance CLI drives them against a
 * real LLM. Shape matches `MessageWithId[]` so `extractEpisodes` and
 * `summarizePrefix` can consume them unchanged.
 */

import type { MessageWithId } from "@vex-agent/db/repos/messages.js";

export interface CompliancePrefix {
  /** Unique id (e.g. "en-trade-session"). */
  id: string;
  /** Target language code, matching the `memory_language_code` regex. */
  expectedLang: "en" | "pl" | "fr" | "zh" | "vi" | "und";
  /** Short human label for the report. */
  label: string;
  /** Message prefix — what the extractor / summarizer sees. */
  messages: MessageWithId[];
}

function msg(
  id: number,
  role: MessageWithId["role"],
  content: string,
): MessageWithId {
  return {
    id,
    role,
    content,
    timestamp: `2026-04-18T12:00:${String(id).padStart(2, "0")}Z`,
  };
}

export const COMPLIANCE_PREFIXES: readonly CompliancePrefix[] = [
  // ── English trading session ────────────────────────────────────
  {
    id: "en-trade-session",
    expectedLang: "en",
    label: "English — DeFi trade + PnL + preference",
    messages: [
      msg(1, "user", "check my USDC balance on Solana"),
      msg(
        2,
        "assistant",
        "Your Solana wallet 4QpN...xyz holds 1,250 USDC as of block 237,819,521.",
      ),
      msg(3, "user", "ok, swap 100 USDC to SOL on Jupiter, max 0.5% slippage"),
      msg(
        4,
        "assistant",
        "Executed: swapped 100 USDC for 0.5 SOL on Jupiter at 0.005 SOL/USDC. Slippage 0.2%, transaction 4aB...Qz confirmed in 3 slots.",
      ),
      msg(5, "user", "remember — I never want slippage above 0.5% on DEX swaps"),
      msg(
        6,
        "assistant",
        "Noted: max slippage 0.5% applied to all DEX swaps across Jupiter, Orca, Raydium. I'll reject or reroute anything above that threshold.",
      ),
      msg(7, "user", "what's my 7-day pnl?"),
      msg(
        8,
        "assistant",
        "Portfolio PnL last 7 days: +4.2% unrealized across ETH/SOL/BTC positions, -0.8% realized on the closed BTC short (62,000→62,500). Portfolio value: 42,500 → 44,200 USD.",
      ),
    ],
  },

  // ── Polish DeFi session ────────────────────────────────────────
  {
    id: "pl-defi-session",
    expectedLang: "pl",
    label: "Polish — swap + decision + gas lesson",
    messages: [
      msg(1, "user", "sprawdź mój balans USDC na Solanie"),
      msg(
        2,
        "assistant",
        "Twój portfel Solana 4QpN...xyz ma 1250 USDC (blok 237,819,521).",
      ),
      msg(3, "user", "ok, zamień 100 USDC na SOL przez Jupiter, max 0.5% slippage"),
      msg(
        4,
        "assistant",
        "Wykonane: swap 100 USDC na 0.5 SOL na Jupiter po kursie 0.005 SOL/USDC. Slippage 0.2%, transakcja 4aB...Qz potwierdzona w 3 slotach.",
      ),
      msg(5, "user", "mam ETH na minus 12%, ale trzymam — teza o upgrade bez zmian"),
      msg(
        6,
        "assistant",
        "Zapisane jako decyzja: trzymać long ETH mimo 12% drawdownu, uzasadnienie to teza o nadchodzącym upgradzie sieci.",
      ),
      msg(7, "user", "ile kosztuje gas na Base vs mainnet?"),
      msg(
        8,
        "assistant",
        "Base: ~0.003 USD za swap. Ethereum mainnet: ~12 USD za tę samą operację. Różnica ~4000x.",
      ),
      msg(9, "user", "ok, dla swapów poniżej 500 USD zawsze Base"),
      msg(
        10,
        "assistant",
        "Zapisana preferencja: dla swapów <500 USD zawsze używać Base zamiast mainnetu Ethereum.",
      ),
    ],
  },

  // ── French lending + yield session ─────────────────────────────
  {
    id: "fr-lending-session",
    expectedLang: "fr",
    label: "French — Aave borrow + Orca farming",
    messages: [
      msg(1, "user", "je veux emprunter 1500 USDC sur Aave v3 contre 1.2 ETH"),
      msg(
        2,
        "assistant",
        "Aave v3 — taux d'emprunt USDC: variable 5.4% APR, stable 7.1% APR. Avec 1.2 ETH en collatéral et 1500 USDC empruntés, ton health factor serait 2.14 (liquidation à 1.05). Je procède?",
      ),
      msg(3, "user", "oui, en taux variable"),
      msg(
        4,
        "assistant",
        "Emprunt exécuté: 1500 USDC à taux variable 5.4% APR. Health factor actuel 2.14 — surveille les baisses d'ETH.",
      ),
      msg(5, "user", "place les 1500 USDC dans un pool à haut rendement"),
      msg(
        6,
        "assistant",
        "Recommandation: pool USDC/USDT sur Orca Whirlpool rend actuellement 12.4% APR (range 0.99-1.01, récompenses SOL + ORCA). Position ouverte avec 1500 USDC. Spread net après coût d'emprunt: ~7% APR.",
      ),
      msg(7, "user", "parfait, on continue comme ça"),
      msg(
        8,
        "assistant",
        "Noté. Je surveille le health factor Aave et le range du pool Orca — alerte si health passe sous 1.8 ou si le prix sort du range concentré.",
      ),
    ],
  },

  // ── Chinese (simplified) staking + stablecoin session ──────────
  {
    id: "zh-staking-session",
    expectedLang: "zh",
    label: "Chinese — SOL staking + stablecoin allocation",
    messages: [
      msg(1, "user", "帮我 stake 2 个 SOL，Jito 还是 Marinade？"),
      msg(
        2,
        "assistant",
        "当前 APR：Jito (jitoSOL) 6.7%，Marinade (mSOL) 6.8%。Marinade 略高，但 Jito 有更大的运营商池，风险分散更好。我建议 Jito，确认吗？",
      ),
      msg(3, "user", "好，用 Jito"),
      msg(
        4,
        "assistant",
        "已完成：2 SOL 质押到 Jito，获得 jitoSOL。APR 6.7%。",
      ),
      msg(5, "user", "再说一下我的稳定币配置：40% USDC / 30% USDT / 30% DAI"),
      msg(
        6,
        "assistant",
        "已记录：稳定币目标配置 40% USDC、30% USDT、30% DAI。偏离超过 5 个百分点时我会提醒。理由：分散 Circle、Tether、MakerDAO 的协议风险。",
      ),
      msg(7, "user", "有一个新代币叫 XYZ，空投要参加吗？"),
      msg(
        8,
        "assistant",
        "XYZ 合约没有审计、流动性只有 15k USD、团队分配 60% 无锁定期 —— 跳过。我已将 XYZ 加入黑名单防止误触发。",
      ),
    ],
  },

  // ── Vietnamese bridge + open-loop session ──────────────────────
  {
    id: "vi-bridge-session",
    expectedLang: "vi",
    label: "Vietnamese — bridge decision + restaking open loop",
    messages: [
      msg(1, "user", "tôi muốn bridge 0.5 ETH từ mainnet sang Arbitrum qua Stargate"),
      msg(
        2,
        "assistant",
        "Spread Stargate hiện tại 0.8% — khá cao. Bạn có thể chờ spread xuống dưới 0.3%, hoặc chấp nhận 0.8% bây giờ. Tôi đặt alert?",
      ),
      msg(3, "user", "ok, đặt alert 0.3%, chưa bridge"),
      msg(
        4,
        "assistant",
        "Đã đặt alert: sẽ thông báo khi spread Stargate mainnet→Arbitrum xuống ≤ 0.3%. 0.5 ETH chưa được bridge.",
      ),
      msg(5, "user", "còn 5000 MATIC, Lido hay EigenLayer restake?"),
      msg(
        6,
        "assistant",
        "Lido: APR ~4.2%, đơn giản, không slashing bổ sung. EigenLayer restake: APR ~4.7% + điểm AVS, nhưng slashing risk chưa rõ. Tuỳ khẩu vị rủi ro — bạn thích cái nào?",
      ),
      msg(7, "user", "để tuần sau quyết định"),
      msg(
        8,
        "assistant",
        "Được, ghi nhận: quyết định stake MATIC (Lido vs EigenLayer) hoãn sang tuần sau. 5000 MATIC chưa được stake.",
      ),
    ],
  },

  // ── Mixed-language session — tests the `und` fallback ──────────
  {
    id: "mixed-session",
    expectedLang: "und",
    label: "Mixed PL+EN — tests und fallback",
    messages: [
      msg(1, "user", "sprawdź moje USDC na Solana please"),
      msg(
        2,
        "assistant",
        "Your Solana wallet holds 1,250 USDC. Transakcja ostatnia: deposit 500 USDC from Coinbase 3 dni temu.",
      ),
      msg(3, "user", "ok swap 100 USDC to SOL, max 0.5% slippage, use Jupiter"),
      msg(
        4,
        "assistant",
        "Executed: 100 USDC → 0.5 SOL on Jupiter, slippage 0.2%. Hash 4aB...Qz, confirmed in 3 slots. Teraz masz 1150 USDC and 0.5 SOL extra.",
      ),
      msg(5, "user", "show 7-day PnL pls"),
      msg(
        6,
        "assistant",
        "7-day PnL: +4.2% unrealized across ETH/SOL/BTC, -0.8% realized on the closed BTC short. Portfolio went from 42,500 USD to 44,200 USD. Dobry tydzień.",
      ),
    ],
  },
];
