import { useCallback, useMemo, useState } from "react";
import type { FormEvent, JSX } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  AiChat01Icon,
  ArrowUp01Icon,
  BitcoinWalletIcon,
  BridgeIcon,
  BubbleChatSparkIcon,
  ChartCandlestickIcon,
  DatabaseLightningIcon,
  Exchange01Icon,
  Knowledge01Icon,
  Search01Icon,
  Shield02Icon,
  SparklesIcon,
  Target02Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { Ethereum } from "@thesvg/react";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";
import { cn } from "../../lib/utils.js";
import { useSession, useSessionsList } from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";

interface SessionPanelProps {
  readonly onCreate: () => void;
}

interface QuickAction {
  readonly label: string;
  readonly prompt: string;
  readonly icon: IconSvgElement;
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    label: "Swap",
    prompt: "Swap USDC to ETH with tight slippage and explain the route before execution.",
    icon: Exchange01Icon,
  },
  {
    label: "Bridge",
    prompt: "Bridge funds to Base and check fees before proposing the transaction.",
    icon: BridgeIcon,
  },
  {
    label: "Open position",
    prompt: "Open a small BTC perp position only after risk and liquidation checks.",
    icon: ChartCandlestickIcon,
  },
  {
    label: "Research token",
    prompt: "Research $TAO and summarize catalysts, liquidity, and on-chain risk.",
    icon: Search01Icon,
  },
  {
    label: "Portfolio check",
    prompt: "Check portfolio exposure across chains and flag urgent risks.",
    icon: BitcoinWalletIcon,
  },
  {
    label: "Save knowledge",
    prompt: "Save the current MEV protection notes into the local knowledge base.",
    icon: Knowledge01Icon,
  },
];

const TRUST_BADGES: ReadonlyArray<{
  readonly label: string;
  readonly icon: IconSvgElement;
}> = [
  { label: "Local-first", icon: DatabaseLightningIcon },
  { label: "Private by default", icon: Shield02Icon },
  { label: "You stay in control", icon: SparklesIcon },
];

