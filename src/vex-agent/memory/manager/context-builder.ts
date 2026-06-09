/**
 * Judge context builder (S4 §4/§7). Assembles what the LLM judge sees: the
 * REDACTED candidate + a REDACTED transcript window dereferenced from the
 * candidate's `source_refs.messageIds`, plus the deterministic signals.
 *
 * The transcript is re-redacted here even though the source messages may pre-date
 * the memory layer's redaction (same discipline as the chunker's
 * `renderRedactedArchivedTranscript`): wallet ids, tx hashes, and key material in
 * a live/archived message must NOT reach the remote judge provider. Messages are
 * read from BOTH `messages` and `messages_archive` (a candidate's source messages
 * may have been compacted into the archive after it was suggested).
 *
 * IO at the edge: the message read is a single bounded SELECT; the rest is pure
 * string assembly. The candidate fields are already redacted (S2 stored them
 * redacted), so they are passed through; a defense-in-depth redact runs on the
 * transcript only.
 */

import { getPool, queryWith, type Executor } from "@vex-agent/db/client.js";
import type { PoolClient } from "pg";
import type { MemoryCandidate } from "@vex-agent/db/repos/memory-candidates/index.js";
import { redact } from "@vex-agent/memory/redaction.js";
import type { EscalationSignals } from "./deterministic-stage.js";

/** Max transcript messages dereferenced for the judge (bounded context). */
const MAX_TRANSCRIPT_MESSAGES = 40;

export interface JudgeContext {
  candidate: Pick<
    MemoryCandidate,
    "kind" | "title" | "summary" | "contentMd" | "importance" | "confidence"
  >;
  /** Redacted, role-tagged transcript window (or empty when no messages resolve). */
  transcript: string;
  signals: EscalationSignals;
  /** Whether the transcript carries an explicit user affirmation (§6 tier hint). */
  userAffirmationDetected: boolean;
}

interface TranscriptRow {
  id: number;
  role: string;
  content: string;
  tool_call_id: string | null;
}

/**
 * Read the candidate's source messages (live + archived) by id, scoped to the
 * candidate's session, ordered by id. Bounded to `MAX_TRANSCRIPT_MESSAGES`.
 */
async function readTranscriptRows(
  sessionId: string,
  messageIds: readonly number[],
  exec: Executor,
): Promise<TranscriptRow[]> {
  if (messageIds.length === 0) return [];
  const ids = messageIds.slice(0, MAX_TRANSCRIPT_MESSAGES);
  return queryWith<TranscriptRow>(
    exec,
    `SELECT id, role, content, tool_call_id
       FROM messages
      WHERE session_id = $1 AND id = ANY($2::int[])
     UNION ALL
     SELECT id, role, content, tool_call_id
       FROM messages_archive
      WHERE session_id = $1 AND id = ANY($2::int[])
      ORDER BY id ASC
      LIMIT $3`,
    [sessionId, ids, MAX_TRANSCRIPT_MESSAGES],
  );
}

// ── User-affirmation heuristic (§6 tier hint, judge confirms) ───────

const USER_AFFIRMATION_RE =
  /\b(i (prefer|want|like|always|never|use|trade|hold)|my (strategy|rule|preference|approach)|please (always|never)|remember that i)\b/i;

function detectUserAffirmation(rows: readonly TranscriptRow[]): boolean {
  return rows.some((r) => r.role === "user" && USER_AFFIRMATION_RE.test(r.content));
}

/**
 * Build the judge context. The candidate is already-redacted (passed through);
 * the transcript is dereferenced + re-redacted. `userAffirmationDetected` is a
 * cheap heuristic the judge uses as the §6 tier hint (it remains authoritative).
 */
export async function buildJudgeContext(
  candidate: MemoryCandidate,
  signals: EscalationSignals,
  client?: PoolClient,
): Promise<JudgeContext> {
  const exec: Executor = client ?? getPool();
  const messageIds = candidate.sourceRefs.messageIds ?? [];
  const rows = await readTranscriptRows(candidate.sessionId, messageIds, exec);

  const transcript = rows
    .map((r) => {
      const redacted = redact(r.content);
      const tool = r.tool_call_id ? ` tool=${r.tool_call_id}` : "";
      return `[${r.role}${tool}] ${redacted.text}`;
    })
    .join("\n");

  const userAffirmationDetected = detectUserAffirmation(rows);

  return {
    candidate: {
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      contentMd: candidate.contentMd,
      importance: candidate.importance,
      confidence: candidate.confidence,
    },
    transcript,
    signals: { ...signals, isUserAffirmed: signals.isUserAffirmed || userAffirmationDetected },
    userAffirmationDetected,
  };
}
