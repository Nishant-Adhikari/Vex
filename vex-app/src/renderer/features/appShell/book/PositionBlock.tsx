/**
 * POSITION — the wallet portfolio block for the BOOK panel (stage 4).
 *
 * Dual-scope, driven purely by `activeSessionId`:
 *   - `null`     → GLOBAL inventory portfolio, titled "Portfolio".
 *   - non-null   → that session's wallet-scope portfolio, titled "Position".
 *
 * The renderer never supplies a wallet address; `usePortfolio` derives the
 * discriminated scope and main resolves the server-side allow-list. This
 * component only renders the resolved DTO.
 *
 * Surface shows: the live total USD (blue rationed to this one figure), the
 * most recent snapshot total + PnL when present, and the resolved wallet
 * COUNT. SESSION scope then renders the redesigned register — copy-ready
 * deposit addresses (DepositAddresses) + the per-chain holdings switcher
 * (PositionChains); GLOBAL (the welcome/empty state) delegates to
 * `GlobalWalletSwitcher` (WP-L2), which owns the wallet-identity
 * presentation (`GlobalWalletAddresses`) + the legacy flat top-holdings list
 * as the "All wallets" default, AND — when more than one wallet is
 * configured — a per-wallet chip switcher that swaps in the SAME
 * chain-grouped `PositionChains` presentation the session view uses, scoped
 * to just that one wallet. Loading / error / empty (no wallets) states are
 * boxless lines on the same register.
 *
 * The hero Total above `GlobalWalletSwitcher` (this component's `TotalRow`)
 * ALWAYS stays the full cross-wallet aggregate — selecting one wallet in the
 * switcher never changes it; the wallet-scoped body shows that wallet's own
 * total separately (session-style), per owner decision.
 *
 * `hero` = the BOOK column's single dominant section. The de-boxed column has
 * no tile chrome to strengthen, so hero presence lives in CONTENT: the total
 * figure scales up to the giant Archivo treatment (27px vs 22px).
 *
 * Signal Tape language: surface/hairline/text trio; blue ONLY on the live
 * total, semantic up/down on the PnL; `tabular-nums` on every figure.
 */

import type { JSX } from "react";
import type { PortfolioDto } from "@shared/schemas/portfolio.js";
import { usePortfolio } from "../../../lib/api/portfolio.js";
import { useSessionWallets } from "../../../lib/api/session-wallets.js";
import { formatUsd, formatUsdDelta } from "../../../lib/format.js";
import { BookBlock } from "./BookBlock.js";
import { DepositAddresses } from "./DepositAddresses.js";
import { GlobalWalletSwitcher } from "./GlobalWalletSwitcher.js";
import { PositionChains } from "./PositionChains.js";

export function PositionBlock({
  activeSessionId,
  hero = false,
}: {
  readonly activeSessionId: string | null;
  readonly hero?: boolean;
}): JSX.Element {
  const isSession = activeSessionId !== null;
  const title = isSession ? "Position" : "Portfolio";

  // GLOBAL Portfolio gets a per-wallet filter: `null` override = default
  // (Primary, the first configured wallet); "__all__" = every wallet; else a
  // specific address. The SESSION view is already wallet-scoped — no filter.
  const availableWallets = useAvailableWallets();
  const walletOptions: readonly { readonly label: string; readonly address: string }[] =
    availableWallets.data?.ok
      ? [...availableWallets.data.data.evm, ...availableWallets.data.data.solana]
      : [];
  const primaryAddress = walletOptions[0]?.address ?? null;
  const [override, setOverride] = useState<string | null>(null);
  const selected = override ?? primaryAddress;

  const input: PortfolioReadInput = isSession
    ? { scope: "session", sessionId: activeSessionId }
    : override === "__all__" || selected === null
      ? { scope: "global" }
      : { scope: "wallet", walletAddress: selected };

  const query = usePortfolioScoped(input);
  const result = query.data;
  const portfolio = result?.ok ? result.data : null;

  const filter =
    !isSession && walletOptions.length > 1 ? (
      <WalletFilter options={walletOptions} active={override} onSelect={setOverride} />
    ) : null;

  if (query.isLoading) {
    return (
      <BookBlock title={title}>
        {filter}
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
          Loading…
        </p>
      </BookBlock>
    );
  }

  if ((result !== undefined && !result.ok) || query.isError) {
    return (
      <BookBlock title={title}>
        {filter}
        <p className="text-[11px] text-[var(--vex-warn-text)]">
          Couldn&apos;t load your portfolio.
        </p>
      </BookBlock>
    );
  }

  if (portfolio === null || portfolio.walletCount === 0) {
    return (
      <BookBlock title={title}>
        {filter}
        <p className="text-[11px] text-[var(--vex-text-3)]">
          {isSession
            ? "No wallets in this session."
            : "No wallets configured."}
        </p>
      </BookBlock>
    );
  }

  return (
    <BookBlock
      title={title}
      trailing={`${portfolio.walletCount} ${
        portfolio.walletCount === 1 ? "wallet" : "wallets"
      }`}
    >
      {filter}
      {isSession && activeSessionId !== null ? (
        <SessionPositionBody
          portfolio={portfolio}
          sessionId={activeSessionId}
          hero={hero}
        />
      ) : (
        <PositionBody portfolio={portfolio} hero={hero} />
      )}
    </BookBlock>
  );
}

