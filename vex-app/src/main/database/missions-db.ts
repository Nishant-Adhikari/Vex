/**
 * Missions DB helper for `mission.getDraft`.
 *
 * Mirrors `sessions-db.ts` decoupling: own `pg.Client` per call. The
 * mapper here is the *only* place where `missions.*_json` JSONB
 * columns get reduced to allow-listed DTO fields. Each JSONB column
 * is validated against its Zod schema; unparseable payloads collapse
 * to safe defaults with a structural log line, so the renderer never
 * sees a raw passthrough that could carry secrets.
 *
 *   missions(
 *     id TEXT PK, root_session_id, status, title, goal,
 *     constraints_json JSONB, success_criteria_json JSONB,
 *     stop_conditions_json JSONB, risk_profile,
 *     capital_source_json JSONB, allowed_protocols TEXT[],
 *     allowed_chains TEXT[], allowed_wallets TEXT[],
 *     created_at, updated_at, approved_at
 *   )
 */

import { Client, type ClientConfig } from "pg";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  MISSION_DRAFT_LIST_ITEM_MAX,
  MISSION_DRAFT_LIST_MAX,
  missionConstraintsSchema,
  missionListEntrySchema,
  missionStatusSchema,
  type MissionConstraints,
  type MissionDraftDto,
  type MissionGetDraftResult,
  type MissionStatus,
} from "@shared/schemas/mission.js";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

const EMPTY_CONSTRAINTS: MissionConstraints = {};

// `correlationId` intentionally omitted; `registerHandler` stamps
// `ctx.requestId` downstream. See `messages-db.ts` for full rationale.
function dbUnavailable(): Result<never, VexError> {
  return err({
    code: "internal.unexpected",
    domain: "mission",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
  });
}

function dbError(reason: string, cause?: unknown): Result<never, VexError> {
  log.warn(`[missions-db] ${reason}`, cause);
  return err({
    code: "internal.unexpected",
    domain: "mission",
    message: "Unable to load mission draft.",
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
    log.warn("[missions-db] buildPoolConfig threw", cause);
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
    log.warn("[missions-db] client.connect failed", cause);
    return dbUnavailable();
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[missions-db] client.end failed (non-fatal)", cause);
    }
  }
}

interface MissionRow {
  readonly id: string;
  readonly root_session_id: string;
  readonly status: string;
  readonly title: string | null;
  readonly goal: string | null;
  readonly constraints_json: unknown;
  readonly success_criteria_json: unknown;
  readonly stop_conditions_json: unknown;
  readonly risk_profile: string | null;
  readonly allowed_protocols: unknown;
  readonly allowed_chains: unknown;
  readonly allowed_wallets: unknown;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly approved_at: string | Date | null;
}

const MISSION_ROW_COLUMNS =
  "id, root_session_id, status, title, goal, constraints_json, success_criteria_json, stop_conditions_json, risk_profile, allowed_protocols, allowed_chains, allowed_wallets, created_at, updated_at, approved_at";

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: string | Date | null): string | null {
  return value === null ? null : toIso(value);
}

function normaliseStatus(raw: string): MissionStatus {
  const parsed = missionStatusSchema.safeParse(raw);
  // An exotic status collapses to `draft` so the read-only handler
  // still returns something renderable. The structural log on the
  // unexpected value will surface in the dispatcher's logs.
  if (!parsed.success) {
    log.warn(`[missions-db] unknown mission status: ${raw}`);
    return "draft";
  }
  return parsed.data;
}

/**
 * Allowlist + Zod parse `constraints_json`. Falls back to `{}` on any
 * failure (column null, not object, fails strict schema). Unknown keys
 * are silently dropped — schema is `.strict()`.
 *
 * The projection path is allowlist-only: each constraint key is copied
 * over only when the source has a value of the expected primitive type.
 * Missing or wrong-typed inputs result in the key being absent from
 * the DTO (not `null`-padded) so the renderer's "Show optional fields"
 * affordance can rely on key presence as a signal.
 */
