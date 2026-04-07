/**
 * Production MCP — bearer token storage for the HTTP transport.
 *
 * The HTTP Streamable transport binds to 127.0.0.1 by default and benefits
 * from DNS rebinding protection (`createMcpExpressApp`), but loopback alone
 * does not stop sibling processes on the same machine from hitting `/mcp`.
 * A static bearer token in `Authorization: Bearer {token}` is the minimum
 * additional lock.
 *
 * The token is generated on first start and persisted to
 * `CONFIG_DIR/mcp-http-token` with mode 0600 (readable only by the owning
 * user). Subsequent starts read the same file. The MCP host (Cursor /
 * Claude Code / Codex) is configured with the token via its mcp config
 * `env.MCP_HTTP_TOKEN` or by reading the file directly.
 *
 * stdio transport does not need a token — its trust boundary is the parent
 * process spawn.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR } from "../../config/paths.js";
import logger from "@utils/logger.js";

const TOKEN_FILE = join(CONFIG_DIR, "mcp-http-token");
const TOKEN_BYTE_LEN = 32; // 256 bits → 64 hex chars

/**
 * Get the bearer token, generating + persisting one on first call.
 * Idempotent across process restarts because the same file is reused.
 */
export function loadOrCreateHttpToken(): string {
  if (existsSync(TOKEN_FILE)) {
    try {
      const existing = readFileSync(TOKEN_FILE, "utf-8").trim();
      if (existing.length >= TOKEN_BYTE_LEN) {
        logger.info("mcp.auth.token_loaded", { path: TOKEN_FILE });
        return existing;
      }
      logger.warn("mcp.auth.token_too_short_regenerating", { path: TOKEN_FILE });
    } catch (err) {
      logger.warn("mcp.auth.token_read_failed_regenerating", {
        path: TOKEN_FILE,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const token = randomBytes(TOKEN_BYTE_LEN).toString("hex");
  const dir = dirname(TOKEN_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(TOKEN_FILE, token, { encoding: "utf-8" });
  // chmod 0600 — best effort on Windows where ACLs are different but the
  // call is harmless. On Linux/macOS this restricts read access to the
  // owner only.
  try {
    chmodSync(TOKEN_FILE, 0o600);
  } catch (err) {
    logger.warn("mcp.auth.token_chmod_failed", {
      path: TOKEN_FILE,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  logger.info("mcp.auth.token_generated", { path: TOKEN_FILE });
  return token;
}

/** Returns the absolute path to the token file (for docs / debug). */
export function getHttpTokenPath(): string {
  return TOKEN_FILE;
}
