/**
 * Truncated address with copy-to-clipboard button (M8).
 *
 * Truncation: `0x1234…abcd` (6 chars from start, 4 from end). Short
 * enough to scan visually, long enough to disambiguate at a glance.
 * Copy uses `navigator.clipboard.writeText`; visual checkmark feedback
 * for 1.5s. No Toast primitive needed for M8.
 *
 * Accessibility:
 *  - Address is rendered in a `<code>` so screen readers announce it
 *    character-by-character.
 *  - Copy button uses `aria-label` that flips between "Copy address"
 *    and "Address copied" so AT users know the action result.
 */

import { useEffect, useRef, useState, type JSX } from "react";
import { cn } from "../../lib/utils.js";

export interface AddressDisplayProps {
  readonly address: string;
  readonly className?: string;
  readonly truncate?: boolean;
}

const COPY_FEEDBACK_MS = 1500;
const PREFIX_LEN = 6;
const SUFFIX_LEN = 4;

function truncateAddress(address: string): string {
  if (address.length <= PREFIX_LEN + SUFFIX_LEN + 1) return address;
  return `${address.slice(0, PREFIX_LEN)}…${address.slice(-SUFFIX_LEN)}`;
}

export function AddressDisplay({
  address,
  className,
  truncate = true,
}: AddressDisplayProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(
        () => setCopied(false),
        COPY_FEEDBACK_MS
      );
    } catch {
      // Clipboard API may be unavailable in some Electron contexts;
      // fail silently rather than spam the user with an error.
    }
  };

  const displayed = truncate ? truncateAddress(address) : address;

  return (
    <div
      className={cn(
        // Hairline chip — luminance step + hairline (landing ink grammar).
        "inline-flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1",
        className
      )}
    >
      <code
        className="font-mono text-sm text-foreground"
        title={truncate ? address : undefined}
      >
        {displayed}
      </code>
      <button
        type="button"
        onClick={() => {
          void handleCopy();
        }}
        aria-label={copied ? "Address copied" : "Copy address"}
        className="rounded-sm px-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? "✓ copied" : "copy"}
      </button>
    </div>
  );
}
