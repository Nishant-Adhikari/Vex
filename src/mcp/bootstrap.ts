/**
 * Production MCP — boot sequence.
 *
 * fail-fast pipeline executed before any transport is bound:
 *   1. loadProviderDotenv() — pulls the same `ENV_FILE` Echo Agent uses.
 *   2. validateRequiredEnv() — explicit ECHO_AGENT_DB_URL + EMBEDDING_*.
 *   3. runMigrations() — idempotent additive migration runner.
 *   4. probeAll() — DB ping + embeddings round-trip.
 *
 * Any failure exits process with code 2 and a structured stderr message.
 * The actual server factory + transport bind happens in src/mcp/index.ts
 * after `bootstrap()` returns.
 */

import { runMigrations } from "@echo-agent/db/migrate.js";
import { loadProviderDotenv } from "../providers/env-resolution.js";
import { McpHealthError, probeAll } from "./runtime/health.js";
import logger from "@utils/logger.js";

const REQUIRED_ENV = [
  "ECHO_AGENT_DB_URL",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIM",
  "EMBEDDING_PROVIDER",
] as const;

export class McpBootstrapError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "McpBootstrapError";
  }
}

export function validateRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !(process.env[k] ?? "").trim());
  if (missing.length === 0) return;
  throw new McpBootstrapError(
    `Missing required env: ${missing.join(", ")}`,
    "Set them in your app .env (CONFIG_DIR/.env) or pass via the MCP host config. " +
      "EchoClaw MCP shares the same env contract as Echo Agent — see docker/echo-agent/.env.example.",
  );
}

/**
 * Run the boot sequence. On success returns `void` and the caller can build
 * the McpServer + bind a transport. On failure writes a structured message
 * to stderr and exits the process with code 2 (no recovery is sensible).
 */
export async function bootstrap(): Promise<void> {
  // 1. Load provider-neutral .env from CONFIG_DIR/.env (same path Echo Agent reads).
  try {
    loadProviderDotenv();
  } catch (err) {
    failFast(
      "Failed to load provider .env",
      err instanceof Error ? err.message : String(err),
      "Check that CONFIG_DIR/.env exists and is readable.",
    );
  }

  // 2. Required env validation — explicit only, no silent fallback.
  try {
    validateRequiredEnv();
  } catch (err) {
    if (err instanceof McpBootstrapError) {
      failFast("MCP bootstrap: env validation failed", err.message, err.hint);
    }
    throw err;
  }

  // 3. Migrations (idempotent).
  try {
    await runMigrations();
  } catch (err) {
    failFast(
      "MCP bootstrap: migrations failed",
      err instanceof Error ? err.message : String(err),
      "Inspect the Postgres logs and ensure the user has CREATE privileges on the DB.",
    );
  }

  // 4. Health probes (DB + embeddings).
  try {
    await probeAll();
  } catch (err) {
    if (err instanceof McpHealthError) {
      failFast("MCP bootstrap: health probe failed", err.message, err.hint);
    }
    failFast(
      "MCP bootstrap: health probe failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  logger.info("mcp.bootstrap.ok");
}

function failFast(prefix: string, detail: string, hint?: string): never {
  const lines = [`${prefix}: ${detail}`];
  if (hint) lines.push(`Hint: ${hint}`);
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(2);
}
