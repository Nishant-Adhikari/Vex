/**
 * KyberSwap Token API types.
 *
 * Base URL: https://token-api.kyberswap.com
 */

export interface KyberToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  marketCap?: number;
  isVerified?: boolean;
  isWhitelisted?: boolean;
  isStable?: boolean;
}

export interface KyberTokenSearchResponse {
  data: {
    tokens: KyberToken[];
    pagination: {
      totalItems: number;
    };
  };
}

export interface HoneypotFotInfo {
  isHoneypot: boolean;
  isFOT: boolean;
  tax: number;
}
