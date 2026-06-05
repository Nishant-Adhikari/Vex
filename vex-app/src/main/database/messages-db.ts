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
 *
 * This module is the compatibility façade for the messages DB repository:
 * the implementation lives in `./messages/*` and is re-exported here so the
 * existing import path (`../database/messages-db.js`) keeps its public
 * surface (`getMessageTail`, `listMessages`, `getMessageAround`).
 */

export { getMessageTail } from "./messages/tail.js";
export { listMessages } from "./messages/list.js";
export { getMessageAround } from "./messages/around.js";
