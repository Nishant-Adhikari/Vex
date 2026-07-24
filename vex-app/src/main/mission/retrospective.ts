/**
 * Mission retrospective orchestration.
 *
 * Reuses the SAME main-process one-shot inference path the Signals grade uses
 * (`signals/grade.ts` → the OpenRouter SDK via `@vex-lib/openrouter-client.js`,
 * vault-injected `OPENROUTER_API_KEY` + `AGENT_MODEL`) — ONE lightweight,
 * non-streaming completion, NOT the mission turn-loop.
 *
 * Generated LAZILY on first view of the completed-mission card and cached in
 * `mission_retrospectives` (migration 044): a re-view serves the cached row.
 *
 * FAIL-SOFT by contract: no finalized result, inference unavailable (no
 * key/model), a network/SDK error, or an unparseable response all resolve to
 * `null` (never throw) so the card renders without the Retrospective section.
 *
 * TODO(self-improving-loop): the persisted `lessons[]` are the input a future
 * prompt-revision pass will fold back into the mission setup prompt. A
 * finalize-time trigger (engine `captureMissionFinal`) can call `generate...`
 * eagerly when that loop is built; today generation is view-driven, which keeps
 * the supervised finalize path untouched.
 */

import { randomUUID } from "node:crypto";
import { OpenRouter } from "@vex-lib/openrouter-client.js";
import type { MissionRetrospectiveDto } from "@shared/schemas/mission/retrospective.js";
import type { MoveItem } from "@shared/schemas/portfolio-moves.js";
import type { MissionResultRow } from "@vex-agent/db/repos/mission-results.js";
import type { MissionRetrospectiveRow } from "@vex-agent/db/repos/mission-retrospectives.js";
import { log } from "../logger/index.js";
import {
  OPENROUTER_APP_TITLE,
  OPENROUTER_APP_URL,
  OPENROUTER_NOOP_LOGGER,
} from "../onboarding/openrouter-app-identity.js";
import {
  RETRO_MAX_OUTPUT_TOKENS,
  buildRetrospectiveMessages,
  parseRetrospectiveResponse,
  type RetroTrade,
  type RetrospectiveInput,
} from "./retrospective-prompt.js";

const RETRO_TIMEOUT_MS = 30_000;

/** Minimal SDK response shape we read (defensive optional chaining). */
interface ChatSendResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: unknown };
  }>;
}

interface ChatClient {
  readonly chat: {
    readonly send: (
      body: unknown,
      options?: { signal?: AbortSignal; retries?: { strategy: "none" } },
    ) => Promise<unknown>;
  };
}

/** Injectable dependencies (production wires the real reads/writes + SDK). */
export interface RetrospectiveDeps {
  /** Latest finalized ledger row for the session (null when none). */
  readonly readResult: (sessionId: string) => Promise<MissionResultRow | null>;
  /** Cached retrospective for the run (null when not yet generated). */
  readonly readExisting: (
    missionRunId: string,
  ) => Promise<MissionRetrospectiveRow | null>;
  /** Executed moves for the session (the trades + their rationales). */
  readonly readMoves: (sessionId: string) => Promise<readonly MoveItem[]>;
  /** Persist a freshly generated retrospective (idempotent upsert). */
  readonly save: (input: {
    id: string;
    missionRunId: string;
    sessionId: string;
    summary: string;
    wentWell: string[];
    wentWrong: string[];
    lessons: string[];
    model: string | null;
  }) => Promise<void>;
  /** Inject a chat client for tests; production omits → real OpenRouter SDK. */
  readonly clientFactory?: (apiKey: string, timeoutMs: number) => ChatClient;
  readonly timeoutMs?: number;
}

function defaultClientFactory(apiKey: string, timeoutMs: number): ChatClient {
  return new OpenRouter({
    apiKey,
    debugLogger: OPENROUTER_NOOP_LOGGER,
    retryConfig: { strategy: "none" },
    timeoutMs,
    httpReferer: OPENROUTER_APP_URL,
    appTitle: OPENROUTER_APP_TITLE,
  }) as unknown as ChatClient;
}

async function productionDeps(): Promise<RetrospectiveDeps> {
  const { getSessionResult } = await import(
    "@vex-agent/db/repos/mission-results.js"
  );
  const { getRetrospectiveForRun, saveRetrospective } = await import(
    "@vex-agent/db/repos/mission-retrospectives.js"
  );
  const { getMovesForSession } = await import("../database/moves-db.js");
  return {
    readResult: getSessionResult,
    readExisting: getRetrospectiveForRun,
    readMoves: async (sessionId) => {
      const res = await getMovesForSession(sessionId);
      return res.ok ? res.data : [];
    },
    save: saveRetrospective,
  };
}

/** ISO ms within `[start, end]` (end null → open). Unparseable → excluded. */
function withinRun(createdAt: string, start: string, end: string | null): boolean {
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  const s = Date.parse(start);
  if (!Number.isNaN(s) && t < s) return false;
  if (end !== null) {
    const e = Date.parse(end);
    if (!Number.isNaN(e) && t > e) return false;
  }
  return true;
}

