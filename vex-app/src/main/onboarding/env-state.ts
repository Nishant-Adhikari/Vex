/**
 * Presence-only setup probes for `vex.onboarding.getEnvState()`.
 * MUST NOT decrypt keystores — codex turn 3 RED #3. Wallet status
 * collapses to `present | missing` (file existence at the shared
 * CONFIG_DIR), which is everything the System Check screen needs.
 *
 * M9: extends the shape with per-API-key status (jupiter / tavily /
 * rettiwt / polymarket-3-state) + embeddings.allFieldsConfigured +
 * embeddings.dbReachable. The legacy `hasJupiterApiKey` field stays
 * as a deprecated mirror of `apiKeys.jupiterConfigured` so M2/M7
 * callers keep parsing without changes.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  ENV_FILE,
  SETUP_COMPLETE_FILE,
} from "../paths/config-dir.js";
import type {
  EnvState,
  ProviderState,
  WalletAddresses,
} from "@shared/schemas/onboarding.js";
import type { PolymarketStatus } from "@shared/schemas/api-keys.js";
import { log } from "../logger/index.js";
import { probeEmbeddings } from "./embedding-state.js";
import { probeProvider } from "./provider-state.js";
import { getUnlockedSecretPresence } from "../secrets/session.js";

const KEYSTORE_FILE = path.join(CONFIG_DIR, "keystore.json");
const SOLANA_KEYSTORE_FILE = path.join(CONFIG_DIR, "solana-keystore.json");

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

/**
 * Local schema for the wallet-addresses slice of `config.json`. Kept
 * local (not imported from @vex-lib) so this probe stays free of the
 * root MCP wallet barrel — that barrel transitively pulls
 * `viem/accounts` for keystore creation, which (a) is not a dependency
 * of vex-app and (b) would drag signing-capable code through the env
 * probe path for no reason.
 *
 * `.passthrough()` because `config.json` has other top-level keys
 * (`chain`, etc.) we deliberately ignore here.
 */
const walletConfigFileSchema = z
  .object({
    wallet: z
      .object({
        address: z.string().nullable().optional(),
        solanaAddress: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * Public wallet addresses from `config.json` — plaintext, NOT decrypted
 * from the keystore (codex turn 3 RED #3 stays honored).
 *
 * Missing file, malformed JSON, or schema rejection all collapse to
 * `{ evm: null, solana: null }`. That matches the historical behavior
 * of the previous `loadConfig()`-based implementation (which defaulted
 * to nulls when `config.json` was absent) so existing M2/M7 callers
 * keep parsing the same response shape. Failure cause is logged at
 * warn level for audit without leaking file contents.
 */
export async function gatherWalletAddresses(
  configFile: string = CONFIG_FILE,
): Promise<WalletAddresses> {
  try {
    const raw = await fs.readFile(configFile, "utf8");
    const parsed = walletConfigFileSchema.parse(JSON.parse(raw));
    return {
      evm: parsed.wallet?.address ?? null,
      solana: parsed.wallet?.solanaAddress ?? null,
    };
  } catch (cause) {
    log.warn("[env-state] gatherWalletAddresses failed", cause);
    return { evm: null, solana: null };
  }
}

function polymarketStatusFrom(
  apiKey: boolean,
  apiSecret: boolean,
  passphrase: boolean,
): PolymarketStatus {
  const set = [apiKey, apiSecret, passphrase].filter(Boolean).length;
  if (set === 0) return "missing";
  if (set === 3) return "configured";
  return "partial";
}

export async function gatherEnvState(): Promise<EnvState> {
  const secretPresence = getUnlockedSecretPresence();
  const [
    evmExists,
    solExists,
    setupFlag,
    embeddings,
    provider,
  ] = await Promise.all([
    fileExists(KEYSTORE_FILE),
    fileExists(SOLANA_KEYSTORE_FILE),
    fileExists(SETUP_COMPLETE_FILE),
    probeEmbeddings(ENV_FILE),
    probeProvider(ENV_FILE),
  ]);
  const hasPwd = secretPresence.vaultConfigured;
  const hasJupiter = secretPresence.secrets.JUPITER_API_KEY === true;
  const hasTavily = secretPresence.secrets.TAVILY_API_KEY === true;
  const hasRettiwt = secretPresence.secrets.RETTIWT_API_KEY === true;
  const hasPolyKey = secretPresence.secrets.POLYMARKET_API_KEY === true;
  const hasPolySecret = secretPresence.secrets.POLYMARKET_API_SECRET === true;
  const hasPolyPass = secretPresence.secrets.POLYMARKET_PASSPHRASE === true;

  const polymarketStatus = polymarketStatusFrom(hasPolyKey, hasPolySecret, hasPolyPass);
  const walletAddresses = await gatherWalletAddresses();

  return {
    hasKeystorePassword: hasPwd,
    hasJupiterApiKey: hasJupiter,
    apiKeys: {
      jupiterConfigured: hasJupiter,
      tavilyConfigured: hasTavily,
      rettiwtConfigured: hasRettiwt,
      polymarketStatus,
    },
    secrets: {
      vaultConfigured: secretPresence.vaultConfigured,
      unlocked: secretPresence.unlocked,
    },
    embeddings,
    walletStatus: {
      evm: evmExists ? "present" : "missing",
      solana: solExists ? "present" : "missing",
    },
    walletAddresses,
    provider,
    setupCompleteFlag: setupFlag,
  };
}

// Re-export ProviderState for downstream typing convenience.
export type { ProviderState };
