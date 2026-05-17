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
import {
  startWakeExecutor,
  type WakeExecutorHandle,
  startCompactJobsExecutor,
  type CompactJobsExecutorHandle,
} from "@vex-agent/engine/index.js";
import { startSyncExecutor, type SyncExecutorHandle } from "@vex-agent/sync/executor.js";
import logger from "@utils/logger.js";

// Wake is always-on with no env-driven kill switch. Stale `AGENT_WAKE_*`
// env values from older installs must never disable the wake loop.
const WAKE_INTERVAL_MS = 2000;
const WAKE_BATCH_SIZE = 10;

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
  //
  // Wake is ALWAYS ON with hardcoded defaults. The legacy `AGENT_WAKE_*`
  // env vars are ignored at runtime so a stale
  // `AGENT_WAKE_ENABLED=false` from an older install cannot disable wake.
  let wakeExecutor: WakeExecutorHandle | null = null;
  let syncExecutor: SyncExecutorHandle | null = null;
  let compactJobsExecutor: CompactJobsExecutorHandle | null = null;
  if (transport === "stdio") {
    await startStdioTransport();
    wakeExecutor = startWakeExecutor({ intervalMs: WAKE_INTERVAL_MS, batchSize: WAKE_BATCH_SIZE });
    syncExecutor = startSyncExecutor();
    compactJobsExecutor = startCompactJobsExecutor();
  } else {
    await startHttpTransport();
    wakeExecutor = startWakeExecutor({ intervalMs: WAKE_INTERVAL_MS, batchSize: WAKE_BATCH_SIZE });
    syncExecutor = startSyncExecutor();
    compactJobsExecutor = startCompactJobsExecutor();
  }

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info("mcp.shutdown", { signal });
    if (compactJobsExecutor) {
      await compactJobsExecutor.stop();
    }
    if (wakeExecutor) {
      await wakeExecutor.stop();
    }
    if (syncExecutor) {
      await syncExecutor.stop();
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
