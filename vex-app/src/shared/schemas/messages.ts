/**
 * Messages schemas — paginated transcript reads for the chat panel.
 *
 * Renderer never receives raw DB JSONB. The main-side mapper in
 * `vex-app/src/main/database/messages-db.ts` is the single place where
 * `tool_calls` / `metadata` get reduced to allow-listed, type-safe DTO
 * fields. Field names match the canonical refs vocabulary in
 * `BUG-REPORTING.md §3` so Phase 2 BugReportSink can stamp refs without
 * a mapper (`sessionId`, `toolCallId`, `toolName`).
 *
 * Live-only by default. Archive rows are reachable later through the
 * restore/history flow that lands in puzzle 04.
 */

import { z } from "zod";

export const MESSAGES_TAIL_DEFAULT_LIMIT = 50;
export const MESSAGES_TAIL_MAX_LIMIT = 100;
export const MESSAGES_AROUND_DEFAULT_WINDOW = 10;
export const MESSAGES_AROUND_MAX_WINDOW = 50;

export const messageRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "tool",
]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

/**
 * Renderer-visible message kind. Discriminator derived in the mapper
 * from `role` + `tool_calls`. Engine markers (compaction, memory,
 * mission contract notices) land in puzzle 02/04/07 — they widen this
 * enum then; today we keep the surface minimal so the type only carries
 * what the puzzle 1 mapper can actually emit.
 */
export const messageKindSchema = z.enum([
  "text",
  "tool_call",
  "tool_result",
  "runtime_notice",
  "error",
]);
export type MessageKind = z.infer<typeof messageKindSchema>;

/**
 * Stable cursor for forward/backward pagination over live messages.
 * Encoded as `(createdAt ISO, id)` so order is total even when two
 * messages share `created_at` (collisions are rare but possible under
 * batched writes; the SERIAL `id` is the tiebreaker).
 */
export const messageCursorSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: z.number().int().positive(),
  })
  .strict();
export type MessageCursor = z.infer<typeof messageCursorSchema>;

/**
 * Renderer-visible message DTO. `metadata` from `messages.metadata`
 * JSONB is deliberately absent — engine markers come back in puzzle 02
 * once the controlled metadata DTO union exists. Until then the mapper
 * collapses `runtime_notice`-shaped rows into `kind: "runtime_notice"`
 * with `content` carrying the user-visible banner only.
 */
export const sessionMessageDtoSchema = z
  .object({
    id: z.number().int().positive(),
    sessionId: z.string().uuid(),
    role: messageRoleSchema,
    kind: messageKindSchema,
    content: z.string(),
    createdAt: z.string().datetime({ offset: true }),
    /** From `messages.tool_call_id` — present on assistant→tool replies. */
    toolCallId: z.string().nullable(),
    /**
     * Best-effort tool identifier extracted from `messages.tool_calls`
     * (first entry's `namespace:command` when both are strings, else
     * `command`, else `name`, else `"unknown"`). Refined when tool
     * registry metadata is wired in puzzle 05.
     */
    toolName: z.string().nullable(),
  })
  .strict();
export type SessionMessageDto = z.infer<typeof sessionMessageDtoSchema>;

export const messagePageSchema = z
  .object({
    items: z.array(sessionMessageDtoSchema),
    /** Cursor for the next older page; `null` when no more live history. */
    nextCursor: messageCursorSchema.nullable(),
    hasMore: z.boolean(),
  })
  .strict();
export type MessagePage = z.infer<typeof messagePageSchema>;

export const messagesGetTailInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MESSAGES_TAIL_MAX_LIMIT)
      .default(MESSAGES_TAIL_DEFAULT_LIMIT),
  })
  .strict();
export type MessagesGetTailInput = z.infer<typeof messagesGetTailInputSchema>;

export const messagesListInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    /**
     * Cursor returned by a previous `getTail`/`list`. When omitted the
     * handler returns the same tail page that `getTail` would.
     */
    cursor: messageCursorSchema.nullable().default(null),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MESSAGES_TAIL_MAX_LIMIT)
      .default(MESSAGES_TAIL_DEFAULT_LIMIT),
  })
  .strict();
export type MessagesListInput = z.infer<typeof messagesListInputSchema>;

export const messagesGetAroundInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    messageId: z.number().int().positive(),
    before: z
      .number()
      .int()
      .min(0)
      .max(MESSAGES_AROUND_MAX_WINDOW)
      .default(MESSAGES_AROUND_DEFAULT_WINDOW),
    after: z
      .number()
      .int()
      .min(0)
      .max(MESSAGES_AROUND_MAX_WINDOW)
      .default(MESSAGES_AROUND_DEFAULT_WINDOW),
  })
  .strict();
export type MessagesGetAroundInput = z.infer<
  typeof messagesGetAroundInputSchema
>;
