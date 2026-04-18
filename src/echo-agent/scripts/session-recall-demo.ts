/**
 * session-recall-demo — end-to-end session memory demo against real DB.
 *
 * Simulates a Vex trading/DeFi session: creates a session, inserts 10
 * realistic episodes with real EmbeddingGemma embeddings, then runs several
 * recall queries to show what the multilingual recall path actually returns
 * in production shape.
 *
 * Unlike the synthetic `cross-lingual-benchmark`, this script exercises the
 * WHOLE production path:
 *   - `sessions` table insert + memory_scope_key wire-up
 *   - `session_episodes` INSERT via `insertEpisodes()` (the same repo the
 *     checkpoint flow uses)
 *   - `recallTopK()` with (memory_scope_key, embedding_model, embedding_dim)
 *     filter — mirrors `turn.ts::fetchSessionEpisodeRecallBlock`
 *
 * Episodes are intentionally mixed: most in Polish (session language), two in
 * English (simulating legacy or multi-tenant session mix), across different
 * episode kinds and topics.
 *
 * Queries run afterward include Polish, English, and a mixed/ambiguous case.
 *
 * Usage:
 *   pnpm exec tsx src/echo-agent/scripts/session-recall-demo.ts
 *
 * Required env: same as embeddings (EMBEDDING_BASE_URL, EMBEDDING_MODEL,
 * EMBEDDING_DIM, EMBEDDING_PROVIDER) + ECHO_AGENT_DB_URL.
 *
 * The demo session is NOT deleted automatically. The session id is logged
 * so you can inspect (or drop) manually:
 *   psql $ECHO_AGENT_DB_URL -c "DELETE FROM sessions WHERE id = '<printed-id>';"
 *   (CASCADE drops the episodes too.)
 */

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { closePool } from "@echo-agent/db/client.js";
import { runMigrations } from "@echo-agent/db/migrate.js";
import {
  insertEpisodes,
  recallTopK,
  type EpisodeKind,
  type NewEpisode,
} from "@echo-agent/db/repos/session-episodes.js";
import {
  createSession,
  getMemoryLanguageCode,
  setMemoryLanguageCode,
  setMemoryScopeKey,
} from "@echo-agent/db/repos/sessions.js";
import { embedDocument, embedQuery } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import { computeEpisodeHash } from "@echo-agent/engine/checkpoint/extract.js";
import logger from "@utils/logger.js";

// ── Demo dataset ─────────────────────────────────────────────────────

interface DemoEpisode {
  kind: EpisodeKind;
  topic: string;
  /** Short title (≤100 chars) — simulates the LLM-generated title PR2 introduces. */
  title: string;
  /** Body — stored in session_episodes.summary_text (post-migration 008). */
  summary: string;
  /** Arbitrary structured facts — mirrors what extractEpisodes returns. */
  facts?: Record<string, unknown>;
  entities?: string[];
}

/**
 * 20 episodes across a simulated multilingual DeFi session.
 *
 * Shape goals:
 *   - All six episode kinds covered at least once (decision, fact, preference,
 *     open_loop, tool_result_summary, lesson).
 *   - Five languages (PL, EN, FR, ZH, VI) living in the same memory scope —
 *     mirrors the post-PR2 invariant that session memory is multilingual.
 *   - Two near-duplicate topic pairs (same theme, different language) to
 *     exercise cross-lingual collision behaviour under recall.
 *   - One deliberately off-topic episode (news, no DeFi content) so queries
 *     that shouldn't match anything have something to NOT match.
 */