export function SessionPanel({ onCreate }: SessionPanelProps): JSX.Element {
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const listQuery = useSessionsList();
  const detailQuery = useSession(activeSessionId);
  const [draft, setDraft] = useState<string>("");
  const [draftState, setDraftState] = useState<"idle" | "staged">("idle");

  const sessionsCount =
    listQuery.data && listQuery.data.ok ? listQuery.data.data.length : 0;

  const activeSession = useMemo((): SessionListItem | null => {
    if (activeSessionId === null) return null;
    if (!detailQuery.data?.ok) return null;
    return detailQuery.data.data;
  }, [activeSessionId, detailQuery.data]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (draft.trim().length === 0) return;
      setDraft("");
      setDraftState("staged");
    },
    [draft],
  );

  const applyQuickAction = useCallback((prompt: string): void => {
    setDraft(prompt);
    setDraftState("idle");
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full items-center px-8 py-10 sm:px-12 lg:px-20">
      <div className="w-full max-w-[780px]">
        <div className="mb-8 flex items-center gap-3 text-[#6f91ff]">
          <DotmHex3
            size={28}
            dotSize={4}
            color="#3275f8"
            ariaLabel="Vex runtime"
            bloom
            halo={0.45}
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8da5ff]">
            Welcome to Vex
          </span>
        </div>

        <h1 className="max-w-[680px] text-4xl font-semibold leading-[1.08] tracking-normal text-foreground sm:text-5xl">
          Your chain. Your rules.
          <span className="block text-[#4d72ff]">I execute.</span>
        </h1>

        <p className="mt-5 max-w-[520px] text-base leading-7 text-[var(--color-text-secondary)]">
          Vex is your local crypto runtime for autonomous on-chain
          execution. You decide the goal, I handle the execution.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          {TRUST_BADGES.map((badge) => (
            <span
              key={badge.label}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.035] px-2.5 text-xs text-[var(--color-text-secondary)]"
            >
              <HugeiconsIcon
                icon={badge.icon}
                size={15}
                aria-hidden
                className="text-[#6f91ff]"
              />
              {badge.label}
            </span>
          ))}
        </div>

        <SessionContext
          activeSession={activeSession}
          activeSessionId={activeSessionId}
          loading={activeSessionId !== null && detailQuery.isLoading}
          error={
            detailQuery.data && detailQuery.data.ok === false
              ? detailQuery.data.error.message
              : null
          }
          sessionsCount={sessionsCount}
          onCreate={onCreate}
        />

        <form
          onSubmit={onSubmit}
          className="mt-6 overflow-hidden rounded-xl border border-[#3275f8]/38 bg-[#061026]/66 shadow-[0_0_54px_rgba(30,78,210,0.16)] backdrop-blur-2xl"
        >
          <div className="relative">
            <textarea
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDraftState("idle");
              }}
              rows={5}
              placeholder="What do you want Vex to do?"
              aria-label="Session draft"
              className={cn(
                "min-h-[144px] w-full resize-none bg-transparent px-5 py-5 pr-14 text-base leading-7 text-foreground outline-none",
                "placeholder:text-[var(--color-text-muted)]",
              )}
            />
            <button
              type="button"
              aria-label="Expand composer"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-[var(--color-text-secondary)] transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]"
            >
              <HugeiconsIcon icon={BubbleChatSparkIcon} size={16} aria-hidden />
            </button>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/[0.07] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <span className="font-mono text-sm text-[#6f91ff]">/</span>
              <span className="truncate">for commands</span>
              {draftState === "staged" ? (
                <span
                  role="status"
                  className="ml-2 hidden text-[#8da5ff] sm:inline"
                >
                  Draft staged.
                </span>
              ) : null}
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <div className="hidden h-10 min-w-0 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 text-xs text-[var(--color-text-secondary)] sm:flex">
                <Ethereum width={16} height={16} aria-hidden focusable={false} />
                <span className="truncate">One wallet</span>
              </div>
              <button
                type="submit"
                disabled={draft.trim().length === 0}
                aria-label="Stage draft"
                className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg bg-[#3758ff] text-white shadow-[0_0_28px_rgba(55,88,255,0.36)] transition-colors hover:bg-[#4668ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8da5ff] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <HugeiconsIcon icon={ArrowUp01Icon} size={20} aria-hidden />
              </button>
            </div>
          </div>
        </form>

        {draftState === "staged" ? (
          <p role="status" className="mt-3 text-xs text-[#8da5ff] sm:hidden">
            Draft staged.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => applyQuickAction(action.prompt)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/[0.18] px-3 text-xs text-[var(--color-text-secondary)] backdrop-blur-xl transition-colors hover:border-[#3275f8]/32 hover:bg-[#3275f8]/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]"
            >
              <HugeiconsIcon icon={action.icon} size={15} aria-hidden />
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionContext({
  activeSession,
  activeSessionId,
  loading,
  error,
  sessionsCount,
  onCreate,
}: {
  readonly activeSession: SessionListItem | null;
  readonly activeSessionId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly sessionsCount: number;
  readonly onCreate: () => void;
}): JSX.Element {
  if (loading) {
    return (
      <div className="mt-7 inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-[var(--color-text-secondary)] backdrop-blur-xl">
        <DotmHex3 size={18} dotSize={3} color="#6f91ff" ariaLabel="Loading session" />
        Loading session
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="mt-7 rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive backdrop-blur-xl">
        {error}
      </div>
    );
  }

  if (activeSessionId !== null && activeSession === null) {
    return (
      <div className="mt-7 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-sm text-[var(--color-text-secondary)] backdrop-blur-xl">
        Session not found
      </div>
    );
  }

  if (activeSession !== null) {
    const Icon = activeSession.mode === "mission" ? Target02Icon : AiChat01Icon;
    const title =
      activeSession.initialGoal !== null && activeSession.initialGoal.trim().length > 0
        ? activeSession.initialGoal.trim()
        : activeSession.mode === "mission"
          ? "Mission setup"
          : "Agent session";
    return (
      <div className="mt-7 flex max-w-[620px] flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-[var(--color-text-secondary)] backdrop-blur-xl">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3275f8]/12 text-[#8da5ff]">
          <HugeiconsIcon icon={Icon} size={16} aria-hidden />
        </span>
        <span className="min-w-[180px] flex-1 truncate text-sm text-foreground">
          {title}
        </span>
        <ContextPill>{activeSession.mode}</ContextPill>
        <ContextPill>{activeSession.permission}</ContextPill>
        {activeSession.missionStatus !== null ? (
          <ContextPill>{activeSession.missionStatus}</ContextPill>
        ) : null}
      </div>
    );
  }

  if (sessionsCount > 0) return <div className="mt-7 h-0" aria-hidden />;

  return (
    <button
      type="button"
      onClick={onCreate}
      className="mt-7 inline-flex h-10 items-center gap-2 rounded-lg border border-[#3275f8]/35 bg-[#3275f8]/10 px-4 text-sm font-medium text-[#8da5ff] transition-colors hover:bg-[#3275f8]/16 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]"
    >
      <HugeiconsIcon icon={Wallet01Icon} size={16} aria-hidden />
      New session
    </button>
  );
}

function ContextPill({ children }: { readonly children: string }): JSX.Element {
  return (
    <span className="rounded-md bg-white/[0.06] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
      {children}
    </span>
  );
}
