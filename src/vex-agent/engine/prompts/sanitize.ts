/**
 * `sanitizeForSystemPrompt` — neutralizer for LLM/DB-derived strings that
 * get promoted into the system-prompt layer for the NEXT provider call.
 *
 * What's at risk: every string the engine wraps in a `[Block]\n...\nblock`
 * envelope or a Markdown fence then hands to the next chat completion is a
 * potential prompt-injection vector if the source is LLM-emitted prose or
 * tool output. Examples in PR2:
 *
 *   - `sessions.summary` — the agent's own `compact_now.conversation_summary`
 *     argument, persisted then re-injected as `[Previous conversation
 *     summary]\n...` on every subsequent turn (durable injection).
 *   - `compact_jobs.preserve_md` — fenced inside the resume packet on the
 *     first POST_COMPACT_BRIDGE_CYCLES turns.
 *   - `session_memories.outstanding_items[].text` — listed in the resume
 *     packet's "Outstanding follow-ups" section.
 *   - Recent assistant decisions / tool outcomes — also listed in the resume
 *     packet.
 *
 * Threats neutralized:
 *   - Triple-backtick fence escape — `` ``` `` and longer runs reduced to
 *     single backtick + zero-width separator so they can't close any
 *     wrapping ``` fence used downstream.
 *   - Pseudo role tags (`<system>`, `<assistant>`, `<user>`, `<developer>`)
 *     — opening `<` interrupted by a zero-width separator so the template
 *     no longer matches.
 *   - Chat-template artifacts (`[INST]`, `[/INST]`,
 *     `<|im_start|>`, `<|im_end|>`) — interrupted similarly.
 *
 * Information preservation: the sanitizer KEEPS all characters present, it
 * only inserts zero-width separators inside the dangerous spans. Human
 * readers see the original text; tokenizers see broken templates.
 *
 * Exported `sanitizePreserveMd` is an alias kept for backward compatibility
 * with the resume-packet test that locked in the sanitizer semantics during
 * the codex P1 #3 first round.
 */

export function sanitizeForSystemPrompt(raw: string): string {
  let s = raw;
  s = s.replace(/`{3,}/g, "`​`​`");
  s = s.replace(/<\/?\s*(system|assistant|user|developer)\s*>/gi, (m) =>
    m.replace("<", "<​"),
  );
  s = s.replace(/\[\/?\s*INST\s*\]/gi, (m) => m.replace("[", "[​"));
  s = s.replace(/<\|im_(start|end)\|>/gi, (m) => m.replace("<", "<​"));
  s = s.replace(/​{2,}/g, "​");
  return s;
}

/** Alias retained for the `resume-packet-sanitizer.test.ts` regression suite. */
export const sanitizePreserveMd = sanitizeForSystemPrompt;
