/**
 * Sessions repo — session lifecycle, compaction, scope, memory language.
 *
 * Compaction model (post-session-episodes rollout):
 *   - `setRollingSummary` updates only the summary text.
 *   - `archivePrefix` moves a bounded prefix of messages into `messages_archive`
 *     (partial compact) and sets the new live `message_count`. `token_count`
 *     is NOT reset here — it's overwritten by the next turn's prompt size in
 *     `turn.ts::updateTokenCount`.
 *   - `forkToolMessageToArchive` is the giant-tool fallback: it COPIES a single
 *     live row into `messages_archive` (same id, full payload) and overwrites
 *     the live row's `content` with a short placeholder. Used when a bloated
 *     tool output in the tail is the sole source of context pressure.
 *
 * Transaction coordination (PR2, post-migration 008):
 *   `setRollingSummary`, `setMemoryLanguageCode`, and `archivePrefix` accept
 *   an optional `PoolClient`. When provided, they run inside the caller's
 *   transaction instead of opening their own. `executeCheckpoint` uses this
 *   to atomically apply the whole write phase (language_code + summary +
 *   episodes + archive) under a single BEGIN/COMMIT — a crash rolls back the
 *   entire set together.
 *
 * Memory language contract (PR2, migration 008):
 *   `sessions.memory_language_code` holds a per-session language marker set
 *   once by the first checkpoint. Values are 2-3 lowercase letters, optional
 *   "-REGION" suffix (e.g. "en", "pl", "fr", "zh", "vi", "pt-BR"), or the
 *   literal "und" for mixed/unclear. Validation is at the code boundary
 *   (`setMemoryLanguageCode`) — no DB CHECK so adding a language later does
 *   not require a migration.
 */

import type { PoolClient } from "pg";
import {
  executeWith,
  getPool,
  query,
  queryOne,
  queryOneWith,
  type Executor,
} from "../client.js";

export {
  archivePrefix,
  archiveSuffix,
  forkToolMessageToArchive,
} from "./sessions-archive.js";

interface SessionRow {
  id: string;
  scope: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  compacted: boolean;
  message_count: number;
  token_count: number;
  memory_scope_key: string | null;
  memory_language_code: string | null;
  checkpoint_generation: number;
  /**
   * Session-level mode discriminator. `mapRow` normalises unexpected values
   * to `"agent"`.
   */
  mode?: string | null;
  /** Session-scoped approval policy: `restricted` (default) or `full`. */
  permission?: string | null;
  /** Snapshot of user-supplied goal at session creation; null for `agent` rows. */
  initial_goal?: string | null;
}

/**
 * Known values for `sessions.mode`. `"agent"` is a one-shot conversational
 * session (post-M12 rename from "chat"). `"mission"` is goal-driven and
 * runs in a loop with agent-self-scheduled wake via `loop_defer`. Immutable
 * after session creation.
 */
export type SessionMode = "agent" | "mission";

/**
 * Session-scoped approval policy. `"restricted"` → every mutating tool
 * requires user approval. `"full"` → mutating tools auto-execute. Immutable
 * after session creation.
 */
export type SessionPermission = "restricted" | "full";

export interface Session {
  id: string;
  scope: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  compacted: boolean;
  messageCount: number;
  tokenCount: number;
  memoryScopeKey: string | null;
  memoryLanguageCode: string | null;
  /**
   * Monotonic counter bumped once per successful checkpoint (see
   * `runCheckpointWriteTx`). Stamped on every episode written in that
   * checkpoint's batch so recall can surface recency as `gen:N`. Starts at 0
   * for a freshly-created session; the first checkpoint lands episodes at
   * generation 1.
   */
  checkpointGeneration: number;
  /**
   * Session-level mode. `"agent"` is one-shot conversational; `"mission"`
   * runs in a loop with agent self-scheduled wake. Immutable.
   */
  mode: SessionMode;
  /** Approval policy. Immutable. */
  permission: SessionPermission;
  /**
   * Snapshot of user intent at session creation. The negotiated/refined
   * mission contract goal lives on `missions.goal` and may differ from
   * this snapshot. `null` for `mode='agent'` sessions.
   */
  initialGoal: string | null;
}

