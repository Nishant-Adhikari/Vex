/**
 * Messages DB helper for the agent integration chat panel.
 *
 * Mirrors the `sessions-db.ts` decoupling pattern: `vex-app` owns its
 * own `pg.Client` per call and never imports `@vex-agent/db/repos/*`,
 * keeping the GUI build's module graph disjoint from the engine.
 *
 * SQL is the contract here. The base Vex Agent migrations create
 * (selected for this helper):
 *
 *   messages(
 *     id SERIAL PK,
 *     session_id TEXT REFERENCES sessions ON DELETE CASCADE,
 *     role, content,
 *     tool_call_id, tool_calls JSONB,
 *     created_at,
 *     -- migration 002 additions:
 *     source, message_type, visibility, origin_session_id, subagent_id,
 *     metadata JSONB
 *   )
 *
 * The renderer receives an allow-listed `SessionMessageDto`. The
 * mapper here is the *only* place where `tool_calls` / `metadata`
 * JSONB get reduced:
 *   - `toolName` = best-effort `namespace:command` extraction (string
 *     fields only; rejects nested objects so a malicious blob can't
 *     leak through).
 *   - `metadata` is dropped entirely until puzzle 02 introduces the
 *     controlled metadata DTO union. The mapper still inspects
 *     `metadata.message_type` to derive the renderer-visible `kind`
 *     ("runtime_notice"), but never forwards the JSONB.
 */

import { Client, type ClientConfig } from "pg";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  MESSAGES_TAIL_DEFAULT_LIMIT,
  messageCursorSchema,
  type MessageCursor,
  type MessageKind,
  type MessageRole,
  type MessagePage,
  type SessionMessageDto,
  type ToolCallDisplay,
} from "@shared/schemas/messages.js";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

// `correlationId` is intentionally omitted from these error literals.
// `registerHandler` stamps `ctx.requestId` downstream when the field is
// absent; an empty-string `correlationId` would be rejected by
// `isValidVexErrorShape` (length === 0) and downgrade the public error
// to `internal.contract_violation`. Mirror the `sessions-db.ts` pattern.
function dbUnavailable(): Result<never, VexError> {
  return err({
    code: "internal.unexpected",
    domain: "messages",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
  });
}

function dbError(reason: string, cause?: unknown): Result<never, VexError> {
  log.warn(`[messages-db] ${reason}`, cause);
  return err({
    code: "internal.unexpected",
    domain: "messages",
    message: "Unable to load messages.",
    retryable: true,
    userActionable: false,
    redacted: true,
  });
}

async function withClient<T>(
  fn: (client: Client) => Promise<Result<T, VexError>>,
): Promise<Result<T, VexError>> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[messages-db] buildPoolConfig threw", cause);
    return dbUnavailable();
  }
  if (cfg === null) return dbUnavailable();

  const clientConfig: ClientConfig = {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  };
  const client = new Client(clientConfig);
  try {
    await client.connect();
  } catch (cause) {
    log.warn("[messages-db] client.connect failed", cause);
    return dbUnavailable();
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[messages-db] client.end failed (non-fatal)", cause);
    }
  }
}

interface MessageRow {
  readonly id: number;
  readonly session_id: string;
  readonly role: string;
  readonly content: string | null;
  readonly tool_call_id: string | null;
  readonly tool_calls: unknown;
  readonly created_at: string | Date;
  readonly source: string | null;
  readonly message_type: string | null;
}

// `metadata` JSONB is deliberately NOT in the SELECT list. Puzzle 1
// holds the strict "metadata completely omitted" decision — the
// controlled metadata DTO union arrives in puzzle 02 (event spine +
// transcript markers). Until then, the only discriminator we read is
// the top-level `message_type` column (added in migration 002), which
// is the engine's authoritative source for marker rows.
const MESSAGE_ROW_COLUMNS =
  "id, session_id, role, content, tool_call_id, tool_calls, created_at, source, message_type";

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normaliseRole(raw: string): MessageRole {
  if (raw === "user" || raw === "assistant" || raw === "tool") return raw;
  return "system";
}

/**
 * Best-effort tool identifier extraction from `messages.tool_calls`
 * JSONB. Allow-listed: only string-typed fields ever feed back into the
 * DTO. Anything else (numbers, arrays, nested objects) is treated as
 * absent so a malicious payload can't smuggle data past the boundary.
 *
 * Preference order: `namespace:command` (when both are strings) →
 * `command` → `name` → `null`.
 */
