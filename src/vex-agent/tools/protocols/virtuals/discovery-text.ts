/**
 * Virtuals retrieval-only chain enumeration.
 *
 * The Virtuals Protocol launches agent tokens on exactly four chains. Used as
 * the low-weight lexical `chains` field on each Virtuals manifest so queries
 * like "agent tokens on robinhood" recall the namespace.
 */

export const VIRTUALS_CHAIN_LABELS: readonly string[] = [
  "Robinhood",
  "Base",
  "Solana",
  "Ethereum",
];
