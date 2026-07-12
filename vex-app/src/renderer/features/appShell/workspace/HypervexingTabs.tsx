/**
 * Bottom registers v2 (design spec §13.9) — the venue's bottom-panel order:
 * Balances · Positions · Open Orders · TWAP · Trade History · Funding History
 * · Order History · Portfolio. Positions reuses the run-1
 * `HyperliquidPositionsBlock`; Balances renders the venue-confirmed account
 * DTO; Portfolio renders the wallet's real balance lines. Registers without a
 * renderer DTO yet render an honest empty state with a one-tap "Ask Vex"
 * action instead of fabricated rows.
 */

import { useState, type JSX } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import type { HyperliquidAccountDto } from "@shared/schemas/hyperliquid.js";
import { HyperliquidPositionsBlock } from "../book/HyperliquidPositionsBlock.js";
import { usePortfolio } from "../../../lib/api/portfolio.js";
import { useSubmitChat } from "../../../lib/api/chat.js";
import { cn } from "../../../lib/utils.js";

type WorkspaceTab =
  | "balances"
  | "positions"
  | "openOrders"
  | "twap"
  | "tradeHistory"
  | "fundingHistory"
  | "orderHistory"
  | "portfolio";

const TABS: readonly { readonly id: WorkspaceTab; readonly label: string }[] = [
  { id: "balances", label: "Balances" },
  { id: "positions", label: "Positions" },
  { id: "openOrders", label: "Open Orders" },
  { id: "twap", label: "TWAP" },
  { id: "tradeHistory", label: "Trade History" },
  { id: "fundingHistory", label: "Funding History" },
  { id: "orderHistory", label: "Order History" },
  { id: "portfolio", label: "Portfolio" },
];

/** Register asks routed to the copilot — the agent owns venue history reads. */
const REGISTER_ASKS: Readonly<
  Record<
    Exclude<WorkspaceTab, "balances" | "positions" | "portfolio">,
    { readonly caption: string; readonly ask: string }
  >
> = {
  openOrders: {
    caption: "No working orders.",
    ask: "Show my Hyperliquid open orders.",
  },
  twap: {
    caption: "No running TWAPs.",
    ask: "Show my active Hyperliquid TWAP orders.",
  },
  tradeHistory: {
    caption: "No fills yet.",
    ask: "Show my recent Hyperliquid fills.",
  },
  fundingHistory: {
    caption: "No funding payments yet.",
    ask: "Show my recent Hyperliquid funding payments.",
  },
  orderHistory: {
    caption: "No order history yet.",
    ask: "Show my recent Hyperliquid order history.",
  },
};

function usdValue(value: string | null | undefined): string {
  if (value == null) return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function BalancesPane({
  account,
  sessionId,
}: {
  readonly account: HyperliquidAccountDto | null;
  readonly sessionId: string | null;
}): JSX.Element {
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="grid max-w-[560px] grid-cols-[1fr_auto_auto] items-baseline gap-x-6 gap-y-1 font-mono text-[11px] tabular-nums">
        <span className="text-[9px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">Asset</span>
        <span className="text-right text-[9px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">Total</span>
        <span className="text-right text-[9px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">Withdrawable</span>
        <span className="text-[var(--vex-text)]">USDC · Perps</span>
        <span className="text-right text-[var(--vex-text-2)]">{usdValue(account?.equityUsd)}</span>
        <span className="text-right text-[var(--vex-text-2)]">{usdValue(account?.withdrawableUsd)}</span>
      </div>
      <AskVexEmpty
        caption="Spot balances live with the agent."
        ask="Show my Hyperliquid spot balances."
        sessionId={sessionId}
      />
      <p className="text-[10px] text-[var(--vex-text-3)]">
        Deposits: native USDC via Bridge2 on Arbitrum One (min 5 USDC). Withdrawals carry a 1 USDC venue fee.
      </p>
    </div>
  );
}