function truncateAddress(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Traded-token display label for a move (sanitized symbol, else truncated addr). */
function tradeTokenLabel(move: MoveItem): string | null {
  const isSell = (move.tradeSide ?? "").toLowerCase() === "sell";
  const symbol = isSell
    ? (move.inputTokenSymbol ?? move.inputTokenLocalSymbol)
    : (move.outputTokenSymbol ?? move.outputTokenLocalSymbol);
  if (typeof symbol === "string" && symbol.length > 0) return symbol;
  const addr = isSell ? move.inputToken : move.outputToken;
  if (typeof addr === "string" && addr.trim().length > 0) {
    return truncateAddress(addr.trim());
  }
  return null;
}

/** Map the session's run-window moves into the compact trade rows for the prompt. */
function movesToTrades(
  moves: readonly MoveItem[],
  startedAt: string,
  endedAt: string | null,
): RetroTrade[] {
  return moves
    .filter((m) => withinRun(m.createdAt, startedAt, endedAt))
    .map((m) => ({
      side: m.tradeSide,
      token: tradeTokenLabel(m),
      valueUsd: m.valueUsd,
      rationale: m.rationale,
    }));
}

function toDto(row: MissionRetrospectiveRow): MissionRetrospectiveDto {
  return {
    summary: row.summary,
    wentWell: row.wentWell,
    wentWrong: row.wentWrong,
    lessons: row.lessons,
    model: row.model,
    createdAt: row.createdAt,
  };
}

/**
 * Get (or lazily generate + cache) the retrospective for a session's latest
 * finalized mission run. Returns `null` fail-soft whenever there is nothing to
 * show — no finalized run, inference unavailable, or a malformed model reply.
 */
export async function getOrGenerateRetrospective(
  sessionId: string,
  correlationId: string,
  injected?: RetrospectiveDeps,
): Promise<MissionRetrospectiveDto | null> {
  const deps = injected ?? (await productionDeps());

  const result = await deps.readResult(sessionId);
  // No ledger row, or the run has not finalized yet → nothing to retrospect.
  if (result === null || result.outcome === "running") return null;

  // Serve the cached row if one exists (a re-view never re-infers).
  const existing = await deps.readExisting(result.missionRunId);
  if (existing !== null) return toDto(existing);

  const apiKey = process.env["OPENROUTER_API_KEY"];
  const model = process.env["AGENT_MODEL"];
  if (
    typeof apiKey !== "string" ||
    apiKey.length === 0 ||
    typeof model !== "string" ||
    model.length === 0
  ) {
    log.info(
      `[mission:retro] inference unavailable (no key/model) correlationId=${correlationId}`,
    );
    return null;
  }

  const moves = await deps.readMoves(sessionId);
  const trades = movesToTrades(moves, result.startedAt, result.endedAt);
  const input: RetrospectiveInput = {
    goal: result.goalSnippet,
    outcome: result.outcome,
    stopReason: result.stopReason,
    stopSummary: result.summary,
    durationS: result.durationS,
    pnlEth: result.pnlEth,
    pnlPct: result.pnlPct,
    tradesCount: result.trades,
    trades,
  };

  const timeoutMs = injected?.timeoutMs ?? RETRO_TIMEOUT_MS;
  const factory = deps.clientFactory ?? defaultClientFactory;
  const client = factory(apiKey, timeoutMs);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let response: unknown;
  try {
    response = await client.chat.send(
      {
        chatRequest: {
          model,
          messages: buildRetrospectiveMessages(input),
          maxCompletionTokens: RETRO_MAX_OUTPUT_TOKENS,
          temperature: 0.2,
        },
      },
      { signal: ac.signal, retries: { strategy: "none" } },
    );
  } catch (cause) {
    const className = cause instanceof Error ? cause.constructor.name : typeof cause;
    log.warn(
      `[mission:retro] inference call failed class=${className} correlationId=${correlationId}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }

  const msg = (response as ChatSendResponse).choices?.[0]?.message;
  const content = typeof msg?.content === "string" ? msg.content : "";
  const parsed = parseRetrospectiveResponse(content);
  if (parsed === null) {
    log.warn(`[mission:retro] unparseable retrospective correlationId=${correlationId}`);
    return null;
  }

  // Persist (idempotent) then re-read so the returned row is the canonical
  // stored one even if a concurrent view won the ON CONFLICT race.
  try {
    await deps.save({
      id: `mretro-${randomUUID()}`,
      missionRunId: result.missionRunId,
      sessionId,
      summary: parsed.summary,
      wentWell: parsed.wentWell,
      wentWrong: parsed.wentWrong,
      lessons: parsed.lessons,
      model,
    });
    const stored = await deps.readExisting(result.missionRunId);
    if (stored !== null) {
      log.info(
        `[mission:retro] ok run=${result.missionRunId} lessons=${stored.lessons.length} correlationId=${correlationId}`,
      );
      return toDto(stored);
    }
  } catch (cause) {
    // Persist failed — still surface the freshly generated retrospective (the
    // card renders; a later view re-generates). Never throw.
    log.warn(
      `[mission:retro] persist failed correlationId=${correlationId}`,
      cause,
    );
  }

  return {
    summary: parsed.summary,
    wentWell: parsed.wentWell,
    wentWrong: parsed.wentWrong,
    lessons: parsed.lessons,
    model,
    createdAt: new Date().toISOString(),
  };
}
