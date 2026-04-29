#!/usr/bin/env node
/**
 * Production MCP — CLI entrypoint.
 *
 * Single binary `vex-mcp` with two transports:
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

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { bootstrap } from "./bootstrap.js";
import { startStdioTransport } from "./transports/stdio.js";
import { startHttpTransport } from "./transports/http.js";
import { startWakeExecutor, type WakeExecutorHandle } from "@vex-agent/engine/index.js";
import logger from "@utils/logger.js";

type Transport = "stdio" | "http";

export function parseTransport(argv: readonly string[]): Transport {
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

export async function runMcpCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  let transport: Transport;
  try {
    transport = parseTransport(argv);
  } catch (err) {
    process.stderr.write(`vex-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }

  await bootstrap();

  logger.info("mcp.startup", { transport });

  // Wake executor lives on the long-lived MCP process, NOT in
  // `runBootstrapChecks` (which is also called by the CLI readiness check and
  // would spin up a duplicate executor on every CLI invocation — see ADR 001).
  let wakeExecutor: WakeExecutorHandle | null = null;
  if (transport === "stdio") {
    await startStdioTransport();
    wakeExecutor = startWakeExecutor();
  } else {
    await startHttpTransport();
    wakeExecutor = startWakeExecutor();
  }

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info("mcp.shutdown", { signal });
    if (wakeExecutor) {
      await wakeExecutor.stop();
    }
  };
  process.once("SIGTERM", (signal) => {
    void shutdown(signal);
  });
  process.once("SIGINT", (signal) => {
    void shutdown(signal);
  });
}

const isDirectInvocation = import.meta.url === pathToFileURL(realpathSync(process.argv[1]!)).href;

if (isDirectInvocation) {
  runMcpCli().catch((err) => {
    logger.error("mcp.fatal", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.stderr.write(
      `vex-mcp fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
