/**
 * Shared file-based Solana token metadata cache for the new solana-ecosystem shelf.
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SOLANA_TOKEN_CACHE_FILE } from "../../../config/paths.js";
import { ensureConfigDir } from "../../../config/store.js";
import type { TokenMetadata } from "./types.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  meta: TokenMetadata;
  updatedAt: number;
}

interface SolanaTokenCacheFile {
  version: 1;
  tokens: Record<string, CacheEntry>;
}

function emptyCache(): SolanaTokenCacheFile {
  return { version: 1, tokens: {} };
}

function loadSolanaTokenCache(): SolanaTokenCacheFile {
  if (!existsSync(SOLANA_TOKEN_CACHE_FILE)) return emptyCache();

  try {
    const raw = readFileSync(SOLANA_TOKEN_CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as SolanaTokenCacheFile;
    if (parsed.version !== 1) return emptyCache();
    return parsed;
  } catch {
    return emptyCache();
  }
}

function saveSolanaTokenCache(cache: SolanaTokenCacheFile): void {
  ensureConfigDir();

  const dir = dirname(SOLANA_TOKEN_CACHE_FILE);
  const tmpFile = join(dir, `.solana-token-cache.tmp.${Date.now()}.json`);

  try {
    writeFileSync(tmpFile, JSON.stringify(cache, null, 2), "utf-8");
    renameSync(tmpFile, SOLANA_TOKEN_CACHE_FILE);
  } catch {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {
      // Ignore temp cleanup errors.
    }
  }
}

function isStale(entry: CacheEntry): boolean {
  return Date.now() - entry.updatedAt > CACHE_TTL_MS;
}

export function getCachedSolanaToken(mintOrSymbol: string): TokenMetadata | undefined {
  const cache = loadSolanaTokenCache();
  const normalizedQuery = mintOrSymbol.toLowerCase();

  const byMint = cache.tokens[mintOrSymbol];
  if (byMint && !isStale(byMint)) return byMint.meta;

  for (const entry of Object.values(cache.tokens)) {
    if (entry.meta.symbol.toLowerCase() === normalizedQuery && !isStale(entry)) {
      return entry.meta;
    }
  }

  return undefined;
}

export function cacheSolanaTokens(tokens: TokenMetadata[]): void {
  const cache = loadSolanaTokenCache();
  const now = Date.now();

  for (const meta of tokens) {
    cache.tokens[meta.address] = { meta, updatedAt: now };
  }

  saveSolanaTokenCache(cache);
}
