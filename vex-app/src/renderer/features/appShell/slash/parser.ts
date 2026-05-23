/**
 * Slash command parser (puzzle 04 phase 7).
 *
 * Pure function: input string → discriminated `ParseResult`. The
 * composer owns side effects (dispatch, dialog, notice); the parser
 * only classifies + validates inputs.
 *
 * Recognised commands:
 *   - `/mission start|continue|recover|stop`
 *   - `/mission edit`        (recognised but fail-closed downstream)
 *   - `/mission-renew`
 *   - `/retry`               (alias for /mission continue)
 *   - `/rewind <N>`          (N integer 1..50, matches engine schema)
 *   - `/restore`
 *
 * Confirmation gate (`requiresConfirm: true`):
 *   - `/rewind`              (archives transcript suffix)
 *   - `/restore`             (mutates live transcript by re-injecting)
 *   - `/mission-renew`       (creates a new mission row; lineage)
 *
 * Inputs the parser explicitly rejects:
 *   - `/rewind`              (missing N)
 *   - `/rewind <NaN>`        (e.g. `/rewind abc`)
 *   - `/rewind 0` / `/rewind 51`  (engine schema is 1..50 strict)
 *   - `/mission stop <text>` (engine schema has no `reason` field —
 *     codex phase 7 review #2)
 *   - everything else with a `/` prefix that doesn't match the table
 */

import type { ParseResult, SlashCommand } from "./types.js";

const REWIND_MIN = 1;
const REWIND_MAX = 50;

interface OkCommand {
  readonly command: SlashCommand;
  readonly requiresConfirm: boolean;
}

function ok(
  command: SlashCommand,
  options: { readonly confirm?: boolean } = {},
): OkCommand {
  return { command, requiresConfirm: options.confirm === true };
}

/**
 * Classify a composer input. Returns a discriminated union so the
 * composer can route via exhaustive switch — no fallthrough.
 */
export function parseSlashCommand(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed[0] !== "/") {
    return { kind: "not-a-command" };
  }

  // Strip the leading `/` and split on whitespace. `args` is the tail
  // after the verb — caller-aware: `/mission` two-word verbs consume
  // args[0], single-word verbs reject args.length > 0.
  const body = trimmed.slice(1).trim();
  if (body.length === 0) {
    return { kind: "invalid", raw: trimmed, reason: "Empty command." };
  }
  const parts = body.split(/\s+/);
  const head = parts[0]?.toLowerCase() ?? "";
  const args = parts.slice(1);

  const resolved = resolveCommand(head, args);
  if (resolved.kind === "ok") {
    return {
      kind: "ok",
      command: resolved.command,
      requiresConfirm: resolved.requiresConfirm,
    };
  }
  return { ...resolved, raw: trimmed };
}

type Resolved =
  | { readonly kind: "ok"; readonly command: SlashCommand; readonly requiresConfirm: boolean }
  | { readonly kind: "unknown" }
  | { readonly kind: "invalid"; readonly reason: string };

function resolveCommand(head: string, args: readonly string[]): Resolved {
  switch (head) {
    case "retry":
      if (args.length > 0) {
        return { kind: "invalid", reason: "/retry takes no arguments." };
      }
      return { kind: "ok", ...ok({ kind: "retry" }) };

    case "rewind":
      return resolveRewind(args);

    case "restore":
      if (args.length > 0) {
        return { kind: "invalid", reason: "/restore takes no arguments." };
      }
      return { kind: "ok", ...ok({ kind: "restore" }, { confirm: true }) };

    case "mission-renew":
      if (args.length > 0) {
        return {
          kind: "invalid",
          reason: "/mission-renew takes no arguments.",
        };
      }
      return { kind: "ok", ...ok({ kind: "mission-renew" }, { confirm: true }) };

    case "mission":
      return resolveMission(args);

    default:
      return { kind: "unknown" };
  }
}

function resolveRewind(args: readonly string[]): Resolved {
  if (args.length === 0) {
    return {
      kind: "invalid",
      reason: `Enter /rewind <N> where N is ${REWIND_MIN}..${REWIND_MAX}.`,
    };
  }
  if (args.length > 1) {
    return {
      kind: "invalid",
      reason: "/rewind takes exactly one argument (N).",
    };
  }
  const raw = args[0] ?? "";
  // Strict integer parse — no `parseInt` radix surprises, no decimals,
  // no leading `+` / negative.
  if (!/^\d+$/.test(raw)) {
    return {
      kind: "invalid",
      reason: `Enter /rewind <N> where N is ${REWIND_MIN}..${REWIND_MAX}.`,
    };
  }
  const turns = Number(raw);
  if (turns < REWIND_MIN || turns > REWIND_MAX) {
    return {
      kind: "invalid",
      reason: `Enter /rewind <N> where N is ${REWIND_MIN}..${REWIND_MAX}.`,
    };
  }
  return { kind: "ok", ...ok({ kind: "rewind", turns }, { confirm: true }) };
}

function resolveMission(args: readonly string[]): Resolved {
  if (args.length === 0) {
    return {
      kind: "invalid",
      reason: "Enter /mission start|continue|recover|stop|edit.",
    };
  }
  const verb = args[0]?.toLowerCase();
  const rest = args.slice(1);
  switch (verb) {
    case "start":
      if (rest.length > 0) {
        return { kind: "invalid", reason: "/mission start takes no arguments." };
      }
      return { kind: "ok", ...ok({ kind: "mission-start" }) };
    case "continue":
      if (rest.length > 0) {
        return {
          kind: "invalid",
          reason: "/mission continue takes no arguments.",
        };
      }
      return { kind: "ok", ...ok({ kind: "mission-continue" }) };
    case "recover":
      if (rest.length > 0) {
        return {
          kind: "invalid",
          reason: "/mission recover takes no arguments.",
        };
      }
      return { kind: "ok", ...ok({ kind: "mission-recover" }) };
    case "stop":
      // Codex phase 7 review #2: schema has no `reason` field. Reject
      // extra args so the dispatcher never tries to send a payload
      // the shared schema doesn't accept.
      if (rest.length > 0) {
        return {
          kind: "invalid",
          reason: "/mission stop takes no arguments.",
        };
      }
      return { kind: "ok", ...ok({ kind: "mission-stop" }) };
    case "edit":
      if (rest.length > 0) {
        return { kind: "invalid", reason: "/mission edit takes no arguments." };
      }
      return { kind: "ok", ...ok({ kind: "mission-edit" }) };
    default:
      return { kind: "unknown" };
  }
}
