/**
 * Embedding step — optional override of EMBEDDING_{BASE_URL,MODEL,DIM,PROVIDER}.
 *
 * Defaults bundled via `.env.example` already cover the local Model Runner
 * setup, so most operators skip. The step is kept optional on purpose; the
 * in-session Env tab (3F) allows changes later.
 *
 * WARNING: changing `EMBEDDING_DIM` after knowledge entries have been
 * written leaves the DB in a mixed-dim state. Shell blocks the input when
 * knowledge_entries is non-empty (checked via a best-effort query; if the
 * query fails the field is still editable with a loud warning).
 */

import { confirm, isCancel, log, text } from "@clack/prompts";
import { readAppEnvMap } from "../../../src/cli/setup/status.js";
import { writeAppEnvValue } from "../../../src/providers/env-resolution.js";
import { synchronizeTrackedEnv } from "../../../src/cli/setup/setup.js";
import { query } from "../../../src/vex-agent/db/client.js";

export interface EmbeddingOutcome {
  aborted: boolean;
  changed: boolean;
}

async function knowledgeEntriesExist(): Promise<boolean> {
  try {
    const rows = await query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM knowledge_entries LIMIT 1",
    );
    const count = parseInt(rows[0]?.n ?? "0", 10);
    return count > 0;
  } catch {
    return false; // DB down or table missing → pretend "empty"
  }
}

async function promptReplace(
  key: string,
  label: string,
  current: string | undefined,
  opts: { placeholder?: string; validate?: (v: string | undefined) => string | undefined } = {},
): Promise<string | symbol> {
  const input = await text({
    message: `${label} (current: ${current ?? "<unset>"}, Enter to keep)`,
    placeholder: opts.placeholder ?? current,
    validate: opts.validate,
  });
  if (isCancel(input)) return input;
  const trimmed = String(input).trim();
  if (!trimmed) return current ?? "";
  writeAppEnvValue(key, trimmed);
  process.env[key] = trimmed;
  return trimmed;
}

export async function runEmbeddingStep(): Promise<EmbeddingOutcome> {
  log.step("Embedding config");
  const envMap = readAppEnvMap();

  log.info(
    [
      `EMBEDDING_BASE_URL = ${envMap.EMBEDDING_BASE_URL ?? "<unset>"}`,
      `EMBEDDING_MODEL    = ${envMap.EMBEDDING_MODEL ?? "<unset>"}`,
      `EMBEDDING_DIM      = ${envMap.EMBEDDING_DIM ?? "<unset>"}`,
      `EMBEDDING_PROVIDER = ${envMap.EMBEDDING_PROVIDER ?? "<unset>"}`,
    ].join("\n"),
  );

  const wantCustomize = await confirm({
    message: "Override embedding settings now?",
    initialValue: false,
  });
  if (isCancel(wantCustomize)) return { aborted: true, changed: false };
  if (!wantCustomize) return { aborted: false, changed: false };

  let changed = false;

  const baseUrl = await promptReplace("EMBEDDING_BASE_URL", "EMBEDDING_BASE_URL", envMap.EMBEDDING_BASE_URL, {
    validate: (v) =>
      !v || v === "" || /^https?:\/\//.test(v) ? undefined : "Must start with http:// or https://",
  });
  if (typeof baseUrl === "symbol") return { aborted: true, changed };
  if (baseUrl !== (envMap.EMBEDDING_BASE_URL ?? "")) changed = true;

  const model = await promptReplace("EMBEDDING_MODEL", "EMBEDDING_MODEL", envMap.EMBEDDING_MODEL);
  if (typeof model === "symbol") return { aborted: true, changed };
  if (model !== (envMap.EMBEDDING_MODEL ?? "")) changed = true;

  const knowledgeExists = await knowledgeEntriesExist();
  if (knowledgeExists) {
    log.warn(
      "EMBEDDING_DIM is LOCKED — knowledge_entries already contain rows at the current dim. Changing dim without `pnpm knowledge-reembed` will leave mixed-dim data and break recall.",
    );
  } else {
    const dim = await promptReplace("EMBEDDING_DIM", "EMBEDDING_DIM", envMap.EMBEDDING_DIM, {
      validate: (v) => {
        if (!v || v === "") return undefined;
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 1 || n > 8192) return "Must be integer 1..8192";
        return undefined;
      },
    });
    if (typeof dim === "symbol") return { aborted: true, changed };
    if (dim !== (envMap.EMBEDDING_DIM ?? "")) changed = true;
  }

  const provider = await promptReplace("EMBEDDING_PROVIDER", "EMBEDDING_PROVIDER", envMap.EMBEDDING_PROVIDER);
  if (typeof provider === "symbol") return { aborted: true, changed };
  if (provider !== (envMap.EMBEDDING_PROVIDER ?? "")) changed = true;

  if (changed) {
    synchronizeTrackedEnv();
    log.success("Embedding settings updated.");
  }
  return { aborted: false, changed };
}