/**
 * Acceptable shape for `sessions.memory_language_code`:
 *   - 2-3 lowercase letters, optional "-REGION" suffix (e.g. "en", "pl",
 *     "fr", "zh", "vi", "pt-BR"),
 *   - or the literal "und" for mixed/unclear.
 *
 * Validation lives at the code boundary (this file's
 * {@link setMemoryLanguageCode}); `knowledge_entries` and `session_episodes`
 * do not own this schema. Adding a language later does not require a DB
 * migration — just new prompt cases in `extract.ts` / `merge.ts`.
 */
export const LANG_CODE_RE = /^([a-z]{2,3}(-[A-Z]{2})?|und)$/;

function mapRow(r: SessionRow): Session {
  return {
    id: r.id,
    scope: r.scope,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    summary: r.summary,
    compacted: r.compacted,
    messageCount: r.message_count,
    tokenCount: r.token_count,
    memoryScopeKey: r.memory_scope_key,
    memoryLanguageCode: r.memory_language_code,
    checkpointGeneration: r.checkpoint_generation,
    mode: r.mode === "mission" ? "mission" : "agent",
    permission: r.permission === "full" ? "full" : "restricted",
    initialGoal: r.initial_goal ?? null,
  };
}

export interface CreateSessionOptions {
  /** Mode is immutable per session. Defaults to `"agent"`. */
  mode?: SessionMode;
  /** Permission is immutable per session. Defaults to `"restricted"`. */
  permission?: SessionPermission;
  /**
   * Snapshot of user goal at creation. REQUIRED when `mode === "mission"`
   * (DB CHECK enforces non-empty trim); ignored for `mode === "agent"`.
   */
  initialGoal?: string | null;
  /**
   * Optional Executor — when provided, the insert runs inside the caller's
   * transaction. Mission session creation uses this to atomically insert
   * the `sessions` row + `missions` draft row.
   */
  executor?: Executor;
}

/**
 * Create a session row. `ON CONFLICT DO NOTHING` keeps the first-writer-wins
 * semantics existing transports depend on. Caller is responsible for
 * supplying `initialGoal` when `mode === "mission"` — DB CHECK enforces it.
 */
export async function createSession(
  id: string,
  options: CreateSessionOptions = {},
): Promise<void> {
  const mode: SessionMode = options.mode ?? "agent";
  const permission: SessionPermission = options.permission ?? "restricted";
  const initialGoal: string | null = mode === "mission" ? (options.initialGoal ?? null) : null;
  const executor: Executor = options.executor ?? getPool();
  await executeWith(
    executor,
    "INSERT INTO sessions (id, mode, permission, initial_goal) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
    [id, mode, permission, initialGoal],
  );
}

/**
 * Mark a session as ended. Idempotent — safe to call multiple times on a
 * session that has already been ended (only the first call writes a value).
 *
 * Used by the production MCP server (`src/mcp/sessions.ts`) on transport
 * disconnect, so the `sessions.ended_at` column reflects MCP connection
 * lifecycle. Vex Agent's chat / mission flows do not call this — their
 * sessions stay open until compaction.
 */
export async function endSession(id: string): Promise<void> {
  await executeWith(
    getPool(),
    "UPDATE sessions SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL",
    [id],
  );
}

export async function getSession(id: string): Promise<Session | null> {
  const row = await queryOne<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]);
  return row ? mapRow(row) : null;
}

export async function setScope(id: string, scope: string): Promise<void> {
  await executeWith(getPool(), "UPDATE sessions SET scope = $1 WHERE id = $2", [scope, id]);
}

