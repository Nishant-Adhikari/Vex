/**
 * Slash command discriminated unions (puzzle 04 phase 7).
 *
 * The parser maps a free-text composer string into a typed
 * `SlashCommand`; the dispatch hook maps each `SlashCommand` into the
 * matching `useMissionXxx` mutation. Engine validates again at the
 * IPC boundary — these types are the renderer-side contract.
 *
 * Commands `/restore`, `/rewind`, `/mission-renew` are destructive
 * (or lineage-altering) and trigger the confirmation dialog before
 * dispatch. Everything else (`/mission start|continue|recover|stop`,
 * `/retry`, `/mission edit`) dispatches immediately.
 */

/** Recognised slash command shapes after parsing. */
export type SlashCommand =
  | { readonly kind: "mission-start" }
  | { readonly kind: "mission-continue" }
  | { readonly kind: "mission-recover" }
  | { readonly kind: "mission-stop" }
  | { readonly kind: "retry" }
  | { readonly kind: "rewind"; readonly turns: number }
  | { readonly kind: "restore" }
  | { readonly kind: "mission-renew" }
  | { readonly kind: "mission-edit" };

/**
 * Parser output. `not-a-command` is the common case (plain chat
 * message); `unknown` / `invalid` give the composer a friendly reason
 * to surface; `ok` carries the recognised command + whether the
 * confirmation dialog must run before dispatch.
 */
export type ParseResult =
  | { readonly kind: "not-a-command" }
  | { readonly kind: "unknown"; readonly raw: string }
  | { readonly kind: "invalid"; readonly raw: string; readonly reason: string }
  | {
      readonly kind: "ok";
      readonly command: SlashCommand;
      readonly requiresConfirm: boolean;
    };

/**
 * Dispatch outcome — what the composer surfaces back to the user.
 * `success` carries a friendly message; `error` carries the engine's
 * VexError message; `blocked` is a renderer-side pre-flight
 * (missing renewable source, gated runtime state, etc.).
 */
export type DispatchOutcome =
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "blocked"; readonly message: string };

/**
 * Human-readable label per command kind. Used in the confirmation
 * dialog title + button copy so the dialog stays generic + we control
 * the wording in one place.
 */
export const SLASH_COMMAND_LABEL: Readonly<Record<SlashCommand["kind"], string>> = {
  "mission-start": "Start mission",
  "mission-continue": "Continue mission",
  "mission-recover": "Recover mission",
  "mission-stop": "Stop mission",
  retry: "Retry",
  rewind: "Rewind transcript",
  restore: "Restore transcript",
  "mission-renew": "Renew mission",
  "mission-edit": "Edit mission draft",
};