function extractToolName(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  if (first === null || typeof first !== "object") return null;
  const rec = first as Record<string, unknown>;
  const ns = typeof rec["namespace"] === "string" ? rec["namespace"] : null;
  const cmd = typeof rec["command"] === "string" ? rec["command"] : null;
  if (ns !== null && cmd !== null) return `${ns}:${cmd}`;
  if (cmd !== null) return cmd;
  const name = typeof rec["name"] === "string" ? rec["name"] : null;
  return name;
}

function hasToolCalls(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length > 0;
}

// ── Tool-call args sanitization (renderer disclosure) ─────────────────
// The renderer reveals the params a tool was called with. Args can carry
// sensitive material, so this is the ONLY place they cross the boundary —
// and only as a redacted, size-capped JSON STRING (never raw JSONB). Two
// independent layers, defense in depth:
//   1. drop any key whose NAME indicates a secret (segment-aware so common
//      DeFi args like `tokenAddress` / `signer` are NOT false-dropped);
//   2. hard-redact any VALUE that looks like a secret (private key, JWT,
//      mnemonic, long base58/base64) while preserving public identifiers
//      (EVM/Solana addresses, amounts, chain ids).

/** Secret-indicating key segments (matched against camel/snake/kebab words). */
const SECRET_KEY_WORDS = new Set<string>([
  "secret",
  "seed",
  "mnemonic",
  "password",
  "passphrase",
  "passwd",
  "privatekey",
  "privkey",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "bearer",
  "credential",
  "credentials",
  "jwt",
  "signature",
]);

/** 32-byte hex (private-key / hash shaped). Params almost never carry a tx
 *  hash, so redacting by default favors safety; the value still appears in the
 *  tool OUTPUT row when it is a legitimate hash. */
const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BASE58_LONG_RE = /^[1-9A-HJ-NP-Za-km-z]{50,}$/; // beyond Solana addr length
const BASE64_LONG_RE = /^[A-Za-z0-9+/=]{60,}$/;

const ARG_MAX_STRING = 256;
const ARG_MAX_ARRAY = 50;
const ARG_MAX_KEYS = 50;
const ARG_MAX_DEPTH = 4;
const ARGS_MAX_SERIALIZED = 2000;

function splitKeyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 0);
}

function isSecretKey(key: string): boolean {
  const words = splitKeyWords(key);
  for (const w of words) {
    if (SECRET_KEY_WORDS.has(w)) return true;
  }
  // Joined camelCase forms: privateKey→[private,key], apiKey→[api,key], …
  const joined = words.join("");
  return /(privatekey|privkey|apikey|accesstoken|refreshtoken|authtoken|secretkey|seedphrase)/.test(
    joined,
  );
}

function redactScalarString(value: string): string {
  if (JWT_RE.test(value)) return "[redacted:jwt]";
  if (HEX32_RE.test(value)) return "[redacted:key]";
  if (BASE58_LONG_RE.test(value)) return "[redacted:secret]";
  if (BASE64_LONG_RE.test(value)) return "[redacted:secret]";
  // BIP39-like: >= 12 space-separated lowercase words.
  const words = value.trim().split(/\s+/);
  if (words.length >= 12 && words.every((w) => /^[a-z]+$/.test(w))) {
    return "[redacted:mnemonic]";
  }
  return value.length > ARG_MAX_STRING ? `${value.slice(0, ARG_MAX_STRING)}…` : value;
}

function redactArgValue(value: unknown, depth: number): unknown {
  if (depth > ARG_MAX_DEPTH) return "[…]";
  if (typeof value === "string") return redactScalarString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, ARG_MAX_ARRAY).map((v) => redactArgValue(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count >= ARG_MAX_KEYS) break;
      if (isSecretKey(k)) continue; // drop secret-named keys entirely
      out[k] = redactArgValue(v, depth + 1);
      count += 1;
    }
    return out;
  }
  return undefined; // functions / symbols / bigint — never expose
}

/**
 * Sanitize one tool call's `args` into a display string, or `null` when there
 * is nothing safe/meaningful to show.
 */
function sanitizeToolArgs(rawArgs: unknown): string | null {
  if (rawArgs === null || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return null;
  }
  const redacted = redactArgValue(rawArgs, 0);
  if (
    redacted === null ||
    typeof redacted !== "object" ||
    Object.keys(redacted as Record<string, unknown>).length === 0
  ) {
    return null;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(redacted, null, 2);
  } catch {
    return null;
  }
  return serialized.length > ARGS_MAX_SERIALIZED
    ? `${serialized.slice(0, ARGS_MAX_SERIALIZED)}\n…(truncated)`
    : serialized;
}

