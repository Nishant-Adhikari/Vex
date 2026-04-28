import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";

const SOLANA_CHAINS: readonly string[] = ["Solana"];

export const PREDICT_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.predict.events",
    namespace: "solana",
    lifecycle: "active",
    description: "List prediction market events — crypto, sports, politics, culture, economics, tech.",
    mutating: false,
    params: [
      { key: "category", type: "string", description: "Category filter." },
      { key: "filter", type: "string", description: "Filter: trending, live, new." },
    ],
    exampleParams: { category: "crypto", filter: "trending" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Browse prediction market events on Solana — sports, crypto, politics, esports, culture, economics, tech — with binary YES/NO markets. ` +
        `Use this when the user wants to browse what they can bet on, see live or trending prediction markets, browse by category, or discover prediction opportunities. ` +
        `Example queries: browse prediction markets, what can I bet on, live sports markets, trending crypto predictions, politics prediction events, prediction events on solana.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.predict.search",
    namespace: "solana",
    lifecycle: "active",
    description: "Search prediction events by keyword.",
    mutating: false,
    params: [
      { key: "query", type: "string", required: true, description: "Search query." },
    ],
    exampleParams: { query: "bitcoin" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Search Jupiter prediction market events on Solana by keyword across sports, crypto, politics, esports, culture, economics, and tech. ` +
        `Use this when the user wants to find a specific prediction market, search by topic (bitcoin, election, super bowl), filter the prediction catalog by keyword, or look up a specific event. ` +
        `Example queries: find bitcoin prediction markets, search election predictions, look up super bowl bets, find solana price markets, search prediction by keyword, find this prediction event.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.predict.market",
    namespace: "solana",
    lifecycle: "active",
    description: "Get prediction market details — YES/NO prices, volume, status.",
    mutating: false,
    params: [
      { key: "marketId", type: "string", required: true, description: "Market ID." },
    ],
    exampleParams: { marketId: "abc123" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Get full details of a single Jupiter prediction market — YES/NO prices, probability, volume, status, payout, metadata. ` +
        `Use this when the user wants the deep stats on one specific market, check the current odds before betting, see how a market is priced, or review trading conditions. ` +
        `Example queries: details for this prediction market, what's the current odds on this, yes no prices for this market, market depth before betting, status of this prediction.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.predict.positions",
    namespace: "solana",
    lifecycle: "active",
    description: "Get open prediction positions with PnL for a wallet.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
    ],
    exampleParams: { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Get a wallet's open Jupiter prediction positions on Solana — YES/NO sides, exposure, unrealized PnL, payout. ` +
        `Use this when the user wants to see their open prediction bets, check pending exposure, review unrealized PnL on bets, or list active prediction positions. ` +
        `Example queries: my open prediction bets, show my prediction positions, unrealized pnl on prediction, what bets do I have, active yes no positions.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.predict.history",
    namespace: "solana",
    lifecycle: "active",
    description: "Get prediction trade history — buys, sells, claims, realized PnL.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
      { key: "limit", type: "number", description: "Max results." },
      { key: "offset", type: "number", description: "Skip first N results for pagination." },
    ],
    exampleParams: { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Get a wallet's full Jupiter prediction trade history on Solana — past buys, sells, claims, realized PnL, closed positions, settlement events. ` +
        `Use this when the user wants to review past prediction trades, see realized PnL on closed bets, audit their prediction activity, look at past prediction settlements, or browse closed positions paginated. ` +
        `Example queries: my prediction history, past prediction trades, realized pnl on prediction, closed prediction bets, audit my prediction activity, prediction trade log.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.predict.buy",
    namespace: "solana",
    lifecycle: "active",
    description: "Buy YES or NO shares in a prediction market.",
    mutating: true,
    params: [
      { key: "marketId", type: "string", required: true, description: "Market ID." },
      { key: "side", type: "string", required: true, description: "Side: yes or no." },
      { key: "amountUsdc", type: "number", required: true, description: "Amount in USDC." },
    ],
    exampleParams: { marketId: "abc123", side: "yes", amountUsdc: 10 },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Buy YES or NO shares in a Jupiter prediction market on Solana to bet on the outcome of a real-world event — sports, crypto prices, politics, culture, tech. ` +
        `Use this when the user wants to bet on something, take a position on an outcome, buy yes or no shares, speculate on an event, or open a prediction trade. ` +
        `Example queries: bet on solana hitting 500, buy yes on this market, take the no side, speculate on the election, trade prediction outcome, place a bet.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.predict.sell",
    namespace: "solana",
    lifecycle: "active",
    description: "Sell (close) a prediction position.",
    mutating: true,
    params: [
      { key: "positionPubkey", type: "string", required: true, description: "Position public key." },
    ],
    exampleParams: { positionPubkey: "Abc123..." },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Sell or close one Jupiter prediction position on Solana. ` +
        `Use this when the user wants to exit a prediction bet, close a yes or no position before settlement, take profit on a prediction, or reduce exposure on a market. ` +
        `Example queries: sell my prediction position, exit this bet, close my yes shares, take profit on prediction, get out of this market early.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.predict.claim",
    namespace: "solana",
    lifecycle: "active",
    description: "Claim winnings from a resolved prediction position.",
    mutating: true,
    params: [
      { key: "positionPubkey", type: "string", required: true, description: "Position public key." },
    ],
    exampleParams: { positionPubkey: "Abc123..." },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Claim winnings from a resolved Jupiter prediction position on Solana. ` +
        `Use this when the user wants to redeem a winning bet, settle a resolved position, claim payout for correct yes or no shares, cash out a successful prediction, or collect earnings from a finished prediction market. ` +
        `Example queries: claim my winning bet, redeem this prediction payout, settle resolved position, collect my prediction winnings, claim payout, cash out winning shares.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.predict.closeAll",
    namespace: "solana",
    lifecycle: "active",
    description: "Close (sell) all open prediction positions.",
    mutating: true,
    params: [],
    exampleParams: {},
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Close every open Jupiter prediction position on Solana for a wallet in batch. ` +
        `Use this when the user wants to wipe out all open prediction bets, panic-exit the prediction portfolio, settle every claimable position, or close out their prediction exposure entirely. ` +
        `Example queries: close all my prediction positions, panic exit prediction portfolio, settle all bets, wipe out my prediction exposure, batch close prediction.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.predict.event",
    namespace: "solana",
    lifecycle: "active",
    description: "Get a single prediction event by ID with all its markets.",
    mutating: false,
    params: [
      { key: "eventId", type: "string", required: true, description: "Event ID." },
    ],
    exampleParams: { eventId: "abc123" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Get a single prediction event with all of its included markets on Solana. ` +
        `Use this when the user wants to see one event (e.g. an election, a sports match) along with every related market it spawns, before picking which specific market to trade. ` +
        `Example queries: get this event with all markets, full event details, markets for this election, all bets for this match, browse one event.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.predict.position",
    namespace: "solana",
    lifecycle: "active",
    description: "Get a single prediction position detail by pubkey.",
    mutating: false,
    params: [
      { key: "positionPubkey", type: "string", required: true, description: "Position public key." },
    ],
    exampleParams: { positionPubkey: "Abc123..." },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Get one Jupiter prediction position by public key — open or resolved, contracts, payout, market reference, claimability. ` +
        `Use this when the user wants the deep details on one specific bet, check whether a position is claimable, review the state of one prediction position, or look up a single bet by pubkey. ` +
        `Example queries: details for this prediction position, is this position claimable, status of one bet, look up position by pubkey, full state of one bet.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
];
