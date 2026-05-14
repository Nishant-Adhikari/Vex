/**
 * API keys writer (M9 Step 3).
 *
 * Writes API/provider secrets into the encrypted local secret vault.
 * `.env` is intentionally not used for any API key.
 *
 * Polymarket trio:
 *   The schema's `polymarket?: { apiKey, apiSecret, passphrase }`
 *   already enforces "all 3 or none" at the input boundary (the
 *   nested object is `strict()` with all 3 fields required when
 *   present). We re-assert at the writer with a defensive coherence
 *   check so a future schema relaxation can't silently break the
 *   invariant — defense-in-depth.
 *
 * Logging: only the canonical key NAMES being written get logged.
 * NEVER the value, the length, or any prefix/suffix preview. The
 * envelope returned to the renderer carries `fieldsWritten` in
 * canonical order so UI can render "Set: JUPITER_API_KEY, ..."
 * without secrets crossing the boundary.
 */

import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  API_KEYS_CANONICAL_ORDER,
  type ApiKeysSetInput,
  type ApiKeysSetResult,
} from "@shared/schemas/api-keys.js";
import { log } from "../logger/index.js";
import { writeUnlockedSecrets } from "../secrets/session.js";

export interface ApiKeysWriterOptions {
  /** Override `ENV_FILE` for tests; production callers omit. */
  readonly envFile?: string;
}

type CanonicalKey = (typeof API_KEYS_CANONICAL_ORDER)[number];

export async function writeApiKeys(
  input: ApiKeysSetInput,
  _options: ApiKeysWriterOptions = {},
): Promise<Result<ApiKeysSetResult>> {
  // Defensive trio coherence check (schema already enforces; this
  // closes the gap if the schema is ever relaxed).
  if (input.polymarket !== undefined) {
    const trio = input.polymarket;
    if (
      trio.apiKey.length === 0 ||
      trio.apiSecret.length === 0 ||
      trio.passphrase.length === 0
    ) {
      return err({
        code: "validation.invalid_input",
        domain: "onboarding",
        message:
          "Polymarket credentials must include api key, api secret, and passphrase.",
        retryable: false,
        userActionable: true,
        redacted: true,
      });
    }
  }

  // Build the write plan in canonical order so fieldsWritten is
  // deterministic regardless of object iteration order.
  const writes: Array<{ key: CanonicalKey; value: string }> = [];
  if (input.jupiterApiKey !== undefined) {
    writes.push({ key: "JUPITER_API_KEY", value: input.jupiterApiKey });
  }
  if (input.tavilyApiKey !== undefined) {
    writes.push({ key: "TAVILY_API_KEY", value: input.tavilyApiKey });
  }
  if (input.rettiwtApiKey !== undefined) {
    writes.push({ key: "RETTIWT_API_KEY", value: input.rettiwtApiKey });
  }
  if (input.polymarket !== undefined) {
    writes.push({ key: "POLYMARKET_API_KEY", value: input.polymarket.apiKey });
    writes.push({ key: "POLYMARKET_API_SECRET", value: input.polymarket.apiSecret });
    writes.push({ key: "POLYMARKET_PASSPHRASE", value: input.polymarket.passphrase });
  }

  if (writes.length === 0) {
    // Nothing to write — empty submission is a legal Continue.
    return ok({ fieldsWritten: [] });
  }

  const fieldsWritten: CanonicalKey[] = [];
  const updates: Partial<Record<CanonicalKey, string>> = {};
  for (const w of writes) {
    updates[w.key] = w.value;
    fieldsWritten.push(w.key);
  }

  const writeResult = writeUnlockedSecrets(updates);
  if (!writeResult.ok) return writeResult;

  log.info(
    `[api-keys-writer] persisted vault keys=${fieldsWritten.join(",")}`
  );
  return ok({ fieldsWritten });
}
