#!/usr/bin/env node
/**
 * Production MCP — CLI entrypoint.
 *
 * Single binary `echoclaw-mcp` with two transports:
 *   - default: stdio (for spawn-style hosts: Cursor, Claude Code, Codex)
 *   - opt-in: Streamable HTTP (URL-first hosts, debugging via curl / Inspector)
 *
 * Selection precedence:
 *   1. `--transport stdio|http` CLI flag
 *   2. `MCP_TRANSPORT=stdio|http` env
 *   3. default = stdio
 *
 * Boot sequence:
 *   1. bootstrap() — env load + validation + migrations + DB/embed health
 *   2. startStdioTransport() OR startHttpTransport()
 *
 * On bootstrap failure, process exits with code 2 (handled inside bootstrap).
 * On runtime failure of the chosen transport, the unhandled rejection bubbles
 * up to the top-level catch and we exit non-zero.
 */

import { bootstrap } from "./bootstrap.js";
import { startStdioTransport } from "./transports/stdio.js";
import { startHttpTransport } from "./transports/http.js";
import logger from "@utils/logger.js";

type Transport = "stdio" | "http";

function parseTransport(argv: readonly string[]): Transport {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--transport") {
      const value = argv[i + 1];
      if (value === "stdio" || value === "http") return value;
      throw new Error(`--transport must be 'stdio' or 'http' (got: ${value ?? "<missing>"})`);
    }
  }
  const fromEnv = (process.env.MCP_TRANSPORT ?? "").trim().toLowerCase();
  if (fromEnv === "stdio" || fromEnv === "http") return fromEnv;
  return "stdio";
}

async function main(): Promise<void> {
  let transport: Transport;
  try {
    transport = parseTransport(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`echoclaw-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }

  await bootstrap();

  logger.info("mcp.startup", { transport });

  if (transport === "stdio") {
    await startStdioTransport();
  } else {
    await startHttpTransport();
  }
}

main().catch((err) => {
  logger.error("mcp.fatal", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.stderr.write(
    `echoclaw-mcp fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