function normaliseConstraints(raw: unknown): MissionConstraints {
  if (raw === null || raw === undefined) return EMPTY_CONSTRAINTS;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    log.warn("[missions-db] constraints_json not an object — using empty");
    return EMPTY_CONSTRAINTS;
  }
  const parsed = missionConstraintsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Allow-listed projection: a single offending key shouldn't drop the
  // whole constraint set. We copy each key over only when the source
  // value's type matches the schema; everything else is omitted so the
  // DTO stays compact and `undefined`-fields don't leak as `null`.
  const rec = raw as Record<string, unknown>;
  const projection: Partial<MissionConstraints> = {};
  if (typeof rec["maxSpendUsd"] === "number") {
    projection.maxSpendUsd = rec["maxSpendUsd"];
  }
  if (typeof rec["maxLossUsd"] === "number") {
    projection.maxLossUsd = rec["maxLossUsd"];
  }
  if (typeof rec["maxIterations"] === "number") {
    projection.maxIterations = rec["maxIterations"];
  }
  if (typeof rec["deadlineAt"] === "string") {
    projection.deadlineAt = rec["deadlineAt"];
  }
  if (typeof rec["notes"] === "string") {
    projection.notes = rec["notes"];
  }
  const reparsed = missionConstraintsSchema.safeParse(projection);
  if (reparsed.success) return reparsed.data;
  log.warn("[missions-db] constraints_json projection failed Zod parse");
  return EMPTY_CONSTRAINTS;
}

function normaliseStringList(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw)) {
    if (raw !== null && raw !== undefined) {
      log.warn(`[missions-db] ${label} not an array — using empty`);
    }
    return [];
  }
  const out: string[] = [];
  for (const entry of raw) {
    if (out.length >= MISSION_DRAFT_LIST_MAX) break;
    if (typeof entry !== "string") continue;
    const parsed = missionListEntrySchema.safeParse(entry);
    if (parsed.success) {
      out.push(parsed.data);
    } else if (entry.length <= MISSION_DRAFT_LIST_ITEM_MAX) {
      // Loose recovery: trimmed non-empty strings still pass through.
      const trimmed = entry.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
}

function normalisePgArray(raw: unknown, label: string, maxLen: number): string[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    log.warn(`[missions-db] ${label} not an array — using empty`);
    return [];
  }
  const out: string[] = [];
  for (const entry of raw) {
    if (out.length >= MISSION_DRAFT_LIST_MAX) break;
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > maxLen) continue;
    out.push(trimmed);
  }
  return out;
}

function toDraftDto(row: MissionRow): MissionDraftDto {
  return {
    missionId: row.id,
    sessionId: row.root_session_id,
    status: normaliseStatus(row.status),
    title: row.title,
    goal: row.goal,
    constraints: normaliseConstraints(row.constraints_json),
    successCriteria: normaliseStringList(
      row.success_criteria_json,
      "success_criteria_json",
    ),
    stopConditions: normaliseStringList(
      row.stop_conditions_json,
      "stop_conditions_json",
    ),
    riskProfile: row.risk_profile,
    allowedChains: normalisePgArray(row.allowed_chains, "allowed_chains", 64),
    allowedProtocols: normalisePgArray(
      row.allowed_protocols,
      "allowed_protocols",
      64,
    ),
    allowedWallets: normalisePgArray(
      row.allowed_wallets,
      "allowed_wallets",
      128,
    ),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    approvedAt: toIsoOrNull(row.approved_at),
  };
}

export async function getDraftForSession(
  sessionId: string,
): Promise<Result<MissionGetDraftResult, VexError>> {
  return withClient(async (client) => {
    try {
      const result = await client.query<MissionRow>(
        `SELECT ${MISSION_ROW_COLUMNS}
           FROM missions
          WHERE root_session_id = $1
            AND status = 'draft'
          ORDER BY created_at DESC
          LIMIT 1`,
        [sessionId],
      );
      const row = result.rows[0];
      return ok(row ? toDraftDto(row) : null);
    } catch (cause) {
      return dbError("getDraftForSession query failed", cause);
    }
  });
}
