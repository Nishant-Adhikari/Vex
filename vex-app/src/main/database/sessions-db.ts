/**
 * Sessions DB helper for the multi-session app shell.
 *
 * vex-app's main process talks to the same Postgres instance the engine
 * (`src/vex-agent`) writes to, but it does NOT import the engine repos —
 * vex-app deliberately uses its own pg connections so the GUI build stays
 * decoupled from the engine module graph (mirrors the pattern in
 * `dim-lock.ts`).
 *
 * SQL is the contract here. The base Vex Agent migrations create:
 *   sessions(id PK, scope, started_at, ended_at, ..., mode CHECK ('agent'|'mission'),
 *            permission CHECK ('restricted'|'full'), initial_goal,
 *            CHECK (mode <> 'mission' OR btrim(initial_goal) <> ''))
 *   missions(id PK, root_session_id FK, status, title, goal, ...)
 *   mission_runs(id PK, mission_id FK, session_id FK, status, ...)
 *
 * Mission creation pipeline:
 *   1. INSERT sessions (mode='mission', permission, initial_goal)
 *   2. INSERT missions (id, root_session_id=session.id, status='draft', goal=initial_goal)
 *   3. Do NOT create mission_runs here — that happens later via startMission()
 *      after the conversational setup flow refines the contract.
 * Steps 1+2 run inside a single BEGIN/COMMIT — a crash after step 1 must NOT
 * leave a mission session without its missions row.
 *
 * The `goal` value on the freshly created missions row is seeded from
 * `initialGoal` as a sane default; the engine's mission-setup conversational
 * flow rewrites it once the contract is negotiated.
 */

import { Client, type ClientConfig } from "pg";
import { randomUUID } from "node:crypto";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  VEX_APP_SESSION_SCOPE,
  missionRunStatusSchema,
  type MissionRunStatus,
  type SessionCreateInput,
  type SessionListItem,
  type SessionMode,
  type SessionPermission,
} from "@shared/schemas/sessions.js";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;
const ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES: readonly MissionRunStatus[] = [
  "running",
  "paused_approval",
  "paused_wake",
  "paused_error",
];

function dbUnavailable(): Result<never, VexError> {
  return err({
    code: "internal.unexpected",
    domain: "internal",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
  });
}

function dbError(reason: string, cause?: unknown): Result<never, VexError> {
  log.warn(`[sessions-db] ${reason}`, cause);
  return err({
    code: "internal.unexpected",
    domain: "internal",
    message: "Unable to complete the session operation.",
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
    log.warn("[sessions-db] buildPoolConfig threw", cause);
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
    log.warn("[sessions-db] client.connect failed", cause);
    return dbUnavailable();
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[sessions-db] client.end failed (non-fatal)", cause);
    }
  }
}

interface SessionRow {
  readonly id: string;
  readonly mode: string;
  readonly permission: string;
  readonly initial_goal: string | null;
  readonly started_at: string | Date;
  readonly ended_at: string | Date | null;
  readonly title: string | null;
  readonly pinned_at: string | Date | null;
}

interface MissionRunStatusRow {
  readonly session_id: string;
  readonly status: string;
}

const SESSION_ROW_COLUMNS =
  "id, mode, permission, initial_goal, started_at, ended_at, title, pinned_at";

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoStringOrNull(value: string | Date | null): string | null {
  return value === null ? null : toIsoString(value);
}

function normaliseMode(raw: string): SessionMode {
  return raw === "mission" ? "mission" : "agent";
}

function normalisePermission(raw: string): SessionPermission {
  return raw === "full" ? "full" : "restricted";
}

function normaliseMissionStatus(raw: string | null | undefined): MissionRunStatus | null {
  if (raw === null || raw === undefined) return null;
  const parsed = missionRunStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function toListItem(
  row: SessionRow,
  missionStatus: MissionRunStatus | null,
): SessionListItem {
  return {
    id: row.id,
    mode: normaliseMode(row.mode),
    permission: normalisePermission(row.permission),
    title: row.title,
    initialGoal: row.initial_goal,
    startedAt: toIsoString(row.started_at),
    endedAt: toIsoStringOrNull(row.ended_at),
    missionStatus,
    pinnedAt: toIsoStringOrNull(row.pinned_at),
  };
}

/**
 * Load the active mission_run status for a single session id. Shared by
 * `getSessionById` and `setSessionPinned` so a freshly-pinned mission row
 * never gets returned with a wiped `missionStatus`. `listSessions` keeps
 * its batch DISTINCT ON query — single-row lookups here would be N+1.
 */
async function loadMissionStatus(
  client: Client,
  sessionId: string,
): Promise<MissionRunStatus | null> {
  const result = await client.query<{ status: string }>(
    `SELECT status FROM mission_runs
       WHERE session_id = $1
         AND status = ANY($2::text[])
       ORDER BY started_at DESC LIMIT 1`,
    [sessionId, ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES],
  );
  return normaliseMissionStatus(result.rows[0]?.status);
}

/**
 * Create a session. For `mode === "mission"` this also inserts the
 * companion `missions` draft row in the same transaction. Returns the
 * newly persisted list-item shape so the renderer can update its query
 * cache without a follow-up `vex.sessions.list` roundtrip.
 *
 * Side effects:
 *   - INSERT into sessions (always)
 *   - INSERT into missions (mission mode only — status='draft', goal=initialGoal)
 *
 * NO LLM calls. The first turn of the mission setup flow runs later, when
 * the renderer opens the session and the engine's `processMissionSetupTurn`
 * picks up.
 */
export async function createSession(
  input: SessionCreateInput,
): Promise<Result<SessionListItem, VexError>> {
  const id = randomUUID();
  const mode: SessionMode = input.mode;
  const permission: SessionPermission = input.permission;
  const title: string = input.name;
  const initialGoal: string | null =
    input.mode === "mission" ? input.initialGoal : null;

  return withClient(async (client) => {
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO sessions (id, scope, mode, permission, initial_goal, title) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, VEX_APP_SESSION_SCOPE, mode, permission, initialGoal, title],
      );
      if (mode === "mission") {
        // Seed missions.goal with the user's initial intent — the
        // conversational mission-setup flow refines it later. We pass
        // an empty {} / [] for the optional contract fields so the
        // engine validator can lift them on its own pass without
        // tripping NOT NULL constraints (none exist on these columns,
        // but defaults are documented as JSONB '{}' / '[]').
        const missionId = randomUUID();
        await client.query(
          "INSERT INTO missions (id, root_session_id, status, goal) VALUES ($1, $2, 'draft', $3)",
          [missionId, id, initialGoal],
        );
      }
      const sessionResult = await client.query<SessionRow>(
        `SELECT ${SESSION_ROW_COLUMNS} FROM sessions WHERE id = $1 AND scope = $2`,
        [id, VEX_APP_SESSION_SCOPE],
      );
      await client.query("COMMIT");
      const row = sessionResult.rows[0];
      if (!row) {
        return dbError(`createSession lost row id=${id} after INSERT`);
      }
      // Freshly created mission sessions have no mission_run yet — that
      // record only appears once startMission() is called downstream.
      return ok(toListItem(row, null));
    } catch (cause) {
      try {
        await client.query("ROLLBACK");
      } catch (rbCause) {
        log.warn("[sessions-db] ROLLBACK after createSession failure failed", rbCause);
      }
      return dbError("createSession transaction failed", cause);
    }
  });
}