const EPISODES: readonly DemoEpisode[] = [
  // ── Polish core (8) ─────────────────────────────────────────────
  {
    kind: "fact",
    topic: "balance_solana",
    title: "Sprawdzenie stanu USDC na Solanie",
    summary:
      "User zapytał o stan USDC na Solanie. Agent zgłosił 1250 USDC w portfelu 4QpN...xyz przez narzędzie balance_check. Transakcja potwierdzona w bloku 237819521.",
    entities: ["USDC", "Solana", "4QpN...xyz"],
  },
  {
    kind: "tool_result_summary",
    topic: "swap_jupiter",
    title: "Swap 100 USDC na SOL przez Jupiter",
    summary:
      "Agent wykonał swap 100 USDC na SOL na Jupiter przy kursie 0.005 SOL za USDC. Slippage 0.2%, hash 4aB...Qz, potwierdzony w 3 slotach. Użytkownik dostał 0.5 SOL do portfela.",
    entities: ["USDC", "SOL", "Jupiter", "4aB...Qz"],
  },
  {
    kind: "preference",
    topic: "slippage_tolerance",
    title: "Preferencja użytkownika: maks. 0.5% slippage",
    summary:
      "User zadeklarował preferencję dla swapów z niskim slippage, tolerując maksymalnie 0.5 procenta na wszystkich trasach DEX. Dotyczy Jupiter, Orca, Raydium. Wcześniej stracił ~3% na głębokim pool'u USDC/ETH.",
    facts: { maxSlippagePct: 0.5, appliedTo: "all_dex" },
  },
  {
    kind: "decision",
    topic: "hold_eth",
    title: "Decyzja: trzymać longa ETH mimo 12% drawdownu",
    summary:
      "Podczas spadku ceny ETH o 12% user zdecydował się utrzymać long. Uzasadnienie: teza o zbliżającym się upgrade sieci i TVL na L2 bez zmian. Nie cofnął decyzji mimo dodatkowego spadku do -15% następnego dnia.",
    facts: { drawdownPct: 12, rationale: "upgrade_thesis_unchanged" },
    entities: ["ETH"],
  },
  {
    kind: "tool_result_summary",
    topic: "pnl_weekly",
    title: "Raport PnL za ostatnie 7 dni",
    summary:
      "PnL portfela za ostatnie 7 dni: +4.2% niezrealizowany (otwarte pozycje ETH, SOL, BTC) i -0.8% zrealizowany na zamkniętej pozycji short BTC otwartej @62k, zamkniętej @62500. Łączna wartość portfela wzrosła z 42500 USD do 44200 USD.",
    facts: { unrealizedPct: 4.2, realizedPct: -0.8, portfolioUsd: 44200 },
    entities: ["ETH", "SOL", "BTC"],
  },
  {
    kind: "lesson",
    topic: "gas_base_vs_mainnet",
    title: "Wnioski: Base ~4000x tańszy niż Ethereum mainnet",
    summary:
      "Porównanie kosztów gazu w czasie sesji: Base średnio 0.003 USD za swap vs Ethereum mainnet średnio 12 USD za tę samą operację. User wyciągnął wniosek, że dla swapów < 500 USD zawsze preferuje Base.",
    facts: { baseGasUsd: 0.003, mainnetGasUsd: 12, preferredChain: "Base" },
    entities: ["Base", "Ethereum"],
  },
  {
    kind: "fact",
    topic: "approve_usdc_raydium",
    title: "Approval 5000 USDC dla Raydium Router",
    summary:
      "User zatwierdził kontrakt Raydium Router do wydawania do 5000 USDC z portfela 4QpN...xyz. Ważność: permanent (unlimited). Hash zatwierdzenia 8vK...abc. Previous allowance 0, new allowance MAX_UINT256.",
    entities: ["USDC", "Raydium", "4QpN...xyz"],
  },
  {
    kind: "decision",
    topic: "stake_sol",
    title: "Decyzja: stake 2 SOL w Jito",
    summary:
      "User zdecydował się zestakować 2 SOL w Jito (jitoSOL) mimo że Marinade oferuje marginalnie wyższe APY (6.8% vs 6.7%). Uzasadnienie: Jito ma większy pool operatorów i lepszą dystrybucję ryzyka.",
    facts: { amountSol: 2, protocol: "Jito", apy: 6.7 },
    entities: ["SOL", "Jito", "Marinade"],
  },

  // ── Open loop (Polish) — pending user action ────────────────────
  {
    kind: "open_loop",
    topic: "pending_bridge_decision",
    title: "Otwarta pętla: czekanie na lepszy kurs bridge ETH→Arbitrum",
    summary:
      "User odłożył decyzję o zbridżowaniu 0.5 ETH z mainnet na Arbitrum przez Stargate bo spread wyniósł 0.8%. Czeka na spadek poniżej 0.3% — alert ustawiony. Żadnej transakcji nie wykonano; stan mainnet/Arbitrum saldo bez zmian.",
    facts: { amountEth: 0.5, alertThresholdPct: 0.3, viaProtocol: "Stargate" },
    entities: ["ETH", "Arbitrum", "Stargate"],
  },

  // ── Polish data (cont.) ─────────────────────────────────────────
  {
    kind: "fact",
    topic: "btc_price_check",
    title: "Cena BTC spot: 63200 USD",
    summary:
      "Agent zwrócił cenę BTC spot z Coinbase: 63200.50 USD (mid-market). 24h high 63850, 24h low 62100, volume 18500 BTC. User komentował że to 'healthy consolidation' po ostatnim ruchu.",
    facts: { priceUsd: 63200.5, volumeBtc: 18500 },
    entities: ["BTC", "Coinbase"],
  },

  // ── Legacy EN corpus (3) — simulates imported / older-session memory
  {
    kind: "preference",
    topic: "chain_preference_l2",
    title: "User prefers L2 chains for small swaps",
    summary:
      "User explicitly stated a preference for L2 chains (Base, Arbitrum, Optimism) for any swap under 500 USD, citing gas costs and finality speed. Mainnet Ethereum reserved for large amounts or when L2 bridge is unavailable.",
    facts: { threshold: 500, preferred: ["Base", "Arbitrum", "Optimism"] },
    entities: ["Base", "Arbitrum", "Optimism", "Ethereum"],
  },
  {
    kind: "lesson",
    topic: "mev_sandwich_risk",
    title: "Lesson: sandwich attack risk on public mempool swaps",
    summary:
      "User lost approximately 1.8% on a 3000 USDC→ETH swap routed through public mempool — classic sandwich attack. Agent recommended Jito bundles or private RPC for future mainnet swaps above 1k USD. User agreed.",
    facts: { lossPct: 1.8, swapUsd: 3000, mitigation: "private_rpc_or_jito_bundle" },
    entities: ["USDC", "ETH", "Jito"],
  },
  {
    kind: "tool_result_summary",
    topic: "aave_borrow_rate_check",
    title: "Aave v3 USDC borrow rate snapshot",
    summary:
      "Agent pulled Aave v3 USDC borrow rates: variable 5.4% APR, stable 7.1% APR. Health factor for user's current position (collateral 1.2 ETH, borrow 1500 USDC) stood at 2.14 — safely above liquidation threshold of 1.05.",
    facts: { variableApr: 5.4, stableApr: 7.1, healthFactor: 2.14 },
    entities: ["Aave", "USDC", "ETH"],
  },

  // ── French (2) — multilingual session memory
  {
    kind: "decision",
    topic: "fr_limit_order_jup",
    title: "Décision: ordre limite USDC→SOL à 180 USD",
    summary:
      "L'utilisateur a placé un ordre limite pour vendre 500 USDC contre SOL sur Jupiter Perps si le prix SOL tombe à 180 USD. Ordre valide 30 jours. Motivation: accumuler SOL en cas de correction avant le prochain airdrop.",
    facts: { triggerPriceUsd: 180, amountUsdc: 500, validityDays: 30 },
    entities: ["USDC", "SOL", "Jupiter"],
  },
  {
    kind: "fact",
    topic: "fr_farming_yield",
    title: "Rendement farming LP USDC/USDT sur Orca",
    summary:
      "L'agent a rapporté un rendement actuel de 12.4% APR sur le pool de liquidité USDC/USDT sur Orca Whirlpool. Incentivation par SOL + ORCA rewards. Range concentrated 0.99-1.01 USD. Position ouverte par l'utilisateur: 2000 USD.",
    facts: { aprPct: 12.4, liquidityUsd: 2000, range: "0.99-1.01" },
    entities: ["USDC", "USDT", "Orca", "SOL", "ORCA"],
  },

  // ── Chinese (2) — cross-lingual probe candidates
  {
    kind: "preference",
    topic: "zh_stable_allocation",
    title: "用户偏好：稳定币配置 40% USDC / 30% USDT / 30% DAI",
    summary:
      "用户明确说明稳定币储备的目标配置为 40% USDC、30% USDT、30% DAI。代理每周检查并在偏离超过 5 个百分点时提醒。理由：分散协议风险（Circle、Tether、MakerDAO）。",
    facts: { usdcPct: 40, usdtPct: 30, daiPct: 30, rebalanceDriftPct: 5 },
    entities: ["USDC", "USDT", "DAI"],
  },
  {
    kind: "decision",
    topic: "zh_avoid_new_token",
    title: "决定：不参与新代币 XYZ 空投",
    summary:
      "在审核代币 XYZ 的合约后，用户决定跳过此次空投。原因：合约未审计、流动性仅 15k USD、代币分配 60% 给团队无锁定。代理已将 XYZ 加入黑名单以防未来误触发。",
    facts: { tokenSymbol: "XYZ", liquidityUsd: 15000, teamAllocationPct: 60 },
    entities: ["XYZ"],
  },

  // ── Vietnamese (1) — fifth language for full multilingual proof
  {
    kind: "open_loop",
    topic: "vi_staking_eval",
    title: "Chưa quyết định: stake MATIC trên Lido vs restake với EigenLayer",
    summary:
      "Người dùng đang đánh giá hai lựa chọn cho 5000 MATIC: stake trên Lido (APR ~4.2%) hoặc restake qua EigenLayer (APR ~4.7% + điểm thưởng AVS). Chưa quyết định vì rủi ro slashing trong EigenLayer chưa rõ ràng. Quyết định hoãn đến tuần sau.",
    facts: { amountMatic: 5000, lidoApr: 4.2, eigenlayerApr: 4.7 },
    entities: ["MATIC", "Lido", "EigenLayer"],
  },

  // ── Off-topic filler — should NOT match DeFi queries
  {
    kind: "fact",
    topic: "off_topic_news",
    title: "News: SpaceX Starship test flight scheduled for Friday",
    summary:
      "User briefly mentioned reading that SpaceX Starship IFT-5 is scheduled for Friday at the Boca Chica launch site, with first-stage catch attempt planned. Agent noted it but flagged it as unrelated to the current trading session.",
    entities: ["SpaceX", "Starship"],
  },
];

