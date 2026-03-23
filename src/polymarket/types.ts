/**
 * Polymarket shared types — core entities used across Gamma, CLOB, and Data API.
 * Domain-specific types live in their sub-directories.
 */

/** Polymarket event — contains one or more markets. */
export interface PolyEvent {
  id: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  image: string | null;
  category: string | null;
  active: boolean | null;
  closed: boolean | null;
  featured: boolean | null;
  liquidity: number | null;
  volume: number | null;
  openInterest: number | null;
  startDate: string | null;
  endDate: string | null;
  negRisk: boolean | null;
  markets: PolyMarket[];
}

/** Polymarket market — a single binary YES/NO question. */
export interface PolyMarket {
  id: string;
  question: string | null;
  conditionId: string;
  slug: string | null;
  description: string | null;
  image: string | null;
  outcomes: string | null;
  outcomePrices: string | null;
  volume: string | null;
  volumeNum: number | null;
  liquidity: string | null;
  liquidityNum: number | null;
  active: boolean | null;
  closed: boolean | null;
  endDate: string | null;
  clobTokenIds: string | null;
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
  oneDayPriceChange: number | null;
  spread: number | null;
  orderPriceMinTickSize: number | null;
  orderMinSize: number | null;
  acceptingOrders: boolean | null;
  negRisk: boolean | null;
}

/** Polymarket tag. */
export interface PolyTag {
  id: string;
  label: string | null;
  slug: string | null;
}

/** Polymarket public profile. */
export interface PolyProfile {
  proxyWallet: string | null;
  name: string | null;
  pseudonym: string | null;
  bio: string | null;
  profileImage: string | null;
  displayUsernamePublic: boolean | null;
  xUsername: string | null;
  verifiedBadge: boolean | null;
}
