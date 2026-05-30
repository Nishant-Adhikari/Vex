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
  ToolCallDisplay,
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
  /**
   * Tool rows only. `"call"` → `content` is assistant prose and `toolCalls`
   * carries the per-call param disclosures; `"result"` → `content` is the
   * tool output and `label` is `<toolName>_output`. Undefined elsewhere.
   */
  readonly toolKind?: "call" | "result";
  /** Tool CALL rows: one disclosure per executed tool in the batch. */
  readonly toolCalls?: readonly ToolCallDisplay[];
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

/**
 * Map a whole transcript page to row models. A single pass first indexes every
 * tool call's `toolCallId → toolName` so each `tool_result` row can be labeled
 * `<toolName>_output` even though the result row itself carries no tool name
 * (the engine writes only `toolCallId` on result rows). Falls back to "tool"
 * when a result can't be correlated (e.g. its call scrolled out of the page).
 */
export function toTranscriptRows(
  dtos: readonly SessionMessageDto[],
): TranscriptRowModel[] {
  const nameByCallId = new Map<string, string>();
  for (const dto of dtos) {
    if (dto.toolCalls === null || dto.toolCalls === undefined) continue;
    for (const call of dto.toolCalls) {
      nameByCallId.set(call.toolCallId, call.toolName);
    }
  }
  return dtos.map((dto) => toTranscriptRow(dto, nameByCallId));
}

export function toTranscriptRow(
  dto: SessionMessageDto,
  nameByCallId?: ReadonlyMap<string, string>,
): TranscriptRowModel {
  const variant = resolveVariant(dto.role, dto.kind);
  if (variant === "tool") {
    if (dto.kind === "tool_result") {
      const correlated =
        dto.toolCallId !== null ? nameByCallId?.get(dto.toolCallId) : undefined;
      const name = correlated ?? dto.toolName ?? "tool";
      return {
        id: dto.id,
        variant,
        toolKind: "result",
        label: `${name}_output`,
        content: dto.content,
      };
    }
    // tool_call row: prose (content) + one disclosure per executed tool.
    return {
      id: dto.id,
      variant,
      toolKind: "call",
      label: dto.toolName,
      content: dto.content,
      toolCalls: dto.toolCalls ?? [],
    };
  }
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