// ── Demo queries ─────────────────────────────────────────────────────

interface DemoQuery {
  label: string;
  /** Display tag — free-form (matches BenchmarkPair.lang codes + "mixed"). */
  language: "pl" | "en" | "fr" | "zh" | "vi" | "mixed";
  text: string;
  /** Expected best-hit topic — for operator sanity-check. */
  expectedTopic: string;
}

const QUERIES: readonly DemoQuery[] = [
  // ── Baseline PL → PL same-language hits ───────────────────────
  {
    label: "Q01 — PL: slippage preference",
    language: "pl",
    text: "jakie mam ustawione slippage na DEX-ach",
    expectedTopic: "slippage_tolerance",
  },
  {
    label: "Q02 — PL: Solana USDC balance history",
    language: "pl",
    text: "ile miałem USDC na Solanie ostatnio",
    expectedTopic: "balance_solana",
  },
  {
    label: "Q03 — PL: ETH hold rationale",
    language: "pl",
    text: "dlaczego trzymałem ETH mimo spadku",
    expectedTopic: "hold_eth",
  },
  {
    label: "Q04 — PL: staking decision",
    language: "pl",
    text: "gdzie stakowałem SOL",
    expectedTopic: "stake_sol",
  },
  {
    label: "Q05 — PL: pending bridge decision (open loop)",
    language: "pl",
    text: "czekam aż spread na bridge do arbitrum spadnie",
    expectedTopic: "pending_bridge_decision",
  },

  // ── Cross-lingual: non-English query against legacy EN corpus ─
  {
    label: "Q06 — PL query → EN-stored L2 preference (cross-lingual)",
    language: "mixed",
    text: "czy preferuję L2 dla małych swapów",
    expectedTopic: "chain_preference_l2",
  },
  {
    label: "Q07 — PL query → EN-stored MEV lesson (cross-lingual)",
    language: "mixed",
    text: "straciłem na sandwich attacku na mainnet",
    expectedTopic: "mev_sandwich_risk",
  },

  // ── EN query → non-English corpus ────────────────────────────
  {
    label: "Q08 — EN query → PL gas lesson (cross-lingual)",
    language: "en",
    text: "what are gas fees for Layer 2 trading",
    expectedTopic: "gas_base_vs_mainnet",
  },
  {
    label: "Q09 — EN query → FR farming yield episode",
    language: "en",
    text: "what's the APR on USDC/USDT pool on Orca",
    expectedTopic: "fr_farming_yield",
  },

  // ── French / Chinese / Vietnamese same-language probes ───────
  {
    label: "Q10 — FR: limit order decision",
    language: "fr",
    text: "quel était mon ordre limite sur SOL",
    expectedTopic: "fr_limit_order_jup",
  },
  {
    label: "Q11 — ZH: stablecoin allocation preference",
    language: "zh",
    text: "我的稳定币配置比例是多少",
    expectedTopic: "zh_stable_allocation",
  },
  {
    label: "Q12 — ZH: avoid new token decision",
    language: "zh",
    text: "为什么跳过 XYZ 空投",
    expectedTopic: "zh_avoid_new_token",
  },
  {
    label: "Q13 — VI: MATIC staking evaluation (open loop)",
    language: "vi",
    text: "tôi đang cân nhắc stake MATIC ở đâu",
    expectedTopic: "vi_staking_eval",
  },

  // ── Cross-lingual far-pair — FR query against ZH episode ─────
  {
    label: "Q14 — FR query → ZH stablecoin allocation (cross-lingual)",
    language: "fr",
    text: "quelle est ma répartition entre USDC et USDT",
    expectedTopic: "zh_stable_allocation",
  },

  // ── Disambiguation: query could match two topics — which wins?
  {
    label: "Q15 — PL: approve/spending history (overlap w/ swap_jupiter + approve_usdc_raydium)",
    language: "pl",
    text: "kiedy dawałem approve na USDC",
    expectedTopic: "approve_usdc_raydium",
  },

  // ── Specific entity ──────────────────────────────────────────
  {
    label: "Q16 — PL: BTC price snapshot",
    language: "pl",
    text: "jaka była cena bitcoina",
    expectedTopic: "btc_price_check",
  },
  {
    label: "Q17 — EN: Aave health factor check",
    language: "en",
    text: "what is my Aave health factor on the USDC borrow",
    expectedTopic: "aave_borrow_rate_check",
  },

  // ── Off-topic probe — no DeFi episode should land on top ─────
  {
    label: "Q18 — PL off-topic: should NOT match DeFi episodes (SpaceX filler present)",
    language: "pl",
    text: "kiedy leci starship",
    expectedTopic: "off_topic_news",
  },

  // ── Generic query — many mid-sim hits; operator inspects spread
  {
    label: "Q19 — PL very generic: 'what did I do with USDC' — diffuse hit",
    language: "pl",
    text: "co robiłem z USDC w tej sesji",
    expectedTopic: "swap_jupiter", // arbitrary; diffuse queries rarely have a clean top-1
  },
];