/**
 * Per-wallet pill row for the global Portfolio: "All" + one pill per configured
 * wallet. `active` is the raw override state — `null` means the default (Primary,
 * i.e. the first wallet), so the Primary pill carries `value: null` and matches.
 */
function WalletFilter({
  options,
  active,
  onSelect,
}: {
  readonly options: readonly { readonly label: string; readonly address: string }[];
  readonly active: string | null;
  readonly onSelect: (value: string | null) => void;
}): JSX.Element {
  const items: {
    readonly key: string;
    readonly label: string;
    readonly value: string | null;
  }[] = [
    { key: "__all__", label: "All", value: "__all__" },
    ...options.map((wallet, index) => ({
      key: wallet.address,
      label: wallet.label,
      value: index === 0 ? null : wallet.address,
    })),
  ];
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onSelect(item.value)}
          className={cn(
            "rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--vex-accent)]",
            item.value === active
              ? "bg-[var(--vex-accent-fill-12)] text-[var(--vex-accent-text)]"
              : "text-[var(--vex-text-3)] hover:bg-white/[0.04] hover:text-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Session-scope body — the redesigned register (owner request): the hero
 * total, the session's copy-ready deposit addresses, then the per-chain
 * holdings switcher (EVM default Ethereum + quick chains + "more" dialog,
 * Solana headed by its mark). The legacy flat token list stays GLOBAL-only.
 * `key={sessionId}` remounts the switcher per session so the selected chain
 * always resets to Ethereum.
 */
function SessionPositionBody({
  portfolio,
  sessionId,
  hero,
}: {
  readonly portfolio: PortfolioDto;
  readonly sessionId: string;
  readonly hero: boolean;
}): JSX.Element {
  const walletsQuery = useSessionWallets(sessionId);
  const scope = walletsQuery.data?.ok ? walletsQuery.data.data : null;
  return (
    <div className="flex flex-col gap-2.5">
      <TotalRow
        liveTotalUsd={portfolio.liveTotalUsd}
        snapshotTotalUsd={portfolio.snapshotTotalUsd}
        pnlVsPrev={portfolio.pnlVsPrev}
        hero={hero}
      />
      <DepositAddresses sessionId={sessionId} />
      <PositionChains
        key={sessionId}
        chains={portfolio.chains}
        hasEvmWallet={scope?.evm != null}
        hasSolanaWallet={scope?.solana != null}
      />
    </div>
  );
}

function PositionBody({
  portfolio,
  hero,
}: {
  readonly portfolio: PortfolioDto;
  readonly hero: boolean;
}): JSX.Element {
  const { liveTotalUsd, snapshotTotalUsd, pnlVsPrev } = portfolio;
  return (
    <div className="flex flex-col gap-2.5">
      <TotalRow
        liveTotalUsd={liveTotalUsd}
        snapshotTotalUsd={snapshotTotalUsd}
        pnlVsPrev={pnlVsPrev}
        hero={hero}
      />
      <GlobalWalletSwitcher portfolio={portfolio} />
    </div>
  );
}

function TotalRow({
  liveTotalUsd,
  snapshotTotalUsd,
  pnlVsPrev,
  hero,
}: {
  readonly liveTotalUsd: number;
  readonly snapshotTotalUsd: number | null;
  readonly pnlVsPrev: number | null;
  readonly hero: boolean;
}): JSX.Element {
  // Blue is rationed to the single live-total figure — the one number the
  // panel is built around. Everything else stays on the muted text trio.
  // Hero = the landing display treatment: giant Archivo 800, tight-tracked.
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        Total
      </span>
      <span
        className={`font-display font-extrabold leading-[1.05] tracking-[-0.02em] tabular-nums text-[var(--vex-accent-text)] ${
          hero ? "text-[27px]" : "text-[22px]"
        }`}
      >
        {formatUsd(liveTotalUsd)}
      </span>
      {snapshotTotalUsd !== null ? (
        <span className="flex items-baseline gap-1.5 text-[11px] text-[var(--vex-text-3)]">
          <span className="tabular-nums">
            snapshot {formatUsd(snapshotTotalUsd)}
          </span>
          {pnlVsPrev !== null ? (
            <span
              className={`tabular-nums ${pnlToneClass(pnlVsPrev)}`}
              aria-label={`Profit and loss versus previous snapshot ${formatUsdDelta(pnlVsPrev)}`}
            >
              {formatUsdDelta(pnlVsPrev)}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** Up = success, down = warn, flat/zero = muted. No glow, token colours only. */
function pnlToneClass(pnl: number): string {
  if (pnl > 0) return "text-[var(--color-success)]";
  if (pnl < 0) return "text-[var(--vex-warn-text)]";
  return "text-[var(--vex-text-3)]";
}
