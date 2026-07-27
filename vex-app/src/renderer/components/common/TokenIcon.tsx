/**
 * Token mark — a best-effort visual for a token SYMBOL in the POSITION
 * per-chain holdings rows.
 *
 * Well-known symbols map to `@thesvg/react` brand marks (verified present in
 * the installed package); everything else — memecoins, LP shares, unknowns —
 * gets a neutral mono monogram ring (first glyph). Deliberately OFFLINE and
 * deterministic: no network logo fetching, no provider URLs (the renderer
 * stays free of third-party image loads).
 *
 * Marks are decorative (`aria-hidden`) — the adjacent symbol text is the
 * accessible content.
 */

import type { JSX } from "react";
import {
  BnbChain,
  Chainlink,
  Circle,
  Ethereum,
  Optimism,
  Polygon,
  Solana,
  Tether,
} from "@thesvg/react";
import { cn } from "../../lib/utils.js";

type BrandIcon = typeof Ethereum;

/** Lower-cased symbol → verified `@thesvg/react` mark. Wrapped variants map
 * to the underlying asset's mark — close enough at 12px, honest at a glance. */
const ICON_BY_SYMBOL: Readonly<Record<string, BrandIcon>> = {
  eth: Ethereum,
  weth: Ethereum,
  sol: Solana,
  wsol: Solana,
  usdt: Tether,
  usdc: Circle,
  link: Chainlink,
  bnb: BnbChain,
  wbnb: BnbChain,
  matic: Polygon,
  pol: Polygon,
  op: Optimism,
};

/**
 * Lower-cased symbols that resolve to a real brand mark above. Callers that
 * accept an UNTRUSTED display symbol (e.g. a captured/provider-supplied
 * token symbol that can self-declare arbitrary metadata) use this set to
 * decide whether a symbol claim needs independent verification before it is
 * allowed to borrow a brand's identity — see
 * `vex-app/src/shared/token-symbol-sanitizer.ts`.
 */
export const BRAND_ICON_SYMBOLS: ReadonlySet<string> = new Set(
  Object.keys(ICON_BY_SYMBOL),
);

export function TokenIcon({
  symbol,
  size = 13,
  className,
}: {
  readonly symbol: string | null;
  readonly size?: number;
  readonly className?: string;
}): JSX.Element {
  const Icon =
    symbol !== null ? ICON_BY_SYMBOL[symbol.toLowerCase()] : undefined;
  if (Icon !== undefined) {
    return (
      <Icon
        width={size}
        height={size}
        aria-hidden
        focusable={false}
        className={cn("shrink-0", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--vex-line-strong)] font-mono uppercase leading-none text-[var(--vex-text-3)]",
        className,
      )}
    >
      {symbol !== null && symbol.length > 0 ? symbol.charAt(0) : "?"}
    </span>
  );
}