// ── Main ─────────────────────────────────────────────────────────────

async function runDemo(): Promise<void> {
  const config = loadEmbeddingConfig();
  await runMigrations();

  const sessionId = `demo-recall-${Date.now()}`;
  const scopeKey = sessionId;

  logger.info("demo.start", {
    sessionId,
    scopeKey,
    episodes: EPISODES.length,
    queries: QUERIES.length,
    model: config.model,
    dim: config.dim,
  });

  await createSession(sessionId);
  await setMemoryScopeKey(sessionId, scopeKey);

  // Seed the memory language contract. In production this is written by the
  // first checkpoint's `session_language_inferred`; here we set it explicitly
  // so the rest of the script can read it back and demonstrate the full
  // PR2 contract without depending on a real LLM call.
  await setMemoryLanguageCode(sessionId, "pl");
  const persistedCode = await getMemoryLanguageCode(sessionId);
  logger.info("demo.language_code.persisted", { sessionId, code: persistedCode });

  // ── Insert phase ────────────────────────────────────────────────
  const rows: NewEpisode[] = [];
  for (let i = 0; i < EPISODES.length; i++) {
    const ep = EPISODES[i]!;
    const { embedding, providerModel } = await embedDocument(ep.title, ep.summary, config);
    rows.push({
      sessionId,
      memoryScopeKey: scopeKey,
      episodeKind: ep.kind,
      title: ep.title,
      summaryText: ep.summary,
      facts: ep.facts ?? {},
      decisions: {},
      openLoops: {},
      entities: ep.entities ?? [],
      toolOutcomes: {},
      sourceSurface: "echo_agent",
      sourceSession: sessionId,
      sourceStartMessageId: i * 2 + 1,
      sourceEndMessageId: i * 2 + 2,
      episodeHash: computeEpisodeHash(ep.kind, ep.summary.trim()),
      embeddingModel: providerModel,
      embeddingDim: embedding.length,
      embedding,
    });
    logger.info("demo.embedded", {
      index: i + 1,
      kind: ep.kind,
      topic: ep.topic,
      summaryChars: ep.summary.length,
    });
  }
  const inserted = await insertEpisodes(rows);
  logger.info("demo.inserted", { count: inserted.length });

  // ── Recall phase ────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log(`Session id:           ${sessionId}`);
  console.log(`Model:                ${config.model}`);
  console.log(`Scope key:            ${scopeKey}`);
  console.log(`memory_language_code: ${persistedCode ?? "(unset)"}`);
  console.log(`Episodes inserted:    ${inserted.length}`);
  console.log(`Queries:              ${QUERIES.length}`);
  console.log("=".repeat(72));

  let hit1 = 0;
  let hit3 = 0;
  const lowSimFlags: string[] = [];

  for (const q of QUERIES) {
    const { embedding, providerModel } = await embedQuery(q.text, config);
    const hits = await recallTopK(embedding, {
      memoryScopeKey: scopeKey,
      embeddingModel: providerModel,
      embeddingDim: embedding.length,
      topK: 3,
      minSimilarity: 0,
    });

    console.log("\n" + "-".repeat(72));
    console.log(`${q.label}  [lang=${q.language}]`);
    console.log(`  query:    "${q.text}"`);
    console.log(`  expected: ${q.expectedTopic}`);
    console.log("");

    if (hits.length === 0) {
      console.log("  (no hits above minSimilarity=0)");
      continue;
    }

    const topHit = hits[0]!;
    const topTopic = EPISODES.find(e => e.summary === topHit.episode.summaryText)?.topic ?? "?";
    if (topTopic === q.expectedTopic) hit1++;
    if (hits.some(h => {
      const t = EPISODES.find(e => e.summary === h.episode.summaryText)?.topic ?? "?";
      return t === q.expectedTopic;
    })) hit3++;

    // Flag diffuse/weak matches the operator should eyeball.
    if (topHit.similarity < 0.45) lowSimFlags.push(`${q.label} (top sim ${topHit.similarity.toFixed(3)})`);

    hits.forEach((h, idx) => {
      const topic = EPISODES.find(e => e.summary === h.episode.summaryText)?.topic ?? "?";
      const correct = topic === q.expectedTopic ? " ✓" : "  ";
      const title = h.episode.title || "(no title)";
      console.log(
        `  #${idx + 1}${correct} sim=${h.similarity.toFixed(3)}  kind=${h.episode.episodeKind.padEnd(20)}  topic=${topic}`,
      );
      console.log(`        title: ${title}`);
      const truncated = h.episode.summaryText.length > 140
        ? h.episode.summaryText.slice(0, 137) + "..."
        : h.episode.summaryText;
      console.log(`        summary: ${truncated}`);
    });
  }

  // ── Aggregate summary ───────────────────────────────────────────
  const total = QUERIES.length;
  console.log("\n" + "=".repeat(72));
  console.log("AGGREGATE");
  console.log(`  Recall@1: ${hit1}/${total} (${((hit1 / total) * 100).toFixed(1)}%)`);
  console.log(`  Recall@3: ${hit3}/${total} (${((hit3 / total) * 100).toFixed(1)}%)`);
  if (lowSimFlags.length > 0) {
    console.log(`  Diffuse / weak top-1 (<0.45):`);
    for (const f of lowSimFlags) console.log(`    - ${f}`);
  } else {
    console.log(`  Diffuse / weak top-1 (<0.45): none`);
  }
  console.log("=".repeat(72));
  console.log("Inspect in DB:");
  console.log(`  psql $ECHO_AGENT_DB_URL -c "SELECT id, episode_kind, title, summary_text FROM session_episodes WHERE session_id = '${sessionId}' ORDER BY id;"`);
  console.log("  psql $ECHO_AGENT_DB_URL -c \"SELECT id, memory_scope_key, memory_language_code FROM sessions WHERE id = '" + sessionId + "';\"");
  console.log("Drop the demo session (CASCADE removes episodes):");
  console.log(`  psql $ECHO_AGENT_DB_URL -c "DELETE FROM sessions WHERE id = '${sessionId}';"`);
  console.log("=".repeat(72));
}

// ── CLI entry ────────────────────────────────────────────────────────

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1]!)).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  runDemo()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async err => {
      logger.error("demo.failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await closePool().catch(() => { /* already dead */ });
      process.exit(1);
    });
}
