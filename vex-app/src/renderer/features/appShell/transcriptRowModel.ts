/**
 * Pure presentation model for one transcript row (stage 8-1).
 *
 * Maps the sanitized `SessionMessageDto` (role + kind) to a render variant the
 * `TranscriptMessage` component switches on. Kept pure + exhaustive so row
 * styling has one source of truth and a new `MessageKind`/`MessageRole` fails
 * the build until it is handled here. No JSX, no hooks — trivially testable.
 *
 * `content` is passed through verbatim; the renderer prints it as a React text
 * node (never HTML). Rich markdown rendering is a later, dedicated slice.
 */

import type {
  MessageKind,
  MessageRole,
  SessionMessageDto,
} from "@shared/schemas/messages.js";

/** How a row is laid out + styled. */
export type TranscriptRowVariant =
  | "user" // right-aligned operator prompt
  | "assistant" // left, Vex avatar
  | "assistant_stopped" // assistant bubble + "Stopped" badge (9-5b)
  | "tool" // compact mono tool call/result
  | "notice" // centered muted system/runtime/error line
  | "compaction" // centered static "conversation compacted" marker (8-4)
  | "recall"; // static memory/knowledge recall indicator (8-4)

export interface TranscriptRowModel {
  readonly id: number;
  readonly variant: TranscriptRowVariant;
  /** Short tag for compact rows (tool name); `null` for prose bubbles. */
  readonly label: string | null;
  readonly content: string;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled transcript discriminant: ${String(value)}`);
}

function resolveTextVariant(role: MessageRole): TranscriptRowVariant {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "tool":
      return "tool";
    case "system":
      return "notice";
    default:
      return assertNever(role);
  }
}

/**
 * Resolve the row variant. `kind` is the primary signal (tool/notice rows
 * exist regardless of role); plain `text` rows fall back to role-based layout.
 */
function resolveVariant(
  role: MessageRole,
  kind: MessageKind,
): TranscriptRowVariant {
  switch (kind) {
    case "tool_call":
    case "tool_result":
      return "tool";
    case "runtime_notice":
    case "error":
      return "notice";
    case "compaction":
      return "compaction";
    case "recall":
      return "recall";
    case "assistant_stopped":
      return "assistant_stopped";
    case "text":
      return resolveTextVariant(role);
    default:
      return assertNever(kind);
  }
}

export function toTranscriptRow(dto: SessionMessageDto): TranscriptRowModel {
  const variant = resolveVariant(dto.role, dto.kind);
  return {
    id: dto.id,
    variant,
    label: resolveLabel(variant, dto.toolName),
    content: dto.content,
  };
}

/**
 * Compact rows carry a short tag. `tool` rows show the tool name (or a
 * generic fallback); `recall` rows carry the raw tool name so the marker can
 * pick accurate copy (memory vs knowledge); everything else has no label.
 */
function resolveLabel(
  variant: TranscriptRowVariant,
  toolName: string | null,
): string | null {
  if (variant === "tool") return toolName ?? "tool";
  if (variant === "recall") return toolName;
  return null;
}
