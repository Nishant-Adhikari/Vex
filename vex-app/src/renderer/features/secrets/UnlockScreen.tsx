/**
 * UnlockScreen — master-password re-prompt shown when the vault is
 * configured but locked (typical cause: app restart after onboarding).
 *
 * PR9 redesign: brings the screen up to the onboarding-flow visual
 * identity used by intro / systemCheck / dockerBootstrap /
 * composeBootstrap / migrations / wizard. Same glass-chrome recipe:
 * full-bleed `/onboarding2.png` backdrop, gradient overlay, top-left
 * logo + "VEX UNLOCK" chip, top-right version chip, central glass
 * panel with header (accent icon + title + description) + body
 * (form with master password input + error/throttle + submit).
 *
 * Why inline (not extracted): every polished screen currently inlines
 * its own copy of `ShellBackdrop` + `TopChrome` + glass-panel chrome
 * (6 screens before this one — 7 after). Extracting an
 * <OnboardingShell> + <GlassPanel> primitive is a separate refactor
 * tracked outside this task; mixing it with the unlock upgrade would
 * widen the diff to 7 files and risk regressions in already-shipping
 * screens (skill §5 + Rule 7 — keep changes small and reversible).
 *
 * Functional logic (unchanged from the original Card-based version):
 *   - password ref is uncontrolled (skill §14 — secret never lands in
 *     observable React state),
 *   - PASSWORD_MIN_LENGTH client-side gate before IPC,
 *   - `secrets.unlock_throttled` surfaces an alert + 1s setInterval
 *     countdown; cleaned up on every state change,
 *   - on success the password input is cleared and `setCurrentView`
 *     routes back to `unlockReturnView` ("wizard" | "appShell").
 *
 * Test selectors preserved verbatim:
 *   - `data-vex-screen="unlock"` (root),
 *   - `data-vex-unlock-throttle="active"` (throttle alert),
 *   - `<label htmlFor="vex-unlock-password">Master password</label>`,
 *   - button text "Unlock" / "Unlocking…".
 */

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { useUiStore } from "../../stores/uiStore.js";
import { PASSWORD_MIN_LENGTH } from "@shared/schemas/secrets.js";
import { getErrorCopy } from "../../lib/errors/error-copy.js";

/**
 * Inline lock-icon SVG. `lucide-react` is not a vex-app dependency, so
 * we render the glyph directly — avoids pulling in a 200KB icon set
 * for a single screen. Tinted with the onboarding accent so it tracks
 * the rest of the chrome.
 */
function LockIcon(): JSX.Element {
  return (
    <svg
      aria-hidden
      className="h-5 w-5 text-[var(--vex-onboarding-accent)]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

interface ThrottleState {
  readonly message: string;
  readonly retryAtMs: number;
}

export function UnlockScreen(): JSX.Element {
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [throttle, setThrottle] = useState<ThrottleState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const returnView = useUiStore((s) => s.unlockReturnView);
  const setCurrentView = useUiStore((s) => s.setCurrentView);

  // Tick once a second while a throttle window is active so the countdown
  // re-renders. Cleared on every state change — no leaked intervals.
  useEffect(() => {
    if (throttle === null) return;
    if (throttle.retryAtMs <= Date.now()) {
      setThrottle(null);
      return;
    }
    const id = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= throttle.retryAtMs) {
        window.clearInterval(id);
        setThrottle(null);
      }
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [throttle]);

  const throttleRemainingMs =
    throttle !== null ? Math.max(0, throttle.retryAtMs - now) : 0;
  const throttleRemainingSeconds = Math.ceil(throttleRemainingMs / 1000);
  const throttleActive = throttle !== null && throttleRemainingMs > 0;
  const inputsDisabled = pending || throttleActive;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (throttleActive) return;
    const password = passwordRef.current?.value ?? "";
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await window.vex.secrets.unlock({ password });
      if (!result.ok) {
        if (
          result.error.code === "secrets.unlock_throttled"
          && typeof result.error.retryAfterMs === "number"
          && result.error.retryAfterMs >= 0
        ) {
          // Workflow-specific UX (countdown banner) — message comes
          // from the shared copy helper so the wording stays
          // consistent with other throttle surfaces (export,
          // polymarket).
          const copy = getErrorCopy(result.error);
          setThrottle({
            message: copy.message,
            retryAtMs: Date.now() + result.error.retryAfterMs,
          });
          setNow(Date.now());
          setError(null);
          return;
        }
        setError(getErrorCopy(result.error).message);
        return;
      }
      if (passwordRef.current) passwordRef.current.value = "";
      setCurrentView(returnView);
    } finally {
      setPending(false);
    }
  }

  return (
    <main
      data-vex-onboarding="true"
      data-vex-screen="unlock"
      className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[var(--vex-onboarding-bg)] px-6 py-24 text-[var(--color-text-primary)]"
    >
      {/* TOP CHROME — hallmark + VEX wordmark + "UNLOCK" tag (left);
        shared corner chrome (tetrad + version) at the bottom, matching
        every other Countersign/NOTARY page. Pointer-events-none so the
        panel keeps the focus surface to itself. */}
      <div className="pointer-events-none absolute left-6 top-6 z-10 flex items-center gap-3">
        <img
          src="/logo_clean.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-9 w-9 object-contain opacity-90"
        />
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-sm font-semibold tracking-[0.3em] text-[var(--color-text-primary)]">
            VEX
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
            Unlock
          </span>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-7 left-10 z-10">
        <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-[var(--color-text-muted)] opacity-60">
          Clarity · Focus · Understand · Evolve
        </span>
      </div>
      <span className="pointer-events-none absolute bottom-7 right-10 z-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)] opacity-60">
        v{__VEX_APP_VERSION__}
      </span>

      {/* DOCUMENT PANEL — NOTARY material: hairline-bounded sheet one
        tonal step above the canvas. No glass, no photo. */}
      <section
        aria-labelledby="vex-unlock-title"
        className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]"
      >
        <header className="flex items-start gap-3 border-b border-white/[0.06] px-6 py-5">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center"
          >
            <LockIcon />
          </span>
          <div className="flex flex-col gap-1.5">
            <h1
              id="vex-unlock-title"
              className="font-mono text-[13px] font-medium uppercase tracking-[0.3em] text-[var(--color-text-primary)]"
            >
              Unlock Vex
            </h1>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Enter your master password to decrypt the local vault and
              continue.
            </p>
          </div>
        </header>

        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          className="flex flex-col gap-4 px-6 py-5"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="vex-unlock-password">Master password</Label>
            <Input
              id="vex-unlock-password"
              ref={passwordRef}
              type="password"
              autoComplete="current-password"
              autoFocus
              disabled={inputsDisabled}
            />
          </div>
          {throttleActive ? (
            <p
              className="text-sm text-[var(--color-danger)]"
              role="alert"
              data-vex-unlock-throttle="active"
            >
              {throttle.message} ({throttleRemainingSeconds}s)
            </p>
          ) : error ? (
            <p
              className="text-sm text-[var(--color-danger)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={inputsDisabled}>
            {pending ? "Unlocking…" : "Unlock"}
          </Button>
        </form>
      </section>
    </main>
  );
}