/**
 * Fetch a single session by id, enriched with active mission_run status
 * (mission mode only).
 */
export async function getSessionById(
  id: string,
): Promise<Result<SessionListItem | null, VexError>> {
  return withClient(async (client) => {
    try {
      const sessionResult = await client.query<SessionRow>(
        `SELECT ${SESSION_ROW_COLUMNS} FROM sessions WHERE id = $1 AND scope = $2`,
        [id, VEX_APP_SESSION_SCOPE],
      );
      const row = sessionResult.rows[0];
      if (!row) return ok(null);
      const missionStatus: MissionRunStatus | null =
        normaliseMode(row.mode) === "mission"
          ? await loadMissionStatus(client, id)
          : null;
      return ok(toListItem(row, missionStatus));
    } catch (cause) {
      return dbError("getSessionById failed", cause);
    }
  });
}

/**
 * List sessions (most-recent first), enriched with active mission_run
 * status for mission-mode rows. Bounded at 100 — the sidebar paginates
 * later if we exceed that.
 */
export async function listSessions(
  limit = 100,
): Promise<Result<readonly SessionListItem[], VexError>> {
  return withClient(async (client) => {
    try {
      const sessionsResult = await client.query<SessionRow>(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE scope = $1
         ORDER BY pinned_at DESC NULLS LAST, started_at DESC
         LIMIT $2`,
        [VEX_APP_SESSION_SCOPE, limit],
      );
      const rows = sessionsResult.rows;
      if (rows.length === 0) return ok([]);

      const missionSessionIds = rows
        .filter((r) => normaliseMode(r.mode) === "mission")
        .map((r) => r.id);

      const statusBySession = new Map<string, MissionRunStatus>();
      if (missionSessionIds.length > 0) {
        // Single query, latest active run per session. DISTINCT ON keeps
        // the most recent active/paused row per session_id.
        const runsResult = await client.query<MissionRunStatusRow>(
          `SELECT DISTINCT ON (session_id) session_id, status
           FROM mission_runs
           WHERE session_id = ANY($1::text[])
             AND status = ANY($2::text[])
           ORDER BY session_id, started_at DESC`,
          [missionSessionIds, ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES],
        );
        for (const r of runsResult.rows) {
          const status = normaliseMissionStatus(r.status);
          if (status !== null) statusBySession.set(r.session_id, status);
        }
      }

      return ok(
        rows.map((r) =>
          toListItem(r, statusBySession.get(r.id) ?? null),
        ),
      );
    } catch (cause) {
      return dbError("listSessions failed", cause);
    }
  });
}

/**
 * Pin or unpin a session. Idempotent semantics on both sides:
 *   - re-pinning a pinned row keeps the existing `pinned_at` (via
 *     `COALESCE`) so the sidebar's "most recently pinned first" order
 *     does NOT shuffle on accidental double-clicks.
 *   - re-unpinning an already-unpinned row is a no-op.
 *
 * Returns the updated `SessionListItem` (enriched with `missionStatus`)
 * or `null` when the id is unknown — caller had a stale view, treating
 * it as an error would be hostile.
 */
export async function setSessionPinned(
  id: string,
  pinned: boolean,
): Promise<Result<SessionListItem | null, VexError>> {
  return withClient(async (client) => {
    try {
      const updateResult = await client.query<SessionRow>(
        `UPDATE sessions
            SET pinned_at = CASE
                  WHEN $2::boolean THEN COALESCE(pinned_at, NOW())
                  ELSE NULL
                END
          WHERE id = $1 AND scope = $3
          RETURNING ${SESSION_ROW_COLUMNS}`,
        [id, pinned, VEX_APP_SESSION_SCOPE],
      );
      const row = updateResult.rows[0];
      if (!row) return ok(null);
      const missionStatus: MissionRunStatus | null =
        normaliseMode(row.mode) === "mission"
          ? await loadMissionStatus(client, id)
          : null;
      return ok(toListItem(row, missionStatus));
    } catch (cause) {
      return dbError("setSessionPinned failed", cause);
    }
  });
}
