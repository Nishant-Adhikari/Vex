/**
 * shadcn-pattern Input primitive — owned source per skill §2.
 * Pure CSS, no Radix. Uses semantic Tailwind tokens (border-input,
 * bg-background, ring-ring) so the Vex paletka tokens defined in
 * `globals.css` flow through automatically.
 *
 * Forwarded ref is the plumbing the wizard's password fields need
 * (uncontrolled `<input type="password">` with React Hook Form's
 * `register("field").ref`, post-submit `inputRef.current.value = ""`).
 */

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        // Landing .wl-form input grammar: transparent field, hairline border,
        // focus lights the border with the accent (no shadow depth).
        "flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-[var(--color-ring)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
