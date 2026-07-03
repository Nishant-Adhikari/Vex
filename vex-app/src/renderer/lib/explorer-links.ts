/**
 * Block-explorer deep links for MOVES rows.
 *
 * Pure mapping from the tolerant `MoveItem.chain` string (+ `txRef`) to a
 * public explorer transaction URL. The renderer only RENDERS the link; the
 * actual open goes `window.open` → main's `setWindowOpenHandler` →
 * `shell.openExternal`, gated by main's external-link ALLOWLIST
 * (`src/main/windows/main-window.ts`). Every host emitted here must stay on
 * that allowlist — this helper is a convenience mapper, NOT a security
 * boundary.
 *
 * Chain identifiers come from the engine's `proj_activity.chain` column and
 * are tolerant strings, not an enum. Normalization is lowercase + trim, and
 * the map additionally recognises the CAIP-2 `eip155:<id>` aliases for the
 * EVM chains already mapped. Anything else (unknown chain, `null`/blank
 * `txRef`) resolves to `null` and the row simply renders non-interactive —
 * never throw, never emit a half-built URL.
 *
 * Deliberately tiny: add a chain here only when its explorer host is also
 * added to main's allowlist. Do NOT grow this into a chain registry.
 */

/** Normalized chain alias → explorer tx-path base (trailing slash included). */
const EXPLORER_TX_BASE: ReadonlyMap<string, string> = new Map([
  ["solana", "https://explorer.solana.com/tx/"],
  ["ethereum", "https://etherscan.io/tx/"],
  ["mainnet", "https://etherscan.io/tx/"],
  ["eip155:1", "https://etherscan.io/tx/"],
  ["base", "https://basescan.org/tx/"],
  ["eip155:8453", "https://basescan.org/tx/"],
  ["arbitrum", "https://arbiscan.io/tx/"],
  ["eip155:42161", "https://arbiscan.io/tx/"],
  ["bsc", "https://bscscan.com/tx/"],
  ["bnb", "https://bscscan.com/tx/"],
  ["eip155:56", "https://bscscan.com/tx/"],
  ["polygon", "https://polygonscan.com/tx/"],
  ["eip155:137", "https://polygonscan.com/tx/"],
  ["optimism", "https://optimistic.etherscan.io/tx/"],
  ["eip155:10", "https://optimistic.etherscan.io/tx/"],
]);

/**
 * Resolve a MOVES row to its block-explorer transaction URL.
 *
 * @param chain tolerant chain identifier (e.g. `solana`, `Ethereum`, `eip155:1`)
 * @param txRef tx hash (EVM) / signature (Solana); `null` when the capture
 *              recorded neither
 * @returns the explorer URL, or `null` for unknown chains / missing refs
 */
export function moveExplorerUrl(
  chain: string,
  txRef: string | null,
): string | null {
  if (txRef === null) return null;
  // A whitespace-only ref would produce a dead `/tx/` link — treat as absent.
  const ref = txRef.trim();
  if (ref.length === 0) return null;
  const base = EXPLORER_TX_BASE.get(chain.trim().toLowerCase());
  if (base === undefined) return null;
  return `${base}${encodeURIComponent(ref)}`;
}
