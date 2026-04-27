/**
 * KyberSwap retrieval-only text fragments.
 *
 * These strings are intentionally different from public tool descriptions:
 * descriptions teach the model how to use a tool, while embedding text teaches
 * dense retrieval which user intents should find that tool.
 */

export const KYBER_SWAP_CHAINS =
  "Ethereum, BNB Chain, BSC, Binance Smart Chain, Arbitrum, Polygon POS, Matic, Optimism, " +
  "Avalanche, Base, Linea, Mantle, Sonic, Berachain, Ronin, Unichain, HyperEVM, Plasma, " +
  "Etherlink, Monad, MegaETH";

export const KYBER_LIMIT_ORDER_CHAINS =
  "Ethereum, BNB Chain, BSC, Binance Smart Chain, Arbitrum, Polygon POS, Matic, Optimism, " +
  "Avalanche, Base, Linea, Mantle, Sonic, Berachain, Ronin, Unichain, HyperEVM, Monad, MegaETH";

export const KYBER_ZAP_CHAINS =
  "Ethereum, BNB Chain, BSC, Binance Smart Chain, Arbitrum, Polygon POS, Matic, Optimism, " +
  "Avalanche, Base, Linea, Sonic, Berachain, Ronin, Scroll, zkSync";

export function kyberEmbeddingText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
