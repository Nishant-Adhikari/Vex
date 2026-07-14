/**
 * The session Markdown export's own redaction policy.
 *
 * Deliberately NOT unified with `@vex-lib/diagnostics/text-redaction.js` or
 * `../database/messages/redaction.js` — each surface's policy contract is
 * independent (see `@vex-lib/diagnostics/secret-detectors.js`'s module
 * doc for why). This one is intentionally the most conservative of the
 * three: an export can include ARCHIVED historical content, which is
 * exactly where old accidental secret exposure lives, so it prefers
 * over-redaction to leakage.
 *
 * Policy, built on the shared low-level shapes:
 *   - Tier 1 secret shapes (labelled private keys, API keys, JWTs, BIP39
 *     mnemonic heuristic) and open-ended base64 secret blobs are HARD
 *     redacted to `[redacted]` — full removal, no shape preserved.
 *   - EVM/Solana addresses and transaction hashes are left UNTOUCHED. An
 *     export is for research notes / handoff / audit — the whole point is
 *     that a swap's tx hash or a wallet's address stays legible.
 *
 * MAINTAINER POLICY DECISION (2026-07-14): audit-first. Because a secret and
 * a public identifier can be shape-identical, no filter can simultaneously
 * guarantee removal of every unlabelled secret AND preserve every
 * same-shaped public identifier. This export chooses to keep identifiers
 * legible and treats redaction as BEST-EFFORT, stated verbatim in the
 * pre-save dialog ("review the file before sharing it"). Known accepted
 * limitations under this policy:
 *   - an unlabelled raw 64-hex private key is indistinguishable from a tx
 *     hash and will export legibly;
 *   - a base64 secret composed entirely of the base58-overlap alphabet can
 *     evade `looksLikeBase64Secret` (its base58 exclusion exists so Solana
 *     addresses stay legible).
 * Revisit only as a deliberate policy change (privacy-first would redact
 * identifier-shaped values wholesale and gut the export's audit value).
 */

import {
  API_KEY_PREFIX_RE,
  BIP39_HEURISTIC_RE,
  JWT_RE,
  looksLikeBase64Secret,
  OPEN_ENDED_BASE64_CANDIDATE_RE,
  PRIVATE_KEY_LABELLED_RE,
  RAW_HEX_KEY_RE,
} from "@vex-lib/diagnostics/secret-detectors.js";

const REDACTED = "[redacted]";

export function redactForExport(text: string): string {
  let out = text;

  out = out.replace(PRIVATE_KEY_LABELLED_RE, () => REDACTED);
  out = out.replace(RAW_HEX_KEY_RE, () => REDACTED);
  out = out.replace(API_KEY_PREFIX_RE, () => REDACTED);
  out = out.replace(JWT_RE, () => REDACTED);
  out = out.replace(BIP39_HEURISTIC_RE, (match) =>
    // Same guard as text-redaction.ts's mnemonic heuristic: a match that
    // carries sentence punctuation is ordinary lowercase prose, not a
    // self-contained phrase.
    /[.,;!?]/.test(match) ? match : REDACTED,
  );
  // Runs last so it never re-scans text already replaced with `[redacted]`
  // above (the placeholder itself doesn't match the base64 alphabet class).
  out = out.replace(OPEN_ENDED_BASE64_CANDIDATE_RE, (match) =>
    looksLikeBase64Secret(match) ? REDACTED : match,
  );

  return out;
}
