/**
 * Embedding state probe (M9) — feeds `envStateSchema.embeddings`.
 *
 * Reads the 4 EMBEDDING_* keys from `${CONFIG_DIR}/.env` directly
 * (matches engine's runtime contract: `loadEmbeddingConfig()` reads
 * `process.env`, populated from .env via `loadDotenvFileIntoProcess`
 * at bootstrap — `.env.example` is a CLI-setup-time template, NOT a
 * runtime source). The probe says "configured" iff all four keys
 * resolve to valid values per engine validation rules.
 *
 * Reachability (HTTP probe to `${baseUrl}/models`) and dim-lock DB
 * reachability are best-effort signals exposed alongside.
 */

import {
  MAX_EMBEDDING_DIM,
  MIN_EMBEDDING_DIM,
} from "@vex-lib/embedding.js";
import { readDotenvFileValue } from "@vex-lib/dotenv.js";
import { ENV_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";
import { probeDbReachable } from "../database/dim-lock.js";

const HTTP_PROBE_TIMEOUT_MS = 2_000;

export interface EmbeddingsProbe {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly baseUrlRedacted: string | null;
  readonly allFieldsConfigured: boolean;
  readonly dbReachable: boolean | null;
}

function isValidUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.hostname.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

function redactUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function readResolvedFields(envFile: string): {
  baseUrl: string | null;
  model: string | null;
  dim: number | null;
  provider: string | null;
} {
  const safeRead = (key: string): string | null => {
    try {
      return readDotenvFileValue(key, envFile);
    } catch {
      return null;
    }
  };
  const baseUrl = safeRead("EMBEDDING_BASE_URL");
  const model = safeRead("EMBEDDING_MODEL");
  const dimRaw = safeRead("EMBEDDING_DIM");
  const provider = safeRead("EMBEDDING_PROVIDER");
  let dim: number | null = null;
  if (dimRaw !== null && /^\d+$/.test(dimRaw)) {
    const n = Number.parseInt(dimRaw, 10);
    if (Number.isFinite(n) && n >= MIN_EMBEDDING_DIM && n <= MAX_EMBEDDING_DIM) {
      dim = n;
    }
  }
  return { baseUrl, model, dim, provider };
}

async function probeReachable(baseUrl: string): Promise<boolean> {
  // Same path-preserving probe shape used by env-state.ts (codex turn
  // 5 YELLOW #1): never use new URL("/v1/models", baseUrl) which would
  // drop the existing path.
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(HTTP_PROBE_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function probeEmbeddings(envFile: string = ENV_FILE): Promise<EmbeddingsProbe> {
  const fields = readResolvedFields(envFile);
  const allPresent =
    fields.baseUrl !== null &&
    fields.baseUrl.length > 0 &&
    fields.model !== null &&
    fields.model.length > 0 &&
    fields.dim !== null &&
    fields.provider !== null &&
    fields.provider.length > 0;
  const baseUrlValid = fields.baseUrl !== null && isValidUrl(fields.baseUrl);
  const allFieldsConfigured = allPresent && baseUrlValid;

  const [reachable, dbReachable] = await Promise.all([
    allFieldsConfigured ? probeReachable(fields.baseUrl!) : Promise.resolve(false),
    safeProbeDb(),
  ]);

  return {
    configured: allFieldsConfigured,
    reachable,
    baseUrlRedacted: allFieldsConfigured ? redactUrl(fields.baseUrl!) : null,
    allFieldsConfigured,
    dbReachable,
  };
}

async function safeProbeDb(): Promise<boolean | null> {
  try {
    return await probeDbReachable();
  } catch (cause) {
    log.warn("[embedding-state] probeDbReachable threw", cause);
    return null;
  }
}
