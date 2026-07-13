/**
 * Touch ID unlock toggle (opt-in, macOS). Rendered in the keystore step's
 * already-configured branch — the user reaches it via Settings while the vault
 * is unlocked, so enrolment can capture the in-memory master password.
 *
 * Enabling is gated behind an explicit "I understand" that spells out the
 * tradeoff (the password is stored encrypted on disk, released by an app-level
 * fingerprint prompt — a convenience, not hardware-enforced security).
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { Button } from "../../../../components/ui/button.js";

interface TouchIdStatus {
  readonly supported: boolean;
  readonly enabled: boolean;
}

export function TouchIdSetting(): JSX.Element | null {
  const [status, setStatus] = useState<TouchIdStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    // Defensive: if the secrets bridge isn't present (e.g. an isolated render),
    // stay null and render nothing rather than throwing an unhandled rejection.
    const bridge = window.vex?.secrets;
    if (!bridge?.touchIdStatus) return;
    const r = await bridge.touchIdStatus();
    if (r.ok) setStatus(r.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.vex.secrets.touchIdEnable();
      if (r.ok && r.data.enabled) {
        setConfirming(false);
        await refresh();
      } else {
        const reason = r.ok ? r.data.reason : undefined;
        setError(
          reason === "locked"
            ? "Unlock the vault first, then enable Touch ID."
            : reason === "unsupported"
              ? "Touch ID isn't available on this Mac."
              : "Couldn't enable Touch ID.",
        );
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const disable = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await window.vex.secrets.touchIdDisable();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (status === null) return null;
  if (!status.supported) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Touch ID unlock isn&apos;t available on this Mac.
      </p>
    );
  }

  if (status.enabled) {
    return (
      <div className="flex flex-col gap-2" data-vex-touchid-setting="enabled">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Touch ID unlock is <strong>on</strong> — your fingerprint unlocks the vault.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void disable()}
          className="self-start"
        >
          {busy ? "Turning off…" : "Turn off Touch ID"}
        </Button>
        {error ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-vex-touchid-setting="disabled">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Unlock with Touch ID instead of typing your master password.
      </p>
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border border-[color-mix(in_oklab,var(--color-warning)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_8%,transparent)] p-3">
          <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            This stores your master password on this Mac (encrypted, released by
            your fingerprint). It&apos;s a convenience, not hardware-enforced
            security: anyone who can pass Touch ID on your unlocked Mac could
            unlock Vex, and it does not protect against software running as your
            macOS user. It also ends the &ldquo;password never on disk&rdquo;
            guarantee. Off is the default.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void enable()}>
              {busy ? "Enabling…" : "I understand — enable"}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)} className="self-start">
          Enable Touch ID unlock
        </Button>
      )}
      {error ? (
        <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
