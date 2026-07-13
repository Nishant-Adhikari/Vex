/**
 * RISK SETUP panel (owner feature, fills the left column's empty band):
 * the user sets the session's trading limits directly in the UI — the agent
 * sees them in its prompt on the next turn and the protection gate enforces
 * them mechanically. No chat round-trip, same authority chain.
 *
 * Leverage bound is VENUE-FED: the stepper's ceiling is the highest live
 * maxLeverage across the markets universe, and the hint names the selected
 * market's own limit — the per-order clamp min(cap, assetMax) always applies
 * regardless of the session cap.
 *
 * The stop-loss requirement is a GLOBAL user control (not session-scoped by
 * design); disabling it routes through main's native confirmation.
 */

import { useEffect, useMemo, useState, type JSX } from "react";

import type { HyperliquidMarketDto } from "@shared/schemas/hyperliquid.js";
import {
  useHyperliquidMarkets,
  useHyperliquidPreferences,
  useHyperliquidSessionRiskPolicy,
  useSetHyperliquidSessionRiskPolicy,
} from "../../../lib/api/hyperliquid.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { hyperliquidKeys } from "../../../lib/api/queryKeys.js";
import { cn } from "../../../lib/utils.js";

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly suffix: string;
  readonly onChange: (next: number) => void;
}): JSX.Element {
  const clamp = (candidate: number): number => Math.min(max, Math.max(min, candidate));
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(clamp(value - step))}
          className="h-6 w-6 rounded-md border border-[var(--vex-line)] font-mono text-[12px] text-[var(--vex-text-2)] hover:border-[var(--vex-accent-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          −
        </button>
        <span className="min-w-[52px] text-center font-mono text-[12px] font-semibold tabular-nums text-[var(--vex-text)]">
          {value}
          {suffix}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(clamp(value + step))}
          className="h-6 w-6 rounded-md border border-[var(--vex-line)] font-mono text-[12px] text-[var(--vex-text-2)] hover:border-[var(--vex-accent-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          +
        </button>
      </div>
    </div>
  );
}

function universeMaxLeverage(markets: readonly HyperliquidMarketDto[] | null): number {
  if (markets === null || markets.length === 0) return 50;
  return markets.reduce((max, market) => Math.max(max, market.maxLeverage), 1);
}

