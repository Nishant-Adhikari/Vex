/**
 * SIDEBAR POSITION SUMMARY — the compact wallet-position widget that rides the
 * sessions rail where the $VEX price card used to (owner request: swap the
 * token ticker for the operator's own position).
 *
 * Shows the three figures the operator wants at a glance: the live total (USD,
 * the one accent figure), the configured WALLET count, and the aggregated
 * native ETH balance. Reads the GLOBAL portfolio (the same `usePortfolioScoped`
 * path the BOOK PositionBlock uses — the renderer never names a wallet address;
 * main resolves the server-side allow-list). Speaks the Signal Tape grammar
 * strictly (solid surface + hairline, `--vex-*` tokens only, tabular figures)
 * and resolves EVERY state to a visible line so the rail is never blank.
 */

import type { JSX } from "react";
import { usePortfolioScoped } from "../../../lib/api/portfolio.js";
import { formatTokenAmount, formatUsd } from "../../../lib/format.js";
import { sumTokenAmountBySymbol } from "./sidebarPositionModel.js";

const CARD_CLASS =
  "rounded-xl border border-[var(--vex-line)] bg-[var(--vex-surface-1)] px-3 py-2.5";

const EYEBROW =
  "font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]";

export function SidebarPositionSummary(): JSX.Element {
  const query = usePortfolioScoped({ scope: "global" });
  const result = query.data;
  const portfolio = result?.ok ? result.data : null;

  if (query.isLoading) {
    return (
      <section
        data-vex-area="sidebar-position"
        data-state="loading"
        aria-label="Position summary"
        className={CARD_CLASS}
      >
        <span className={EYEBROW}>Position</span>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
          Loading…
        </p>
      </section>
    );
  }

  if ((result !== undefined && !result.ok) || query.isError) {
    return (
      <section
        data-vex-area="sidebar-position"
        data-state="error"
        aria-label="Position summary unavailable"
        className={CARD_CLASS}
      >
        <span className={EYEBROW}>Position</span>
        <p className="mt-1 text-[11px] text-[var(--vex-warn-text)]">
          Position data unavailable.
        </p>
      </section>
    );
  }

  if (portfolio === null || portfolio.walletCount === 0) {
    return (
      <section
        data-vex-area="sidebar-position"
        data-state="empty"
        aria-label="Position summary"
        className={CARD_CLASS}
      >
        <span className={EYEBROW}>Position</span>
        <p className="mt-1 text-[11px] text-[var(--vex-text-3)]">
          No wallets configured.
        </p>
      </section>
    );
  }

  const ethBalance = sumTokenAmountBySymbol(portfolio.tokens, "ETH");
  const walletLabel = `${portfolio.walletCount} ${
    portfolio.walletCount === 1 ? "wallet" : "wallets"
  }`;

  return (
    <section
      data-vex-area="sidebar-position"
      data-state="ok"
      aria-label="Position summary"
      className={CARD_CLASS}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={EYEBROW}>Position</span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
          {walletLabel}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="font-display text-[20px] font-extrabold leading-[1.05] tracking-[-0.02em] tabular-nums text-[var(--vex-accent-text)]">
          {formatUsd(portfolio.liveTotalUsd)}
        </span>
        {ethBalance !== null ? (
          <span
            className="font-mono text-[11px] tabular-nums text-[var(--vex-text-2)]"
            aria-label={`Ethereum balance ${formatTokenAmount(ethBalance)} ETH`}
          >
            {formatTokenAmount(ethBalance)} ETH
          </span>
        ) : null}
      </div>
    </section>
  );
}
