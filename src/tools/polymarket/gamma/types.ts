/**
 * Polymarket Gamma API types — market discovery, events, search.
 * Base URL: https://gamma-api.polymarket.com
 */

export interface GammaEvent {
  id: string;
  ticker: string | null;
  slug: string | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  image: string | null;
  icon: string | null;
  active: boolean | null;
  closed: boolean | null;
  featured: boolean | null;
  restricted: boolean | null;
  liquidity: number | null;
  volume: number | null;
  openInterest: number | null;
  category: string | null;
  subcategory: string | null;
  startDate: string | null;
  endDate: string | null;
  negRisk: boolean | null;
  negRiskMarketID: string | null;
  commentCount: number | null;
  volume24hr: number | null;
  markets: GammaMarket[];
  tags: GammaTag[];
}

export interface GammaMarket {
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
  volume24hr: number | null;
  category: string | null;
  marketMakerAddress: string;
}

export interface GammaTag {
  id: string;
  label: string | null;
  slug: string | null;
  forceShow: boolean | null;
  forceHide: boolean | null;
  isCarousel: boolean | null;
}

export interface GammaRelatedTag {
  id: string;
  tagID: number | null;
  relatedTagID: number | null;
  rank: number | null;
}

export interface GammaSeries {
  id: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  image: string | null;
  active: boolean | null;
  closed: boolean | null;
  volume: number | null;
  liquidity: number | null;
  events: GammaEvent[];
}

export interface GammaComment {
  id: string;
  body: string | null;
  parentEntityType: string | null;
  parentEntityID: number | null;
  userAddress: string | null;
  createdAt: string | null;
  profile: GammaCommentProfile | null;
  reactionCount: number | null;
}

export interface GammaCommentProfile {
  name: string | null;
  pseudonym: string | null;
  bio: string | null;
  proxyWallet: string | null;
  profileImage: string | null;
}

export interface GammaProfile {
  proxyWallet: string | null;
  name: string | null;
  pseudonym: string | null;
  bio: string | null;
  profileImage: string | null;
  displayUsernamePublic: boolean | null;
  xUsername: string | null;
  verifiedBadge: boolean | null;
}

export interface GammaSportsMetadata {
  sport: string;
  image: string | null;
  resolution: string | null;
  ordering: string | null;
  tags: string | null;
  series: string | null;
}

export interface GammaTeam {
  id: number;
  name: string | null;
  league: string | null;
  record: string | null;
  logo: string | null;
  abbreviation: string | null;
}

export interface GammaSearchResult {
  events: GammaEvent[] | null;
  tags: Array<{ id: string; label: string; slug: string; event_count: number }> | null;
  profiles: Array<{ id: string; name: string | null; pseudonym: string | null; proxyWallet: string | null; profileImage: string | null }> | null;
  pagination: { hasMore: boolean; totalResults: number } | null;
}

/** Query params for listEvents. */
export interface ListEventsParams {
  limit?: number;
  offset?: number;
  order?: string;
  ascending?: boolean;
  id?: number[];
  tag_id?: number;
  tag_slug?: string;
  active?: boolean;
  closed?: boolean;
  featured?: boolean;
  liquidity_min?: number;
  volume_min?: number;
}

/** Query params for listMarkets. */
export interface ListMarketsParams {
  limit?: number;
  offset?: number;
  order?: string;
  ascending?: boolean;
  closed?: boolean;
  tag_id?: number;
  clob_token_ids?: string[];
  condition_ids?: string[];
}