/**
 * Set the semantic memory scope key used by `session_episodes` recall.
 *
 * Separate from `scope` (which is coarse: `chat` / `mcp` / `subagent`). The
 * scope key is the identity that episodic recall groups on — typically the
 * session id itself (isolated default for subagents post-PR3), but subagents
 * spawned with `scope_strategy: "shared"` inherit the parent's scope so
 * their checkpoints contribute to the parent's memory.
 */
export async function setMemoryScopeKey(id: string, memoryScopeKey: string): Promise<void> {
  await executeWith(
    getPool(),
    "UPDATE sessions SET memory_scope_key = $2 WHERE id = $1",
    [id, memoryScopeKey],
  );
}

/** SET token count — latest prompt size for checkpoint pressure evaluation. Not cumulative. */
export async function updateTokenCount(id: string, tokenCount: number): Promise<void> {
  await executeWith(
    getPool(),
    "UPDATE sessions SET token_count = $2 WHERE id = $1",
    [id, tokenCount],
  );
}

/**
 * Persist the rolling session summary. Does NOT touch `token_count` or
 * `message_count`; those are partial-archive concerns and live on
 * `archivePrefix`.
 *
 * When `client` is provided, this runs inside the caller's transaction.
 * `executeCheckpoint` uses this to group summary + episodes + archive under
 * a single atomic write.
 */
export async function setRollingSummary(
  id: string,
  summary: string,
  client?: PoolClient,
): Promise<void> {
  const exec: Executor = client ?? getPool();
  await executeWith(exec, "UPDATE sessions SET summary = $2 WHERE id = $1", [id, summary]);
}

/**
 * Read the per-session memory language marker.
 *
 * Returns null when the session has not yet been checkpointed — the first
 * checkpoint infers and persists a value via {@link setMemoryLanguageCode}.
 */
export async function getMemoryLanguageCode(id: string): Promise<string | null> {
  const row = await queryOneWith<{ memory_language_code: string | null }>(
    getPool(),
    "SELECT memory_language_code FROM sessions WHERE id = $1",
    [id],
  );
  return row?.memory_language_code ?? null;
}

/**
 * Persist the per-session memory language marker.
 *
 * Validates `code` against {@link LANG_CODE_RE} and throws on invalid input
 * — callers should never pass raw untrusted values here. The intent is that
 * the LLM's `session_language_inferred` field is the only source of truth,
 * and it is validated at this boundary.
 *
 * The UPDATE is guarded by `WHERE memory_language_code IS NULL` so a session
 * that already has a persisted value is not silently overwritten by a later
 * checkpoint — this honours the v5 invariant "raz ustawiony kod zostaje do
 * końca sesji". Callers that need to intentionally change the value must
 * first NULL it out (deferred UX; not supported via this function in v1).
 *
 * When `client` is provided, runs inside the caller's transaction.
 */
export async function setMemoryLanguageCode(
  id: string,
  code: string,
  client?: PoolClient,
): Promise<void> {
  if (!LANG_CODE_RE.test(code)) {
    throw new Error(
      `setMemoryLanguageCode: invalid code "${code}" — expected ^([a-z]{2,3}(-[A-Z]{2})?|und)$`,
    );
  }
  const exec: Executor = client ?? getPool();
  await executeWith(
    exec,
    "UPDATE sessions SET memory_language_code = $2 WHERE id = $1 AND memory_language_code IS NULL",
    [id, code],
  );
}

export async function listSessions(scope?: string, limit = 50): Promise<Session[]> {
  const rows = scope
    ? await query<SessionRow>(
        "SELECT * FROM sessions WHERE scope = $1 ORDER BY started_at DESC LIMIT $2",
        [scope, limit],
      )
    : await query<SessionRow>(
        "SELECT * FROM sessions ORDER BY started_at DESC LIMIT $1",
        [limit],
      );
  return rows.map(mapRow);
}
