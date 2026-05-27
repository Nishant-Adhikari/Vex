/**
 * Native wallet `<select>` for the New-session modal (extracted from
 * `SessionCreator.tsx` to keep that file under the size budget). Optional
 * per-family wallet scope; "None" = chat-only for that chain.
 */

import type { JSX } from "react";
import { cn } from "../../lib/utils.js";

export interface WalletSelectOption {
  readonly id: string;
  readonly address: string;
  readonly label: string;
}

export function WalletSelect({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly options: ReadonlyArray<WalletSelectOption>;
  readonly onChange: (id: string | null) => void;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-secondary)]">
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className={cn(
          "h-9 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2 text-sm text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
        )}
      >
        <option value="">None</option>
        {options.map((w) => (
          <option key={w.id} value={w.id}>
            {w.label} ({w.address.slice(0, 6)}…{w.address.slice(-4)})
          </option>
        ))}
      </select>
    </label>
  );
}