export function HypervexingRiskSetup({
  sessionId,
  selectedCoin,
}: {
  readonly sessionId: string | null;
  readonly selectedCoin: string;
}): JSX.Element | null {
  const active = useHyperliquidSessionRiskPolicy(sessionId);
  const setPolicy = useSetHyperliquidSessionRiskPolicy();
  const marketsQuery = useHyperliquidMarkets(sessionId);
  const markets = marketsQuery.data?.ok ? marketsQuery.data.data : null;
  const preferences = useHyperliquidPreferences();
  const queryClient = useQueryClient();

  const [leverage, setLeverage] = useState(3);
  const [perOrder, setPerOrder] = useState(20);
  const [total, setTotal] = useState(100);
  const [dirty, setDirty] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const activePolicy = active.data?.ok ? active.data.data : null;
  // Seed the controls from the ACTIVE policy whenever it changes and the user
  // has no unsaved edits — a fresh agent proposal must not clobber typing.
  useEffect(() => {
    if (activePolicy === null || dirty) return;
    setLeverage(activePolicy.policy.leverageCapDefault);
    setPerOrder(activePolicy.policy.perOrderNotionalPct);
    setTotal(activePolicy.policy.totalNotionalPct);
  }, [activePolicy, dirty]);

  const maxLeverage = useMemo(() => universeMaxLeverage(markets), [markets]);
  const selectedMarket = markets?.find((market) => market.coin === selectedCoin) ?? null;

  const requireStopLoss = preferences.data?.ok
    ? preferences.data.data.hyperliquid.policy.requireStopLoss
    : true;
  // Global SL toggle — loosening triggers main's NATIVE confirmation dialog;
  // the renderer only requests. Tightening back on is frictionless.
  const setStopLoss = useMutation({
    mutationFn: (next: boolean) =>
      window.vex.settings.setHyperliquidPolicy({ policy: { requireStopLoss: next } }),
    retry: false,
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData(hyperliquidKeys.preferences(), result);
      }
    },
  });

  if (sessionId === null) return null;

  const mark = (setter: (value: number) => void) => (value: number): void => {
    setDirty(true);
    setter(value);
  };
  const apply = (): void => {
    setPolicy.mutate(
      { sessionId, leverageCapDefault: leverage, perOrderNotionalPct: perOrder, totalNotionalPct: total },
      { onSuccess: (result) => { if (result.ok) setDirty(false); } },
    );
  };

  return (
    <div className="mx-3 mb-2 flex flex-col gap-2.5 rounded-lg bg-[var(--vex-surface-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
          Risk setup · session
        </p>
        <span className="flex items-center gap-2">
          {activePolicy !== null ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--vex-text-3)]">
              {activePolicy.source === "user"
                ? "set by you"
                : activePolicy.source === "proposal"
                  ? "agent proposal"
                  : "defaults"}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setHelpOpen((open) => !open)}
            aria-expanded={helpOpen}
            aria-label="What do these limits do?"
            className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[var(--vex-line-strong)] font-mono text-[9px] text-[var(--vex-text-3)] hover:border-[var(--vex-accent-border)] hover:text-[var(--vex-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            ?
          </button>
        </span>
      </div>

      {helpOpen ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-[var(--vex-surface-down)] p-2.5 text-[10px] leading-[1.55] text-[var(--vex-text-2)]">
          <p>
            These are YOUR hard limits for this session. The agent reads them
            in its instructions before every trade, and the system rejects
            anything above them — it cannot be talked past.
          </p>
          <p>
            <span className="text-[var(--vex-text)]">Leverage cap</span> — the
            most leverage any position may use. Each market also has its own
            venue maximum; the lower of the two always wins.
          </p>
          <p>
            <span className="text-[var(--vex-text)]">Per order</span> — the
            largest single order, as % of your account equity.{" "}
            <span className="text-[var(--vex-text)]">Total notional</span> —
            all open positions combined, as % of equity (over 100% means
            leveraged exposure overall).
          </p>
          <p>
            <span className="text-[var(--vex-text)]">Require stop-loss</span> —
            every position ships with a protective stop attached atomically.
            Turning it off applies to ALL sessions and asks for an extra
            system confirmation.
          </p>
          {/* The worked example (owner order: "ziomki nie skumają" without
           * numbers) — one concrete account walked through every control. */}
          <div className="rounded border border-[var(--vex-line)] p-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--vex-accent-text)]">
              Example — $1,000 account
            </p>
            <p className="mt-1">
              Per order 20% → the agent can open at most{" "}
              <span className="text-[var(--vex-text)]">$200</span> per trade.
              With a 3x cap that $200 controls up to{" "}
              <span className="text-[var(--vex-text)]">$600</span> of BTC.
              Total notional 100% → all positions together may control{" "}
              <span className="text-[var(--vex-text)]">$1,000</span> — asking
              for a second big trade past that gets rejected automatically.
            </p>
          </div>
          <p className="text-[var(--vex-text-3)]">
            "Set by you" beats an agent proposal; the agent can suggest new
            limits, but only your confirmation activates them.
          </p>
        </div>
      ) : null}

      <Stepper label="Leverage cap" value={leverage} min={1} max={maxLeverage} suffix="x" onChange={mark(setLeverage)} />
      <Stepper label="Per order" value={perOrder} min={1} max={50} step={1} suffix="%" onChange={mark(setPerOrder)} />
      <Stepper label="Total notional" value={total} min={10} max={200} step={10} suffix="%" onChange={mark(setTotal)} />

      <p className="text-[10px] leading-[1.5] text-[var(--vex-text-3)]">
        {selectedMarket !== null
          ? `${selectedMarket.coin} allows up to ${selectedMarket.maxLeverage}x — per-asset limits always clamp automatically.`
          : "Per-asset limits always clamp automatically."}
        {" "}The agent sees these caps in its instructions and the system blocks anything above them.
      </p>

      <label className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
          Require stop-loss
        </span>
        <input
          type="checkbox"
          checked={requireStopLoss}
          disabled={setStopLoss.isPending}
          onChange={(event) => setStopLoss.mutate(event.target.checked)}
          className="h-4 w-4 accent-[var(--vex-accent)]"
        />
      </label>

      <button
        type="button"
        onClick={apply}
        disabled={!dirty || setPolicy.isPending}
        className={cn(
          "rounded-md px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
          dirty
            ? "bg-[var(--vex-accent)] text-[var(--vex-accent-contrast)]"
            : "border border-[var(--vex-line)] text-[var(--vex-text-3)]",
        )}
      >
        {setPolicy.isPending ? "Applying…" : dirty ? "Apply limits" : "Limits active"}
      </button>
      {setPolicy.data?.ok === false ? (
        <p className="text-[10px] text-destructive">{setPolicy.data.error.message}</p>
      ) : null}
    </div>
  );
}