/**
 * Per-call display rows from `messages.tool_calls`. String fields only (no
 * coercion); malformed entries are skipped; capped at 32 calls. `null` when
 * the row carries no tool calls.
 */
function extractToolCalls(raw: unknown): ToolCallDisplay[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ToolCallDisplay[] = [];
  for (const entry of raw) {
    if (out.length >= 32) break;
    if (entry === null || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    // String fields only, AND non-empty: the DTO schema requires min-length 1,
    // so an empty id/name would make the whole page fail IPC output validation.
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.length > 0 ? v : null;
    const id = str(rec["id"]);
    const ns = str(rec["namespace"]);
    const cmd = str(rec["command"]);
    const name = str(rec["name"]);
    const toolName = ns !== null && cmd !== null ? `${ns}:${cmd}` : (cmd ?? name);
    if (id === null || toolName === null) continue; // skip malformed — no coercion
    out.push({
      toolCallId: id.slice(0, 200),
      toolName: toolName.slice(0, 120),
      toolArgs: sanitizeToolArgs(rec["args"]),
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Tool names whose assistant tool-call row renders as a static recall
 * indicator (`kind: "recall"`, stage 8-4). `memory_recall` is per-session
 * narrative memory; `knowledge_recall` is durable cross-session knowledge —
 * the renderer keeps the copy distinct.
 */
const RECALL_TOOL_NAMES = new Set(["memory_recall", "knowledge_recall"]);

/**
 * Engine `message_type` for a Track-1 compaction checkpoint marker
 * (stage 8-4). Matched exactly so other engine markers stay
 * `runtime_notice`.
 */
const COMPACTION_MARKER_MESSAGE_TYPE = "compaction_committed";

/**
 * Engine `message_type` for a chat turn whose streaming was cancelled
 * mid-response (stage 9-5b). Surfaces as the `assistant_stopped` kind.
 */
const CHAT_STOPPED_MESSAGE_TYPE = "chat_stopped";

/**
 * Derive renderer-visible `kind` from row shape using the top-level
 * `message_type` column + the (already allow-list-extracted) tool name.
 * `metadata` JSONB is intentionally never selected.
 */
function deriveKind(row: MessageRow, toolName: string | null): MessageKind {
  if (row.role === "tool") return "tool_result";
  if (hasToolCalls(row.tool_calls)) {
    if (toolName !== null && RECALL_TOOL_NAMES.has(toolName)) return "recall";
    return "tool_call";
  }
  if (row.message_type === COMPACTION_MARKER_MESSAGE_TYPE) return "compaction";
  // A cancelled chat turn (engine `message_type` "chat_stopped", 9-5b) is
  // assistant prose with a "Stopped" badge, not a generic runtime notice.
  // Role-guarded defensively: the engine only ever writes it on an
  // assistant row (partial content, tool_calls null).
  if (row.role === "assistant" && row.message_type === CHAT_STOPPED_MESSAGE_TYPE) {
    return "assistant_stopped";
  }
  if (row.message_type !== null && row.message_type !== "chat") {
    // Other engine markers (wake banners, overflow stubs, runtime
    // notices) surface as the catch-all "runtime_notice" kind.
    return "runtime_notice";
  }
  return "text";
}

function toDto(row: MessageRow): SessionMessageDto {
  // Extract the tool name once: it drives BOTH the recall-kind decision
  // and the DTO's `toolName` field.
  const toolName = extractToolName(row.tool_calls);
  return {
    id: row.id,
    sessionId: row.session_id,
    role: normaliseRole(row.role),
    kind: deriveKind(row, toolName),
    content: row.content ?? "",
    createdAt: toIso(row.created_at),
    toolCallId: row.tool_call_id,
    toolName,
    // Per-call disclosure rows (sanitized args + ids for result correlation).
    // `null` on every non-call row (extractToolCalls returns null for
    // null/empty `tool_calls`).
    toolCalls: extractToolCalls(row.tool_calls),
  };
}

function nextCursorFor(items: readonly SessionMessageDto[]): MessageCursor | null {
  if (items.length === 0) return null;
  const last = items[items.length - 1];
  if (!last) return null;
  return { createdAt: last.createdAt, id: last.id };
}

export async function getMessageTail(
  sessionId: string,
  limit: number = MESSAGES_TAIL_DEFAULT_LIMIT,
): Promise<Result<MessagePage, VexError>> {
  return withClient(async (client) => {
    try {
      const result = await client.query<MessageRow>(
        `SELECT ${MESSAGE_ROW_COLUMNS}
           FROM messages
          WHERE session_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2`,
        [sessionId, limit + 1],
      );
      const rows = result.rows.map(toDto);
      // Renderer renders bottom-to-top with TanStack virtual list — we
      // return tail in chronological order (oldest → newest) so the
      // list mounts at the bottom and the next page is "older above".
      const overflow = rows.length > limit;
      const trimmed = overflow ? rows.slice(0, limit) : rows;
      const items = trimmed.slice().reverse();
      const nextCursor = overflow ? nextCursorFor(trimmed) : null;
      return ok({
        items,
        nextCursor,
        hasMore: overflow,
      });
    } catch (cause) {
      return dbError("getMessageTail query failed", cause);
    }
  });
}

export async function listMessages(
  sessionId: string,
  cursor: MessageCursor | null,
  limit: number = MESSAGES_TAIL_DEFAULT_LIMIT,
): Promise<Result<MessagePage, VexError>> {
  // Defense-in-depth: even though shared schema validated this already,
  // re-parse the cursor before composing SQL. A malformed cursor must
  // resolve to "treat as no cursor" rather than poisoning the query.
  let safeCursor: MessageCursor | null = null;
  if (cursor !== null) {
    const parsed = messageCursorSchema.safeParse(cursor);
    safeCursor = parsed.success ? parsed.data : null;
  }
  return withClient(async (client) => {
    try {
      const result = safeCursor === null
        ? await client.query<MessageRow>(
            `SELECT ${MESSAGE_ROW_COLUMNS}
               FROM messages
              WHERE session_id = $1
              ORDER BY created_at DESC, id DESC
              LIMIT $2`,
            [sessionId, limit + 1],
          )
        : await client.query<MessageRow>(
            `SELECT ${MESSAGE_ROW_COLUMNS}
               FROM messages
              WHERE session_id = $1
                AND (created_at, id) < ($2::timestamptz, $3::integer)
              ORDER BY created_at DESC, id DESC
              LIMIT $4`,
            [sessionId, safeCursor.createdAt, safeCursor.id, limit + 1],
          );
      const rows = result.rows.map(toDto);
      const overflow = rows.length > limit;
      const trimmed = overflow ? rows.slice(0, limit) : rows;
      const items = trimmed.slice().reverse();
      const nextCursor = overflow ? nextCursorFor(trimmed) : null;
      return ok({
        items,
        nextCursor,
        hasMore: overflow,
      });
    } catch (cause) {
      return dbError("listMessages query failed", cause);
    }
  });
}

export async function getMessageAround(
  sessionId: string,
  messageId: number,
  before: number,
  after: number,
): Promise<Result<MessagePage, VexError>> {
  return withClient(async (client) => {
    try {
      // Anchor: load the row to learn its `created_at`. If the message
      // doesn't exist (or belongs to another session), we return an
      // empty page rather than an error — the UI surfaces "message not
      // found" without a toast.
      const anchorResult = await client.query<{
        created_at: string | Date;
        id: number;
      }>(
        `SELECT created_at, id
           FROM messages
          WHERE id = $1 AND session_id = $2`,
        [messageId, sessionId],
      );
      const anchor = anchorResult.rows[0];
      if (!anchor) {
        return ok({ items: [], nextCursor: null, hasMore: false });
      }
      const anchorIso = toIso(anchor.created_at);

      const beforeRows = before === 0
        ? { rows: [] as MessageRow[] }
        : await client.query<MessageRow>(
            `SELECT ${MESSAGE_ROW_COLUMNS}
               FROM messages
              WHERE session_id = $1
                AND (created_at, id) < ($2::timestamptz, $3::integer)
              ORDER BY created_at DESC, id DESC
              LIMIT $4`,
            [sessionId, anchorIso, anchor.id, before],
          );
      const anchorRow = await client.query<MessageRow>(
        `SELECT ${MESSAGE_ROW_COLUMNS}
           FROM messages
          WHERE id = $1 AND session_id = $2`,
        [messageId, sessionId],
      );
      const afterRows = after === 0
        ? { rows: [] as MessageRow[] }
        : await client.query<MessageRow>(
            `SELECT ${MESSAGE_ROW_COLUMNS}
               FROM messages
              WHERE session_id = $1
                AND (created_at, id) > ($2::timestamptz, $3::integer)
              ORDER BY created_at ASC, id ASC
              LIMIT $4`,
            [sessionId, anchorIso, anchor.id, after],
          );

      const items = [
        ...beforeRows.rows.slice().reverse(),
        ...anchorRow.rows,
        ...afterRows.rows,
      ].map(toDto);
      return ok({ items, nextCursor: null, hasMore: false });
    } catch (cause) {
      return dbError("getMessageAround query failed", cause);
    }
  });
}
