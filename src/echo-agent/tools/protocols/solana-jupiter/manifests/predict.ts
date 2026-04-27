import type { ProtocolToolManifest } from "../../types.js";

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
      embeddingText: "List Jupiter prediction market events on Solana. Browse binary YES NO markets by crypto, sports, politics, esports, culture, economics and tech; filter trending, live or new prediction events with included markets.",
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
      embeddingText: "Search Jupiter prediction market events by keyword. Find binary YES NO markets, event questions, crypto predictions, sports predictions, politics markets and live prediction opportunities on Solana.",
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
      embeddingText: "Get one Jupiter prediction market detail by market ID. Inspect YES and NO prices, probability, volume, status, payout, market metadata and trading conditions before buying or selling prediction shares.",
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
      embeddingText: "Get all open Jupiter prediction positions for a Solana wallet. Review YES NO market exposure, unrealized PnL, position size, average price, payout and active prediction portfolio.",
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
      embeddingText: "Get Jupiter prediction trade history for a wallet. Review prediction market buys, sells, claims, realized PnL, closed positions, settlement history and paginated activity.",
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
      embeddingText: "Buy YES or NO shares in a Jupiter prediction market using USDC on Solana. Open a binary prediction position, trade event outcome, speculate on crypto, sports, politics or culture markets.",
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
      embeddingText: "Sell or close a Jupiter prediction market position. Exit YES or NO shares, reduce exposure, close an open prediction position and receive USDC settlement on Solana.",
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
      embeddingText: "Claim winnings from a resolved Jupiter prediction market position. Redeem payout for winning YES or NO shares, settle resolved prediction position and receive USDC proceeds.",
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
      embeddingText: "Close all open Jupiter prediction positions for a wallet. Batch sell or claim prediction market positions, exit all YES NO exposure and settle the prediction portfolio.",
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
      embeddingText: "Get one Jupiter prediction event by event ID with all related markets. Inspect event-level prediction questions, market list, YES NO outcomes, status and category before selecting a specific market.",
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
      embeddingText: "Get one Jupiter prediction position detail by position public key. Inspect open or resolved YES NO position, contracts, payout, market reference, claimability and position state.",
    },
  },
];
