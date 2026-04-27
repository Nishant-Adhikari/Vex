import type { ProtocolNamespaceNavigation } from "./types.js";

export const ZERO_G_PROTOCOL_NAVIGATION: readonly ProtocolNamespaceNavigation[] = [
  {
    namespace: "jaine",
    advertised: false,
    groupId: "0g-ecosystem",
    groupLabel: "0G Ecosystem",
    summary: "0G DEX for spot swaps, pool discovery, LP management, and wrap/unwrap flows.",
    whenToUse:
      "Use when you need 0G-native DEX liquidity, pool analytics, swap quotes/execution, allowances, or w0G wrapping.",
    preferInstead:
      "Use `slop` for bonding-curve token launches/trades, `chainscan` for explorer lookups, and `khalani` for cross-chain bridging.",
    exampleQueries: [
      'discover_tools(query="0g swap quote", namespace="jaine")',
      'discover_tools(query="0g liquidity pools", namespace="jaine")',
      'discover_tools(query="wrap 0g into w0g", namespace="jaine")',
    ],
    aliases: ["0g dex", "0g exchange", "jaine dex", "w0g dex"],
    discoveryHints: ["0g swap", "0g liquidity pool", "0g lp position", "wrap 0g", "unwrap w0g"],
    facets: [
      {
        label: "Pools and market structure",
        summary: "Find top pools, pair liquidity, recent pool activity, and DEX-wide stats on Jaine.",
        toolPrefixes: ["jaine.meta", "jaine.pools", "jaine.pool", "jaine.dex"],
        hints: ["pool discovery", "lp analytics", "top pools", "pair liquidity", "recent swaps"],
      },
      {
        label: "Swaps and token operations",
        summary: "Quote/execute swaps, inspect token metadata, manage allowances, and wrap/unwrap w0G.",
        toolPrefixes: ["jaine.token", "jaine.tokens", "jaine.swap", "jaine.allowance", "jaine.w0g"],
        hints: ["swap quote", "swap on 0g", "token info", "approve spender", "wrap w0g"],
      },
    ],
  },
  {
    namespace: "slop",
    advertised: false,
    groupId: "0g-ecosystem",
    groupLabel: "0G Ecosystem",
    summary: "0G bonding curve launchpad for token creation, curve pricing, trading, fees, and rewards.",
    whenToUse:
      "Use when the user wants Slop bonding curve tokens: create a token, inspect curve state, buy/sell on-curve, or claim creator/LP rewards.",
    preferInstead:
      "Use `jaine` once liquidity graduates to the DEX, and `dexscreener` for non-0G market research.",
    exampleQueries: [
      'discover_tools(query="bonding curve token", namespace="slop")',
      'discover_tools(query="buy 0g meme token", namespace="slop", includeMutating=true)',
      'discover_tools(query="creator rewards", namespace="slop")',
    ],
    aliases: ["slop money", "bonding curve", "0g launchpad", "0g meme token"],
    discoveryHints: [
      "bonding curve token",
      "create token on 0g",
      "buy meme token",
      "graduation progress",
      "creator fees",
    ],
    facets: [
      {
        label: "Token launch and trading",
        summary: "Create tokens, list your launched tokens, inspect curve state, and trade Slop bonding-curve assets.",
        toolPrefixes: ["slop.token", "slop.tokens", "slop.trade", "slop.price", "slop.curve"],
        hints: ["launch token", "my tokens", "curve price", "buy on slop", "sell on slop", "graduation"],
      },
      {
        label: "Fees and rewards",
        summary: "Inspect pending fees/rewards and claim creator or LP payouts.",
        toolPrefixes: ["slop.fees", "slop.reward"],
        hints: ["creator fees", "lp fees", "reward claim", "pending rewards"],
      },
    ],
  },
  {
    namespace: "slop-app",
    advertised: false,
    groupId: "0g-ecosystem",
    groupLabel: "0G Ecosystem",
    summary: "Slop.money app APIs for profiles, image generation/upload, agent discovery, and chat.",
    whenToUse:
      "Use when the user needs profile registration, avatar/image workflows, agent token discovery, or Slop app chat access.",
    preferInstead:
      "Use `echobook` for social feed/community actions and `slop` for on-chain bonding-curve trading.",
    exampleQueries: [
      'discover_tools(query="profile avatar image", namespace="slop-app")',
      'discover_tools(query="agent token discovery", namespace="slop-app")',
      'discover_tools(query="chat history", namespace="slop-app")',
    ],
    aliases: ["slop app", "slop social", "agent discovery", "profile image"],
    discoveryHints: [
      "profile registration",
      "avatar image",
      "image generation",
      "agent token discovery",
      "chat history",
    ],
    facets: [
      {
        label: "Profiles and identity",
        summary: "Read/register profiles and attach Echo-style identity data.",
        toolPrefixes: ["slop-app.profile"],
        hints: ["profile", "register profile", "echo badge"],
      },
      {
        label: "Images",
        summary: "Upload an image or generate one through the Slop app proxy.",
        toolPrefixes: ["slop-app.image"],
        hints: ["avatar image", "generate image", "upload image", "ipfs image"],
      },
      {
        label: "Agents and chat",
        summary: "Query agent datasets and interact with app chat/history.",
        toolPrefixes: ["slop-app.agents", "slop-app.chat"],
        hints: ["agent token discovery", "agents query", "chat message", "chat history"],
      },
    ],
  },
  {
    namespace: "chainscan",
    advertised: false,
    groupId: "0g-ecosystem",
    groupLabel: "0G Ecosystem",
    summary: "0G-only explorer and token intel surface for transactions, contracts, decoding, and holder stats.",
    whenToUse:
      "Use when you need an explorer-style answer on 0G: tx/receipt lookup, contract ABI/source, calldata decoding, balances, or token-holder analytics.",
    preferInstead:
      "Use `khalani` for multi-chain balances, `jaine` for 0G DEX liquidity, and `dexscreener` for non-0G market research.",
    exampleQueries: [
      'discover_tools(query="0g explorer", namespace="chainscan")',
      'discover_tools(query="transaction lookup", namespace="chainscan")',
      'discover_tools(query="token holder stats", namespace="chainscan")',
    ],
    aliases: ["0g explorer", "0g scan", "chainscan 0g", "0g block explorer"],
    discoveryHints: ["transaction lookup", "contract source", "decode calldata", "token holder stats", "0g explorer"],
    facets: [
      {
        label: "Account and transaction lookup",
        summary: "Read balances, transfers, tx status, and receipt-style explorer data on 0G.",
        toolPrefixes: ["chainscan.account", "chainscan.tx"],
        hints: ["wallet balance", "token transfers", "receipt status", "tx lookup"],
      },
      {
        label: "Contract and calldata intel",
        summary: "Inspect contract ABI/source/creation and decode method calls on 0G.",
        toolPrefixes: ["chainscan.contract", "chainscan.decode"],
        hints: ["contract abi", "source code", "creator tx", "decode method"],
      },
      {
        label: "Token analytics",
        summary: "Inspect supply, holders, transfer trends, and top token participants.",
        toolPrefixes: ["chainscan.token", "chainscan.stats"],
        hints: ["token supply", "holder count", "top holders", "participant stats"],
      },
    ],
  },
  {
    namespace: "echobook",
    advertised: false,
    groupId: "0g-ecosystem",
    groupLabel: "0G Ecosystem",
    summary: "EchoBook social trading surface for feeds, posts, comments, follows, notifications, points, and trade proofs.",
    whenToUse:
      "Use when the user wants EchoBook community/social actions: browse feeds, search posts, manage follows, check notifications, inspect points, or submit trade proofs.",
    preferInstead:
      "Use `slop-app` for profile/image/agent/chat utilities and `chainscan` for on-chain explorer data.",
    exampleQueries: [
      'discover_tools(query="social feed", namespace="echobook")',
      'discover_tools(query="notifications", namespace="echobook")',
      'discover_tools(query="trade proof", namespace="echobook", includeMutating=true)',
    ],
    aliases: ["echo book", "social feed", "trading social", "community feed"],
    discoveryHints: ["posts feed", "following feed", "comments", "notifications", "trade proof", "points leaderboard"],
    facets: [
      {
        label: "Feeds, posts, and comments",
        summary: "Browse feed/following feed, fetch posts and threaded comments, create/delete posts and comments, and search profile posts.",
        toolPrefixes: ["echobook.feed", "echobook.post", "echobook.posts", "echobook.comment", "echobook.comments"],
        hints: ["posts feed", "following feed", "create post", "comment thread", "reply to post", "search posts"],
      },
      {
        label: "Social graph and profiles",
        summary: "Inspect/update profiles, manage follows, votes, reposts, and submolt communities.",
        toolPrefixes: [
          "echobook.profile",
          "echobook.follow",
          "echobook.followers",
          "echobook.following",
          "echobook.vote",
          "echobook.repost",
          "echobook.submolt",
          "echobook.submolts",
        ],
        hints: ["profile search", "follow status", "repost", "submolt", "vote on post"],
      },
      {
        label: "Notifications, points, and trade proofs",
        summary: "Read notifications, points data, and verify on-platform trade proof status.",
        toolPrefixes: ["echobook.notifications", "echobook.points", "echobook.tradeProof"],
        hints: ["unread notifications", "points leaderboard", "points events", "trade proof"],
      },
    ],
  },
] as const;
