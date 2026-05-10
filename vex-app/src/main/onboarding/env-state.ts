/**
 * Presence-only env-state probes for `vex.onboarding.getEnvState()`.
 * MUST NOT decrypt keystores — codex turn 3 RED #3. Wallet status
 * collapses to `present | missing` (file existence at the shared
 * CONFIG_DIR), which is everything the System Check screen needs.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "@vex-lib/wallet.js";
import { CONFIG_DIR, ENV_FILE, SETUP_COMPLETE_FILE } from "../paths/config-dir.js";
import type {
  EnvState,
  WalletAddresses,
} from "@shared/schemas/onboarding.js";
import { log } from "../logger/index.js";

const KEYSTORE_FILE = path.join(CONFIG_DIR, "keystore.json");
const SOLANA_KEYSTORE_FILE = path.join(CONFIG_DIR, "solana-keystore.json");
const HTTP_PROBE_TIMEOUT_MS = 2_000;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function readEnvKeyPresence(
  envPath: string,
  key: string
): Promise<boolean> {
  try {
    const content = await fs.readFile(envPath, "utf8");
    const re = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*\\S`, "m");
    return re.test(content);
  } catch {
    return false;
  }
}

export async function readEnvValue(
  envPath: string,
  key: string
): Promise<string | null> {
  try {
    const content = await fs.readFile(envPath, "utf8");
    const re = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.+)$`, "m");
    const match = re.exec(content);
    if (!match) return null;
    let value = (match[1] ?? "").trim();
    value = value.replace(/^["']/, "").replace(/["']$/, "");
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function redactEmbeddingUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

async function probeEmbeddingsEndpoint(baseUrl: string): Promise<boolean> {
  // Append `/models` to the configured baseUrl. We MUST NOT use
  // `new URL("/v1/models", baseUrl)` — that resolves to the host root
  // and silently drops `/engines/llama.cpp/v1` (codex turn 5 YELLOW #1).
  // For ai/embeddinggemma the canonical baseUrl is
  // `http://127.0.0.1:12434/engines/llama.cpp/v1`, so the probe URL is
  // `http://127.0.0.1:12434/engines/llama.cpp/v1/models`.
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

/**
 * Public addresses from `config.json` — plaintext, NOT decrypted from
 * the keystore (codex turn 3 RED #3 stays honored). Returns undefined
 * if config.json is missing or unparseable so the optional schema
 * field stays absent rather than mis-typed.
 */
function gatherWalletAddresses(): WalletAddresses | undefined {
  try {
    const cfg = loadConfig();
    return {
      evm: cfg.wallet.address ?? null,
      solana: cfg.wallet.solanaAddress ?? null,
    };
  } catch (cause) {
    log.warn("[env-state] gatherWalletAddresses failed", cause);
    return undefined;
  }
}

export async function gatherEnvState(): Promise<EnvState> {
  const [hasPwd, hasJupiter, evmExists, solExists, setupFlag, embedRaw] =
    await Promise.all([
      readEnvKeyPresence(ENV_FILE, "VEX_KEYSTORE_PASSWORD"),
      readEnvKeyPresence(ENV_FILE, "JUPITER_API_KEY"),
      fileExists(KEYSTORE_FILE),
      fileExists(SOLANA_KEYSTORE_FILE),
      fileExists(SETUP_COMPLETE_FILE),
      readEnvValue(ENV_FILE, "EMBEDDING_BASE_URL"),
    ]);
  const reachable = embedRaw !== null ? await probeEmbeddingsEndpoint(embedRaw) : false;
  const walletAddresses = gatherWalletAddresses();
  return {
    hasKeystorePassword: hasPwd,
    hasJupiterApiKey: hasJupiter,
    embeddings: {
      configured: embedRaw !== null,
      reachable,
      baseUrlRedacted: redactEmbeddingUrl(embedRaw),
    },
    walletStatus: {
      evm: evmExists ? "present" : "missing",
      solana: solExists ? "present" : "missing",
    },
    ...(walletAddresses !== undefined ? { walletAddresses } : {}),
    setupCompleteFlag: setupFlag,
  };
}