function AskVexEmpty({
  caption,
  ask,
  sessionId,
}: {
  readonly caption: string;
  readonly ask: string;
  readonly sessionId: string | null;
}): JSX.Element {
  const submit = useSubmitChat();
  return (
    <div className="flex items-baseline gap-3">
      <p className="text-[11px] text-[var(--vex-text-3)]">{caption}</p>
      <button
        type="button"
        disabled={sessionId === null || submit.isPending}
        onClick={() => sessionId !== null && submit.mutate({ sessionId, message: ask })}
        className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--vex-accent-text)] underline-offset-2 hover:underline disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        {submit.isPending ? "Asking…" : "Ask Vex"}
      </button>
    </div>
  );
}

function usdLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function PortfolioPane({ sessionId }: { readonly sessionId: string | null }): JSX.Element {
  const query = usePortfolio(sessionId);
  if (query.isLoading) {
    return <p className="text-[11px] text-[var(--vex-text-3)]">Loading portfolio…</p>;
  }
  const dto = query.data?.ok ? query.data.data : null;
  if (dto === null) {
    return (
      <p className="text-[11px] text-[var(--vex-warn-text)]">
        Portfolio unavailable right now.
      </p>
    );
  }
  const lines = dto.tokens.slice(0, 10);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
          Wallet total
        </span>
        <span className="font-mono text-[15px] font-semibold tabular-nums text-[var(--vex-text)]">
          {usdLabel(dto.liveTotalUsd)}
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="text-[11px] text-[var(--vex-text-3)]">No priced holdings yet.</p>
      ) : (
        <ul className="flex flex-col">
          {lines.map((token, index) => (
            <li
              key={`${token.chainId ?? "x"}:${token.symbol ?? index}`}
              className="flex h-7 items-center gap-3 font-mono text-[11px] tabular-nums"
            >
              <span className="min-w-0 flex-1 truncate text-[var(--vex-text)]">
                {token.symbol ?? "(unpriced token)"}
              </span>
              <span className="text-[var(--vex-text-3)]">
                {token.amount === null ? "" : token.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })}
              </span>
              <span className="w-24 text-right text-[var(--vex-text-2)]">
                {usdLabel(token.balanceUsd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HypervexingTabs({
  sessionId,
  positionCount,
  account,
}: {
  readonly sessionId: string | null;
  readonly positionCount: number;
  readonly account: HyperliquidAccountDto | null;
}): JSX.Element {
  const [active, setActive] = useState<WorkspaceTab>("positions");
  const reducedMotion = useReducedMotion() ?? false;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-4 border-b border-[var(--vex-line)] px-4">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              aria-current={isActive}
              className={cn(
                "relative h-9 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                isActive
                  ? "text-[var(--vex-accent-text)]"
                  : "text-[var(--vex-text-3)] hover:text-[var(--vex-text-2)]",
              )}
            >
              {tab.label}
              {tab.id === "positions" && positionCount > 0 ? (
                <span className="ml-1 text-[var(--vex-text-2)]">{positionCount}</span>
              ) : null}
              {isActive ? (
                <motion.span
                  aria-hidden
                  layoutId="hv-tab-underline"
                  transition={reducedMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
                  className="absolute -bottom-px left-0 h-0.5 w-full bg-[var(--vex-accent)]"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={reducedMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="min-h-0"
          >
            {active === "positions" ? (
              sessionId === null ? (
                <p className="text-[11px] text-[var(--vex-text-3)]">No open positions.</p>
              ) : (
                <HyperliquidPositionsBlock sessionId={sessionId} />
              )
            ) : active === "balances" ? (
              <BalancesPane account={account} sessionId={sessionId} />
            ) : active === "portfolio" ? (
              <PortfolioPane sessionId={sessionId} />
            ) : (
              <AskVexEmpty
                caption={REGISTER_ASKS[active].caption}
                ask={REGISTER_ASKS[active].ask}
                sessionId={sessionId}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
