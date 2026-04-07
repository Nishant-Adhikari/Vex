/**
 * Production MCP — stdio transport entry.
 *
 * One spawn = one connection = one DB session. The `sessions` row is
 * created before the McpServer factory is built (so the sessionIdProvider
 * has a stable id to return) and ended on transport close.
 *
 * No logs on stdout: `src/utils/logger.ts` already hardcodes `process.stderr`
 * as the only winston transport, so existing logging paths are safe by
 * default. Tool handlers and modules in `src/mcp/` MUST NOT call
 * `console.log` — only `console.error` or the logger.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServerInstance } from "../server/create-server.js";
import { createMcpSession, endMcpSession } from "../sessions.js";
import logger from "@utils/logger.js";

export async function startStdioTransport(): Promise<void> {
  const sessionId = await createMcpSession({ transport: "stdio" });

  const server = createMcpServerInstance({
    sessionIdProvider: () => sessionId,
  });

  const transport = new StdioServerTransport();

  transport.onclose = () => {
    void endMcpSession(sessionId);
    logger.info("mcp.stdio.closed", { sessionId });
  };

  await server.connect(transport);
  logger.info("mcp.stdio.connected", { sessionId });
}
